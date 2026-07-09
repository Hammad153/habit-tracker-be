import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { JournalService } from './journal.service';
import {
  CreateJournalEntryDto,
  UpdateJournalEntryDto,
} from './dto/journal.dto';
import { CurrentUser } from '../../core/decorators/current-user.decorator';

@ApiTags('Journal')
@ApiBearerAuth()
@Controller('journal')
export class JournalController {
  constructor(private readonly journalSvc: JournalService) {}

  @Get()
  entries(@CurrentUser() userId: string) {
    return this.journalSvc.entries(userId);
  }

  @Post()
  createEntry(
    @CurrentUser() userId: string,
    @Body() data: CreateJournalEntryDto,
  ) {
    return this.journalSvc.createEntry(userId, data);
  }

  @Patch(':id/favorite')
  toggleFavorite(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.journalSvc.toggleFavorite(userId, id);
  }

  @Patch(':id/pin')
  togglePinned(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.journalSvc.togglePinned(userId, id);
  }

  @Patch(':id')
  updateEntry(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() data: UpdateJournalEntryDto,
  ) {
    return this.journalSvc.updateEntry(userId, id, data);
  }

  @Delete(':id')
  deleteEntry(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.journalSvc.deleteEntry(userId, id);
  }
}
