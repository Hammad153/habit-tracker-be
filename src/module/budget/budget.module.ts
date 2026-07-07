import { Module } from '@nestjs/common';
import { DatabaseService } from '../../core/database/database.service';
import { BudgetController } from './budget.controller';
import { BudgetService } from './budget.service';

@Module({
  controllers: [BudgetController],
  providers: [BudgetService, DatabaseService],
})
export class BudgetModule {}
