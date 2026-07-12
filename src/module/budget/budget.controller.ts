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
import { BudgetService } from './budget.service';
import {
  CreateBudgetDto,
  CreateExpenseCategoryDto,
  CreateExpenseDto,
  CreateIncomeDto,
  UpdateBudgetDto,
  UpdateExpenseCategoryDto,
  UpdateExpenseDto,
  UpdateIncomeDto,
} from './dto/budget.dto';

@ApiTags('Budget')
@ApiBearerAuth()
@Controller('budget')
export class BudgetController {
  constructor(private readonly budgetSvc: BudgetService) {}

  @Get('summary')
  summary(
    @CurrentUser() userId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('scope') scope?: string,
  ) {
    return this.budgetSvc.summary(userId, startDate, endDate, scope);
  }

  @Get('categories')
  categories(@CurrentUser() userId: string) {
    return this.budgetSvc.categories(userId);
  }

  @Post('categories')
  createCategory(@CurrentUser() userId: string, @Body() data: CreateExpenseCategoryDto) {
    return this.budgetSvc.createCategory(userId, data);
  }

  @Patch('categories/:id')
  updateCategory(@CurrentUser() userId: string, @Param('id') id: string, @Body() data: UpdateExpenseCategoryDto) {
    return this.budgetSvc.updateCategory(userId, id, data);
  }

  @Delete('categories/:id')
  deleteCategory(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.budgetSvc.deleteCategory(userId, id);
  }

  @Get('expenses')
  expenses(@CurrentUser() userId: string, @Query('startDate') startDate?: string, @Query('endDate') endDate?: string) {
    return this.budgetSvc.expenses(userId, startDate, endDate);
  }

  @Post('expenses')
  createExpense(@CurrentUser() userId: string, @Body() data: CreateExpenseDto) {
    return this.budgetSvc.createExpense(userId, data);
  }

  @Patch('expenses/:id')
  updateExpense(@CurrentUser() userId: string, @Param('id') id: string, @Body() data: UpdateExpenseDto) {
    return this.budgetSvc.updateExpense(userId, id, data);
  }

  @Delete('expenses/:id')
  deleteExpense(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.budgetSvc.deleteExpense(userId, id);
  }

  @Get('income')
  incomes(@CurrentUser() userId: string, @Query('startDate') startDate?: string, @Query('endDate') endDate?: string) {
    return this.budgetSvc.incomes(userId, startDate, endDate);
  }

  @Post('income')
  createIncome(@CurrentUser() userId: string, @Body() data: CreateIncomeDto) {
    return this.budgetSvc.createIncome(userId, data);
  }

  @Patch('income/:id')
  updateIncome(@CurrentUser() userId: string, @Param('id') id: string, @Body() data: UpdateIncomeDto) {
    return this.budgetSvc.updateIncome(userId, id, data);
  }

  @Delete('income/:id')
  deleteIncome(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.budgetSvc.deleteIncome(userId, id);
  }

  @Get()
  budgets(@CurrentUser() userId: string, @Query('startDate') startDate?: string, @Query('endDate') endDate?: string) {
    return this.budgetSvc.budgets(userId, startDate, endDate);
  }

  @Post()
  createBudget(@CurrentUser() userId: string, @Body() data: CreateBudgetDto) {
    return this.budgetSvc.createBudget(userId, data);
  }

  @Patch(':id')
  updateBudget(@CurrentUser() userId: string, @Param('id') id: string, @Body() data: UpdateBudgetDto) {
    return this.budgetSvc.updateBudget(userId, id, data);
  }

  @Delete(':id')
  deleteBudget(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.budgetSvc.deleteBudget(userId, id);
  }
}
