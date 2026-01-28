import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { ConfigService } from '@nestjs/config';
import { SendEmailDto } from './mailer.interface';
import Mail from 'nodemailer/lib/mailer';

@Injectable()
export class MailerService {
  private transporter: nodemailer.Transporter | null = null;
  private readonly logger = new Logger(MailerService.name);

  constructor(private readonly configSvc: ConfigService) {}

  private getTransporter(): nodemailer.Transporter {
    if (this.transporter) return this.transporter;

    const host = this.configSvc.get<string>('MAIL_HOST');
    const port = this.configSvc.get<number>('MAIL_PORT');
    const user = this.configSvc.get<string>('MAIL_USERNAME');
    const pass = this.configSvc.get<string>('MAIL_PASSWORD');

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: user && pass ? { user, pass } : undefined,
    });

    return this.transporter;
  }

  async sendEmail(dto: SendEmailDto): Promise<any> {
    const transporter = this.getTransporter();

    const { from, html, text, recipients, subject } = dto;

    const fromOption =
      from ??
      `${this.configSvc.get<string>('APP_NAME') || 'SME GLOBAL'} <${
        this.configSvc.get<string>('DEFAULT_EMAIL_FROM') ||
        'noreply@smeglobal.com'
      }>`;

    const to = Array.isArray(recipients)
      ? (recipients as Array<string | { name?: string; address: string }>).map(
          (r) => (typeof r === 'string' ? r : `${r.name ?? ''} <${r.address}>`),
        )
      : recipients;

    const mailOptions: Mail.Options = {
      from: fromOption,
      to,
      subject,
      html,
      text,
    };

    try {
      const result = await transporter.sendMail(mailOptions);
      this.logger.debug(`Email sent: ${result?.messageId as string}`);
      return result;
    } catch (err) {
      this.logger.error('Error sending mail', err);
      throw err;
    }
  }
}
