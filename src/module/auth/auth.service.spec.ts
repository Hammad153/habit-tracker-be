import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

describe('AuthService refresh lifecycle', () => {
  const user = {
    id: 'user-1',
    email: 'a@example.com',
    name: 'A User',
    password: 'hashed',
    refreshToken: 'hashed-refresh',
  } as any;

  const configSvc = {
    get: jest.fn((key: string) => {
      const values: Record<string, string> = {
        JWT_SECRET: 'access-secret',
        JWT_REFRESH_SECRET: 'refresh-secret',
        JWT_EXPIRES_IN: '1h',
        JWT_REFRESH_EXPIRES_IN: '7d',
      };
      return values[key];
    }),
  };

  const jwtSvc = {
    verifyAsync: jest.fn(),
    signAsync: jest.fn(),
  };

  const userSvc = {
    create: jest.fn(),
    findByEmail: jest.fn(),
    findOne: jest.fn(),
    updateRefreshToken: jest.fn(),
    refreshTokenMatch: jest.fn(),
  };

  const service = () =>
    new AuthService(configSvc as any, jwtSvc as any, userSvc as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rotates refresh tokens on successful refresh', async () => {
    jwtSvc.verifyAsync.mockResolvedValue({
      sub: user.id,
      email: user.email,
      token_type: 'refresh',
    });
    userSvc.refreshTokenMatch.mockResolvedValue(true);
    userSvc.findOne.mockResolvedValue(user);
    jwtSvc.signAsync
      .mockResolvedValueOnce('new-access-token')
      .mockResolvedValueOnce('new-refresh-token');

    const result = await service().refreshToken('old-refresh-token');

    expect(result).toEqual({
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
      expires_in: '1h',
    });
    expect(userSvc.updateRefreshToken).toHaveBeenCalledWith(
      user.id,
      'new-refresh-token',
    );
  });

  it('returns a stable terminal code for expired refresh tokens', async () => {
    jwtSvc.verifyAsync.mockRejectedValue({ name: 'TokenExpiredError' });

    await expect(service().refreshToken('expired-refresh')).rejects.toMatchObject(
      {
        response: expect.objectContaining({
          code: 'REFRESH_TOKEN_EXPIRED',
          message: 'Your session has expired. Please sign in again.',
        }),
      },
    );
  });

  it('rejects access tokens submitted to the refresh endpoint', async () => {
    jwtSvc.verifyAsync.mockResolvedValue({
      sub: user.id,
      email: user.email,
      token_type: 'access',
    });

    const promise = service().refreshToken('access-token');

    await expect(promise).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(promise).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'REFRESH_TOKEN_INVALID' }),
    });
  });
});
