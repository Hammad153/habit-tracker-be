import { Module } from '@nestjs/common';
import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';
import { DatabaseService } from '../../core/database/database.service';

@Module({
  controllers: [IdentityController],
  providers: [IdentityService, DatabaseService],
  exports: [IdentityService],
})
export class IdentityModule {}
