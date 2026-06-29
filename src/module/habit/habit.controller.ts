import { HabitService } from './habit.service';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Body,
  Param,
} from '@nestjs/common';
import { CreateHabitDto } from './dto/create-habit.dto';
import { UpdateHabitDto } from './dto/update-habit.dto';
import {
  CreateHabitDocs,
  DeleteHabitDocs,
  FindAllHabitsDocs,
  FindOneHabitDocs,
  ToggleCompletionDocs,
  UpdateHabitDocs,
} from './habit.swagger';
import { ToggleCompletionDto } from './dto/toggle-completion.dto';
import { CurrentUser } from '../../core/decorators/current-user.decorator';

@ApiTags('Habits')
@ApiBearerAuth()
@Controller('habit')
export class HabitController {
  constructor(private readonly habitSvc: HabitService) {}

  @Get()
  @FindAllHabitsDocs()
  findAll(@CurrentUser() userId: string) {
    return this.habitSvc.findAll(userId);
  }

  @Get(':id')
  @FindOneHabitDocs()
  findOne(@Param('id') id: string, @CurrentUser() userId: string) {
    return this.habitSvc.findOne(id, userId);
  }

  @Post()
  @CreateHabitDocs()
  createHabit(@Body() data: CreateHabitDto, @CurrentUser() userId: string) {
    return this.habitSvc.createHabit(userId, data);
  }

  @Patch(':id')
  @UpdateHabitDocs()
  updateHabit(
    @Param('id') id: string,
    @Body() data: UpdateHabitDto,
    @CurrentUser() userId: string,
  ) {
    return this.habitSvc.updateHabit(id, userId, data);
  }

  @Delete(':id')
  @DeleteHabitDocs()
  deleteHabit(@Param('id') id: string, @CurrentUser() userId: string) {
    return this.habitSvc.deleteHabit(id, userId);
  }

  @Post(':id/toggle')
  @ToggleCompletionDocs()
  toggleCompletion(
    @Param('id') id: string,
    @Body() { date, value }: ToggleCompletionDto,
    @CurrentUser() userId: string,
  ) {
    return this.habitSvc.toggleCompletion(id, userId, date, value);
  }
}
