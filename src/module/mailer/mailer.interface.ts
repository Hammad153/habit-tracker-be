import { Address } from 'nodemailer/lib/mailer';

export interface SendEmailDto {
  from?: string | Address | undefined;
  recipients: string[] | Address[] | (string | Address)[];
  subject: string;
  html?: string;
  text?: string;
  placeHolderText?: Record<string, string>;
}
