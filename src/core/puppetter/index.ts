import puppeteer, { Browser } from 'puppeteer';

export class PuppeteerService {
  private static _browser: Browser;

  public static get browser(): Promise<Browser> {
    const options =
      process.env.APP_ENV === 'local'
        ? {}
        : {
            slowMo: 100,
            headless: true,
            executablePath: '/usr/bin/chromium',
            ignoreDefaultArgs: ['--disable-extensions'],
            args: [
              '--no-sandbox',
              '--disabled-setupid-sandbox',
              '--disable-gpu',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--no-first-run',
              '--no-zygote',
              '--max-old-space-size=1000',
            ],
          };

    return this._browser
      ? Promise.resolve(this.browser)
      : puppeteer.launch({ ...options });
  }
}
