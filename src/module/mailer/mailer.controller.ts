import { Controller, Post } from '@nestjs/common';
import { MailerService } from './mailer.service';
import { SendEmailDto } from './mailer.interface';

@Controller('mailer')
export class MailerController {
  constructor(private readonly mailerService: MailerService) {}

  @Post('/send-email')
  async sendMail() {
    const emailDto: SendEmailDto = {
      from: { name: 'Muhamad', address: 'bellomuhammedoladimeji@gmail.com' },
      recipients: [{ name: 'Ahmad', address: 'hammadismail1556@gmail.com' }],
      subject: 'Enjoy this weekend greatly with Fathia',
      html: '<p>Please have some nice times with ajoke this week</p>',
    };

    return this.mailerService.sendEmail(emailDto);
  }
}
