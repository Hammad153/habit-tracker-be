import { applyDecorators } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';

export function FindAllAwardsDocs() {
  return applyDecorators(
    ApiOperation({ summary: 'Get all available awards/badges' }),
    ApiResponse({ status: 200, description: 'Return all available awards' }),
  );
}

export function FindUserBadgesDocs() {
  return applyDecorators(
    ApiOperation({ summary: 'Get all badges earned by a user' }),
    ApiQuery({
      name: 'userId',
      required: false,
      description: 'ID of the user',
    }),
    ApiResponse({ status: 200, description: 'Return all badges for the user' }),
  );
}

export function FindOneAwardDocs() {
  return applyDecorators(
    ApiOperation({ summary: 'Get a single award/badge by ID' }),
    ApiParam({ name: 'id', description: 'Award ID' }),
    ApiResponse({ status: 200, description: 'Return the award' }),
    ApiResponse({ status: 404, description: 'Award not found' }),
  );
}
