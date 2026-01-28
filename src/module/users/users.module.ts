import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { DatabaseModule } from 'src/core/database/database.module';
import { MyLoggerService } from 'log/my-logger/my-logger.service';

@Module({
  imports: [DatabaseModule],
  controllers: [UsersController],
  providers: [UsersService, MyLoggerService],
})
export class UsersModule {}
