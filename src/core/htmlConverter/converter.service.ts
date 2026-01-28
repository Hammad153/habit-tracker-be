import { join } from 'path';
import { IHtmlTemplateContext } from './converter.interface';
let ejs = require('ejs');
import { PuppeteerService } from '../puppetter';

export class HtmlConverterService {
  public strToHtml(
    value: string,
    context: IHtmlTemplateContext,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      resolve(ejs.render(value, context));
    });
  }

  public toHtmlStr(
    templateName: string,
    context: IHtmlTemplateContext,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      ejs.renderFile(
        join(process.cwd(), '', 'templates', templateName),
        context,
        (err, data) => {
          if (err) {
            reject(JSON.stringify(err));
          }
          resolve(data);
        },
      );
    });
  }

  public async toImageBuffer(htmlContent: string): Promise<Buffer> {
    return this.generateImage(htmlContent, 'html') as any;
  }

  public async toImageBufferWithUrl(url: string): Promise<Buffer> {
    return this.generateImage(url, 'url') as any;
  }

  public toPdfBuffer(
    templateName: string,
    context: IHtmlTemplateContext,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      ejs.renderFile(
        join(process.cwd(), '', 'templates', templateName),
        context,
        async (err, data) => {
          if (err) {
            console.log(err, 'error..');
            reject(JSON.stringify(err));
          }

          resolve((await this.generatePdf(data, 'html')) as any);
        },
      );
    });
  }

  public async toPdfBufferWithUrl(url: string): Promise<Buffer> {
    return (await this.generatePdf(url, 'url')) as any;
  }

  private async generatePdf(content: string, type: 'html' | 'url') {
    const browser = await PuppeteerService.browser;
    const page = await browser.newPage();

    if (type === 'html') {
      await page.setContent(content, { waitUntil: 'networkidle0' });
    }

    if (type === 'url') {
      await page.goto(content, { waitUntil: 'networkidle0' });
    }

    const pdfOptions: any = {
      format: 'A4',
      landscape: true,
    };

    // Generate the PDF as a buffer.
    const pdfBuffer = await page.pdf(pdfOptions);

    await browser.close();

    return pdfBuffer;
  }

  private async generateImage(content: string, type: 'html' | 'url') {
    // Launch a new browser instance
    const browser = await PuppeteerService.browser;
    const page = await browser.newPage();

    if (type === 'html') {
      await page.setContent(content, { waitUntil: 'networkidle0' });
    }

    if (type === 'url') {
      await page.goto(content, { waitUntil: 'networkidle0' });
    }

    // Set the viewport size to match the content
    const dimensions = await page.evaluate(() => {
      return {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
      };
    });
    await page.setViewport(dimensions);

    // Capture a screenshot of the page
    const buffer = await page.screenshot({ fullPage: true });

    // Close the browser
    await browser.close();

    return buffer;
  }
}
