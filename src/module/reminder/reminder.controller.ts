import { ApiTags } from '@nestjs/swagger';
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
} from '@nestjs/common';
import { ReminderService } from './reminder.service';
import {
  CreateReminderDto,
  UpdateReminderDto,
  RegisterPushTokenDto,
} from './dto/reminder.dto';
import { CurrentUser } from '../../core/decorators/current-user.decorator';
import { Roles } from '../../core/decorators/roles.decorator';
import { Role } from '@prisma/client';

@ApiTags('Reminders')
@Controller('reminder')
export class ReminderController {
  constructor(private readonly reminderSvc: ReminderService) {}

  @Get()
  findAll(@CurrentUser() userId: string) {
    return this.reminderSvc.findAll(userId);
  }

  @Get('habit/:habitId')
  findByHabit(@CurrentUser() userId: string, @Param('habitId') habitId: string) {
    return this.reminderSvc.findByHabit(userId, habitId);
  }

  @Post()
  create(@CurrentUser() userId: string, @Body() data: CreateReminderDto) {
    return this.reminderSvc.create(userId, data);
  }

  @Patch(':id')
  update(@CurrentUser() userId: string, @Param('id') id: string, @Body() data: UpdateReminderDto) {
    return this.reminderSvc.update(userId, id, data);
  }

  @Delete(':id')
  delete(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.reminderSvc.delete(userId, id);
  }

  @Post('push-token')
  registerPushToken(@CurrentUser() userId: string, @Body() { pushToken }: RegisterPushTokenDto) {
    return this.reminderSvc.registerPushToken(userId, pushToken);
  }

  /** Phase 3.8 — cross-user data is ADMIN-only. */
  @Roles(Role.ADMIN)
  @Get('streak-at-risk')
  getStreakAtRiskUsers() {
    return this.reminderSvc.findStreakAtRiskUsers();
  }
}
