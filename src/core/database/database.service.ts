import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';

@Injectable()
export class DatabaseService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(DatabaseService.name);

  async onModuleInit() {
    await this.connectWithRetry();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  private async connectWithRetry(retries = 10, delay = 3000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        await this.$connect();
        this.logger.log('✅ Database connected successfully');
        return;
      } catch (error) {
        this.logger.error(
          `❌ DB connection failed (attempt ${attempt}/${retries})`,
        );

        if (attempt === retries) {
          this.logger.error('💀 Exhausted all retries. Exiting...');
          throw error;
        }

        await new Promise((res) => setTimeout(res, delay));
      }
    }
  }

  public generateProviderRef(): string {
    return crypto.randomBytes(8).toString('hex');
  }
}
