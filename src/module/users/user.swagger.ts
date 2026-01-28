import { applyDecorators } from '@nestjs/common';
import {
  ApiOperation,
  ApiBody,
  ApiCreatedResponse,
  ApiBadRequestResponse,
  ApiQuery,
  ApiOkResponse,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';

export function ApiCreateUserDocs() {
  return applyDecorators(
    ApiOperation({ summary: 'Create a new user' }),
    ApiBody({
      description: 'Fields required to create a new user',
      schema: {
        type: 'object',
        properties: {
          email: { type: 'string', example: 'john.doe@example.com' },
          password: { type: 'string', example: 'StrongPassword123' },
          name: { type: 'string', example: 'John Doe' },
          role: { type: 'string', example: 'USER' },
        },
        required: ['email', 'password'],
      },
    }),
    ApiCreatedResponse({
      description: 'User created successfully',
      schema: {
        example: {
          id: 'clmb8syd10001a234bcdefghi',
          email: 'john.doe@example.com',
          name: 'John Doe',
          role: 'USER',
          createdAt: '2025-09-14T12:00:00.000Z',
        },
      },
    }),
    ApiBadRequestResponse({ description: 'Invalid input' }),
  );
}

export function ApiGetAllUserDocs() {
  return applyDecorators(
    ApiOperation({ summary: 'Get all users with filters' }),
    ApiQuery({ name: 'skip', required: false, type: Number }),
    ApiQuery({ name: 'take', required: false, type: Number }),
    ApiQuery({ name: 'cursor', required: false, type: String }),
    ApiQuery({ name: 'orderBy', required: false, type: String }),
    ApiQuery({ name: 'role', required: false, type: String }),
    ApiOkResponse({ description: 'Users retrieved successfully' }),
  );
}

export function ApiGetByIdUserDocs() {
  return applyDecorators(
    ApiOperation({ summary: 'Get a single user by ID' }),
    ApiParam({ name: 'id', type: Number }),
    ApiOkResponse({ description: 'User found' }),
    ApiResponse({ status: 404, description: 'User not found' }),
  );
}

export function ApiPatchUserDocs() {
  return applyDecorators(
    ApiOperation({ summary: 'Update a user by ID' }),
    ApiParam({ name: 'id', type: Number }),
    ApiOkResponse({ description: 'User updated successfully' }),
  );
}

export function ApiDeleteUserDocs() {
  return applyDecorators(
    ApiOperation({ summary: 'Delete a user by ID' }),
    ApiParam({ name: 'id', type: Number }),
    ApiOkResponse({ description: 'User deleted successfully' }),
    ApiResponse({ status: 404, description: 'User not found' }),
  );
}
