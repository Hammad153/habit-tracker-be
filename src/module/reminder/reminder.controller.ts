import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ReminderService } from './reminder.service';
import {
  CreateReminderDto,
  UpdateReminderDto,
  RegisterPushTokenDto,
} from './dto/reminder.dto';

@ApiTags('Reminders')
@Controller('reminder')
export class ReminderController {
  constructor(private readonly reminderSvc: ReminderService) {}

  @Get()
  findAll(@Query('userId') userId: string) {
    return this.reminderSvc.findAll(userId);
  }

  @Get('habit/:habitId')
  findByHabit(@Param('habitId') habitId: string) {
    return this.reminderSvc.findByHabit(habitId);
  }

  @Post()
  create(@Body() data: CreateReminderDto) {
    return this.reminderSvc.create(data);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() data: UpdateReminderDto) {
    return this.reminderSvc.update(id, data);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.reminderSvc.delete(id);
  }

  @Post('push-token')
  registerPushToken(@Body() { userId, pushToken }: RegisterPushTokenDto) {
    return this.reminderSvc.registerPushToken(userId, pushToken);
  }

  @Get('streak-at-risk')
  getStreakAtRiskUsers() {
    return this.reminderSvc.findStreakAtRiskUsers();
  }
}
