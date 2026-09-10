import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../../core/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { AdminHabitsService, AdminHabitsQueryDto } from './admin-habits.service';

@ApiTags('Admin Habit Management')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin/habits')
export class AdminHabitsController {
  constructor(private readonly adminHabitsSvc: AdminHabitsService) {}

  @Get()
  getHabits(@Query() query: AdminHabitsQueryDto) {
    return this.adminHabitsSvc.getHabits(query);
  }

  @Get(':id')
  getHabitDetail(@Param('id') id: string) {
    return this.adminHabitsSvc.getHabitDetail(id);
  }
}
