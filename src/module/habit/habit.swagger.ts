import { applyDecorators } from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { CreateHabitDto } from './dto/create-habit.dto';
import { UpdateHabitDto } from './dto/update-habit.dto';
import { ToggleCompletionDto } from './dto/toggle-completion.dto';

export function FindAllHabitsDocs() {
  return applyDecorators(
    ApiOperation({ summary: 'Get all habits for a user' }),
    ApiQuery({
      name: 'userId',
      required: false,
      description: 'ID of the user',
    }),
    ApiResponse({ status: 200, description: 'Return all habits' }),
  );
}

export function FindOneHabitDocs() {
  return applyDecorators(
    ApiOperation({ summary: 'Get a habit by ID' }),
    ApiParam({ name: 'id', description: 'Habit ID' }),
    ApiResponse({ status: 200, description: 'Return the habit' }),
    ApiResponse({ status: 404, description: 'Habit not found' }),
  );
}

export function CreateHabitDocs() {
  return applyDecorators(
    ApiOperation({
      summary: 'Create a new Habit',
    }),
    ApiBody({ type: CreateHabitDto }),
    ApiResponse({ status: 201, description: 'Habit created successfully' }),
  );
}

export function UpdateHabitDocs() {
  return applyDecorators(
    ApiOperation({ summary: 'Update an existing habit' }),
    ApiParam({ name: 'id', description: 'Habit ID' }),
    ApiBody({ type: UpdateHabitDto }),
    ApiResponse({ status: 200, description: 'Habit updated successfully' }),
    ApiResponse({ status: 404, description: 'Habit not found' }),
  );
}

export function DeleteHabitDocs() {
  return applyDecorators(
    ApiOperation({ summary: 'Delete a habit' }),
    ApiParam({ name: 'id', description: 'Habit ID' }),
    ApiResponse({ status: 200, description: 'Habit deleted successfully' }),
    ApiResponse({ status: 404, description: 'Habit not found' }),
  );
}

export function ToggleCompletionDocs() {
  return applyDecorators(
    ApiOperation({ summary: 'Toggle completion status for a specific date' }),
    ApiParam({ name: 'id', description: 'Habit ID' }),
    ApiBody({ type: ToggleCompletionDto }),
    ApiResponse({
      status: 200,
      description: 'Completion toggled successfully',
    }),
  );
}
