import { Logger } from '@nestjs/common';
import { NvidiaProvider } from './nvidia.provider';

const VALID_OUTPUT = JSON.stringify({
  headline: 'Make Thursday easier',
  message: 'Thursdays have been your hardest day. Decide on your minimum version now.',
  tone: 'cautionary',
  actionLabel: 'Try the minimum version',
});

const setEnv = () => {
  process.env.NVIDIA_API_KEY = 'sk-test-secret';
  process.env.NVIDIA_MODEL = 'test/model-1';
  process.env.NVIDIA_BASE_URL = 'https://nvidia.test/v1';
};

const clearEnv = () => {
  delete process.env.NVIDIA_API_KEY;
  delete process.env.NVIDIA_MODEL;
  delete process.env.NVIDIA_BASE_URL;
};

const okResponse = (body: unknown) =>
  ({ ok: true, status: 200, json: () => Promise.resolve(body) }) as Response;

const chatBody = (content: string) => ({
  choices: [{ message: { content } }],
});

describe('NvidiaProvider', () => {
  afterEach(() => {
    clearEnv();
    jest.restoreAllMocks();
  });

  const makeProvider = () => new NvidiaProvider();

  const input = { system: 'SYS', user: 'USER' };

  it('is disabled without configuration and fails safe', async () => {
    clearEnv();
    const provider = makeProvider();
    expect(provider.enabled).toBe(false);
    await expect(provider.generateCoachResponse(input)).rejects.toMatchObject({
      kind: 'NOT_CONFIGURED',
    });
  });

  it('sends model, auth header, and both messages on success', async () => {
    setEnv();
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(okResponse(chatBody(VALID_OUTPUT)));
    const result = await makeProvider().generateCoachResponse(input);

    expect(result.headline).toBe('Make Thursday easier');
    expect(result.tone).toBe('cautionary');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://nvidia.test/v1/chat/completions');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-test-secret');
    const payload = JSON.parse((init as RequestInit).body as string);
    expect(payload.model).toBe('test/model-1');
    expect(payload.messages).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'USER' },
    ]);
  });

  it('extracts JSON embedded in prose or code fences', async () => {
    setEnv();
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      okResponse(chatBody(`Sure!\n\`\`\`json\n${VALID_OUTPUT}\n\`\`\``)),
    );
    const result = await makeProvider().generateCoachResponse(input);
    expect(result.message).toContain('minimum version');
  });

  it('retries once after malformed JSON and then succeeds', async () => {
    setEnv();
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(okResponse(chatBody('not json at all')))
      .mockResolvedValueOnce(okResponse(chatBody(VALID_OUTPUT)));
    const result = await makeProvider().generateCoachResponse(input);
    expect(result.headline).toBe('Make Thursday easier');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails with BAD_RESPONSE after repeated malformed output', async () => {
    setEnv();
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(okResponse(chatBody('<html>garbage</html>')));
    await expect(makeProvider().generateCoachResponse(input)).rejects.toMatchObject(
      { kind: 'BAD_RESPONSE' },
    );
  });

  it('treats empty model responses as BAD_RESPONSE', async () => {
    setEnv();
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(okResponse(chatBody('')));
    await expect(makeProvider().generateCoachResponse(input)).rejects.toMatchObject(
      { kind: 'BAD_RESPONSE' },
    );
  });

  it('rejects payloads that violate the schema (no fabricated structure)', async () => {
    setEnv();
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      okResponse(chatBody(JSON.stringify({ message: 'only a message' }))),
    );
    await expect(makeProvider().generateCoachResponse(input)).rejects.toMatchObject(
      { kind: 'BAD_RESPONSE' },
    );
  });

  it('maps 429 to RATE_LIMITED', async () => {
    setEnv();
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ok: false, status: 429 } as Response);
    await expect(makeProvider().generateCoachResponse(input)).rejects.toMatchObject(
      { kind: 'RATE_LIMITED', status: 429 },
    );
  });

  it('maps 500 to HTTP_ERROR', async () => {
    setEnv();
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ok: false, status: 503 } as Response);
    await expect(makeProvider().generateCoachResponse(input)).rejects.toMatchObject(
      { kind: 'HTTP_ERROR', status: 503 },
    );
  });

  it('maps aborted requests to TIMEOUT', async () => {
    setEnv();
    process.env.NVIDIA_TIMEOUT_MS = '10';
    jest.spyOn(globalThis, 'fetch').mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          (init as RequestInit).signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );
    await expect(makeProvider().generateCoachResponse(input)).rejects.toMatchObject(
      { kind: 'TIMEOUT' },
    );
  }, 10000);

  it('maps network failures to NETWORK', async () => {
    setEnv();
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    await expect(makeProvider().generateCoachResponse(input)).rejects.toMatchObject(
      { kind: 'NETWORK' },
    );
  });

  it('never logs the API key or prompts on failures', async () => {
    setEnv();
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    const logSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    try {
      await makeProvider().generateCoachResponse(input);
    } catch {
      /* expected */
    }
    const logged = JSON.stringify(logSpy.mock.calls);
    expect(logged).not.toContain('sk-test-secret');
    expect(logged).not.toContain('SYS');
    logSpy.mockRestore();
  });

  it('exposes the configured model name', () => {
    setEnv();
    expect(makeProvider().model).toBe('test/model-1');
  });
});
