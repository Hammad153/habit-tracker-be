import { HabitService } from './habit.service';
import { ApiTags } from '@nestjs/swagger';
import {
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Body,
  Param,
  Query,
  ValidationPipe,
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

const habitBodyPipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  forbidNonWhitelisted: false,
});

@ApiTags('Habits')
@Controller('habit')
export class HabitController {
  constructor(private readonly habitSvc: HabitService) {}

  @Get()
  @FindAllHabitsDocs()
  findAll(@Query('userId') userId: string) {
    return this.habitSvc.findAll(userId || 'default-user');
  }

  @Get(':id')
  @FindOneHabitDocs()
  findOne(@Param('id') id: string) {
    return this.habitSvc.findOne(id);
  }

  @Post()
  @CreateHabitDocs()
  createHabit(@Body(habitBodyPipe) data: CreateHabitDto) {
    return this.habitSvc.createHabit(data.userId || 'default-user', data);
  }

  @Patch(':id')
  @UpdateHabitDocs()
  updateHabit(
    @Param('id') id: string,
    @Body(habitBodyPipe) data: UpdateHabitDto,
  ) {
    return this.habitSvc.updateHabit(id, data);
  }

  @Delete(':id')
  @DeleteHabitDocs()
  deleteHabit(@Param('id') id: string) {
    return this.habitSvc.deleteHabit(id);
  }

  @Post(':id/toggle')
  @ToggleCompletionDocs()
  toggleCompletion(
    @Param('id') id: string,
    @Body() { date, value }: ToggleCompletionDto,
  ) {
    return this.habitSvc.toggleCompletion(id, date, value);
  }
}
