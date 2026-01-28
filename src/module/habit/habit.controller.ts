import {
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { HabitService } from './habit.service';

@Controller('habit')
export class HabitController {
  constructor(private readonly habitSvc: HabitService) {}

  @Get()
  findAll(@Query('userId') userId: string) {
    return this.habitSvc.findAll(userId || 'default-user');
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.habitSvc.findOne(id);
  }

  @Post()
  createHabit(@Body() data: any) {
    return this.habitSvc.createHabit(data.userId || 'default-user', data);
  }

  @Patch(':id')
  updateHabit(@Param('id') id: string, @Body() data: any) {
    return this.habitSvc.updateHabit(id, data);
  }

  @Delete(':id')
  deleteHabit(@Param('id') id: string) {
    return this.habitSvc.deleteHabit(id);
  }

  @Post(':id/toggle')
  toggleCompletion(@Param('id') id: string, @Body('date') date: string) {
    return this.habitSvc.toggleCompletion(id, date);
  }
}
