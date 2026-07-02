import { Controller } from '@nestjs/common';
import { MailerService } from './mailer.service';

/**
 * Mail is sent internally by other services (e.g. account verification,
 * password reset, weekly summaries). The previous public `POST /send-email`
 * test endpoint with hardcoded personal recipients was removed — it leaked
 * personal data and could be abused to send arbitrary mail.
 */
@Controller('mailer')
export class MailerController {
  constructor(private readonly mailerService: MailerService) {}
}
