import { PartialType } from '@nestjs/mapped-types';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export const BUDGET_PERIOD_TYPES = ['DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM'] as const;
export const EXPENSE_CATEGORIES = [
  'Food',
  'Transport',
  'Bills',
  'Health',
  'Education',
  'Savings',
  'Entertainment',
  'Others',
] as const;

export class CreateBudgetDto {
  @ApiProperty({ example: 'July Budget' })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiProperty({ example: 150000 })
  @IsNumber()
  @Min(0)
  amount!: number;

  @ApiProperty({ enum: BUDGET_PERIOD_TYPES, example: 'MONTHLY' })
  @IsIn(BUDGET_PERIOD_TYPES)
  periodType!: string;

  @ApiProperty({ example: '2026-07-01' })
  @IsDateString()
  startDate!: string;

  @ApiProperty({ example: '2026-07-31' })
  @IsDateString()
  endDate!: string;
}

export class UpdateBudgetDto extends PartialType(CreateBudgetDto) {}

export class CreateExpenseCategoryDto {
  @ApiProperty({ example: 'Food' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ example: 'fast-food-outline' })
  @IsOptional()
  @IsString()
  icon?: string;

  @ApiPropertyOptional({ example: '#F97316' })
  @IsOptional()
  @IsString()
  color?: string;
}

export class UpdateExpenseCategoryDto extends PartialType(CreateExpenseCategoryDto) {}

export class CreateExpenseDto {
  @ApiPropertyOptional({ example: 'budget-id' })
  @IsOptional()
  @IsString()
  budgetId?: string;

  @ApiProperty({ example: 'category-id' })
  @IsString()
  @IsNotEmpty()
  categoryId!: string;

  @ApiProperty({ example: 'Groceries' })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiProperty({ example: 8500 })
  @IsNumber()
  @Min(0)
  amount!: number;

  @ApiPropertyOptional({ example: 'Weekly market run' })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiProperty({ example: '2026-07-07' })
  @IsDateString()
  expenseDate!: string;
}

export class UpdateExpenseDto extends PartialType(CreateExpenseDto) {}

export class CreateIncomeDto {
  @ApiProperty({ example: 'Salary' })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiProperty({ example: 300000 })
  @IsNumber()
  @Min(0)
  amount!: number;

  @ApiProperty({ example: '2026-07-01' })
  @IsDateString()
  incomeDate!: string;

  @ApiPropertyOptional({ example: 'Main job' })
  @IsOptional()
  @IsString()
  note?: string;
}

export class UpdateIncomeDto extends PartialType(CreateIncomeDto) {}
