import { MyLoggerService } from 'log/my-logger/my-logger.service';
import { SkipThrottle } from '@nestjs/throttler';
import { Controller, Body } from '@nestjs/common';
import { UsersService } from './users.service';

@SkipThrottle()
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly logger: MyLoggerService,
  ) {}
}
