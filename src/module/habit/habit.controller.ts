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
import { Throttle } from '@nestjs/throttler';
import { AdaptiveService } from './adaptive.service';
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
import { StreakFreezeService } from '../rewards/streak-freeze.service';
import { FreezeDto } from './dto/freeze.dto';

@ApiTags('Habits')
@ApiBearerAuth()
@Controller('habit')
export class HabitController {
  constructor(
    private readonly habitSvc: HabitService,
    private readonly freezeSvc: StreakFreezeService,
    private readonly adaptiveSvc: AdaptiveService,
  ) {}

  /**
   * Phase 3.5 — deterministic adaptive suggestion (AI wording included).
   * Throttled harder than defaults: it can consume inference quota.
   */
  @Throttle({ short: { limit: 3, ttl: 1000 }, long: { limit: 30, ttl: 60_000 } })
  @Get(':id/adaptive-suggestion')
  getAdaptiveSuggestion(
    @Param('id') id: string,
    @CurrentUser() userId: string,
  ) {
    return this.adaptiveSvc.getSuggestion(userId, id);
  }

  /** Acceptance applies the proposal through the EXISTING habit edit path. */
  @Post(':id/adaptive-suggestion/:proposalId/accept')
  acceptAdaptiveSuggestion(
    @Param('id') id: string,
    @Param('proposalId') proposalId: string,
    @CurrentUser() userId: string,
  ) {
    return this.adaptiveSvc.acceptProposal(userId, id, proposalId);
  }

  /** Rejection stores the decision; identical proposals will not spam. */
  @Post(':id/adaptive-suggestion/:proposalId/reject')
  rejectAdaptiveSuggestion(
    @Param('id') id: string,
    @Param('proposalId') proposalId: string,
    @CurrentUser() userId: string,
  ) {
    return this.adaptiveSvc.rejectProposal(userId, id, proposalId);
  }

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
    @Body() { date, value, kind }: ToggleCompletionDto,
    @CurrentUser() userId: string,
  ) {
    return this.habitSvc.toggleCompletion(id, userId, date, value, kind);
  }

  @Post(':id/freeze')
  async freeze(@Param('id') id: string, @Body() body: FreezeDto, @CurrentUser() userId: string) {
    return this.freezeSvc.purchaseFreeze(userId, id, body.date);
  }

  @Post('cleanup')
  async cleanupExpiredHabits() {
    const count = await this.habitSvc.cleanupExpiredHabits();
    return { message: `Cleaned up ${count} expired habit(s)`, count };
  }
}