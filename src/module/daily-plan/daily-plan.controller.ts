import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../core/decorators/current-user.decorator';
import { DailyPlanService } from './daily-plan.service';
import {
  CreateDailyPlanDto,
  CreateDailyPlanTaskDto,
  ReorderDailyPlanTasksDto,
  UpdateDailyPlanDto,
  UpdateDailyPlanTaskDto,
} from './dto/daily-plan.dto';

@ApiTags('Daily Plan')
@ApiBearerAuth()
@Controller('daily-plan')
export class DailyPlanController {
  constructor(private readonly dailyPlanSvc: DailyPlanService) {}

  @Get('summary')
  summary(@CurrentUser() userId: string, @Query('date') date?: string) {
    return this.dailyPlanSvc.summary(userId, date);
  }

  @Post('tasks')
  createTask(@CurrentUser() userId: string, @Body() data: CreateDailyPlanTaskDto) {
    return this.dailyPlanSvc.createTask(userId, data);
  }

  @Patch('tasks/reorder')
  reorderTasks(@CurrentUser() userId: string, @Body() data: ReorderDailyPlanTasksDto) {
    return this.dailyPlanSvc.reorderTasks(userId, data.taskIds);
  }

  @Patch('tasks/:id')
  updateTask(@CurrentUser() userId: string, @Param('id') id: string, @Body() data: UpdateDailyPlanTaskDto) {
    return this.dailyPlanSvc.updateTask(userId, id, data);
  }

  @Delete('tasks/:id')
  deleteTask(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.dailyPlanSvc.deleteTask(userId, id);
  }

  @Get()
  plans(@CurrentUser() userId: string, @Query('date') date?: string, @Query('startDate') startDate?: string, @Query('endDate') endDate?: string) {
    return this.dailyPlanSvc.plans(userId, date, startDate, endDate);
  }

  @Post()
  createPlan(@CurrentUser() userId: string, @Body() data: CreateDailyPlanDto) {
    return this.dailyPlanSvc.createPlan(userId, data);
  }

  @Patch(':id')
  updatePlan(@CurrentUser() userId: string, @Param('id') id: string, @Body() data: UpdateDailyPlanDto) {
    return this.dailyPlanSvc.updatePlan(userId, id, data);
  }

  @Delete(':id')
  deletePlan(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.dailyPlanSvc.deletePlan(userId, id);
  }
}
