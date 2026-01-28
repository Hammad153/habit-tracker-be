import { applyDecorators } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';
import { SignUpDto } from './dto/signup.dto';

export function ApiProfileDocs() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: 'Get profile of the authenticated user',
      description: `
Requires a **valid Bearer token**.  
Pass the token from \`/auth/login\` in the request header:

\`\`\`
Authorization: Bearer <your-access-token>
\`\`\`
      `,
    }),
    ApiResponse({
      status: 200,
      description: 'Returns the authenticated user profile.',
      schema: {
        example: {
          id: 1,
          email: 'john.doe@example.com',
          role: 'USER',
          createdAt: '2025-09-14T03:30:00.000Z',
        },
      },
    }),
    ApiResponse({
      status: 401,
      description: 'Unauthorized. Missing or invalid token.',
      schema: {
        example: {
          statusCode: 401,
          message: 'Unauthorized',
        },
      },
    }),
  );
}

export function ApiLoginDocs() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiOperation({
      summary: 'Login to get access and refresh tokens',
      description: ``,
    }),
    ApiParam({
      name: 'email',
      description: 'Email of the user',
      required: true,
      type: 'string',
    }),
    ApiParam({
      name: 'password',
      description: 'Password of the user',
      required: true,
      type: 'string',
    }),
    ApiResponse({
      status: 200,
      description: '.',
      schema: {
        example: {
          id: 1,
          email: 'john.doe@example.com',
          role: 'USER',
          createdAt: '2025-09-14T03:30:00.000Z',
        },
      },
    }),
    ApiResponse({
      status: 401,
      description: 'Unauthorized. Missing or invalid token.',
      schema: {
        example: {
          statusCode: 401,
          message: 'Unauthorized',
        },
      },
    }),
  );
}

export function ApiSignUpDocs() {
  return applyDecorators(
    ApiOperation({
      summary: 'Sign up to get access and refresh tokens',
    }),

    ApiBody({
      type: SignUpDto,
      required: true,
    }),

    ApiResponse({
      status: 200,
      description: 'User successfully registered',
      schema: {
        example: {
          id: 1,
          email: 'john.doe@example.com',
          role: 'USER',
          createdAt: '2025-09-14T03:30:00.000Z',
        },
      },
    }),

    ApiResponse({
      status: 401,
      description: 'Unauthorized',
      schema: {
        example: {
          statusCode: 401,
          message: 'Unauthorized',
        },
      },
    }),
  );
}
