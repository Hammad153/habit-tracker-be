import { Module } from '@nestjs/common';
import { ProfileService } from './profile.service';
import { ProfileController } from './profile.controller';
import { DatabaseService } from 'src/core/database/database.service';

@Module({
  controllers: [ProfileController],
  providers: [ProfileService, DatabaseService],
})
export class ProfileModule {}
