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
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';
import { IdentityService } from './identity.service';
import {
  CreateIdentityDto,
  LinkIdentityHabitDto,
  UpdateIdentityDto,
} from './dto/identity.dto';
import { CurrentUser } from '../../core/decorators/current-user.decorator';

class IdentityDateQueryDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date?: string;
}

@ApiTags('Identity')
@ApiBearerAuth()
@Controller('identity')
export class IdentityController {
  constructor(private readonly identitySvc: IdentityService) {}

  @Post()
  create(@Body() data: CreateIdentityDto, @CurrentUser() userId: string) {
    return this.identitySvc.create(userId, data);
  }

  @Get()
  @ApiOkResponse({
    description:
      'Lists the authenticated user\'s identities with deterministic evidence progress. Pass ?date=YYYY-MM-DD (client-local) to include "completed today" counts.',
  })
  findAll(@CurrentUser() userId: string, @Query() query: IdentityDateQueryDto) {
    return this.identitySvc.findAll(userId, query.date);
  }

  @Get(':id')
  findOne(
    @Param('id') id: string,
    @CurrentUser() userId: string,
    @Query() query: IdentityDateQueryDto,
  ) {
    return this.identitySvc.findOne(userId, id, query.date);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() data: UpdateIdentityDto,
    @CurrentUser() userId: string,
  ) {
    return this.identitySvc.update(userId, id, data);
  }

  /**
   * Identities carrying evidence are archived instead of deleted so history
   * stays intact; unused identities are removed. The response exposes an
   * `archived` flag telling which happened.
   */
  @Delete(':id')
  @ApiOkResponse({
    description:
      'Deletes an unused identity, or archives it when it already carries behavioral evidence.',
  })
  delete(@Param('id') id: string, @CurrentUser() userId: string) {
    return this.identitySvc.delete(userId, id);
  }

  @Post(':id/habit')
  linkHabit(
    @Param('id') id: string,
    @Body() data: LinkIdentityHabitDto,
    @CurrentUser() userId: string,
  ) {
    return this.identitySvc.linkHabit(userId, id, data.habitId);
  }

  @Delete(':id/habit/:habitId')
  unlinkHabit(
    @Param('id') id: string,
    @Param('habitId') habitId: string,
    @CurrentUser() userId: string,
  ) {
    return this.identitySvc.unlinkHabit(userId, id, habitId);
  }
}
