import { applyDecorators } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { SignUpDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';

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
    ApiOperation({
      summary: 'Login to get access and refresh tokens',
    }),

    ApiBody({
      type: LoginDto,
      required: true,
    }),

    ApiResponse({
      status: 200,
      description: 'User successfully Login',
      schema: {
        example: {
          id: 1,
          email: 'john.doe@example.com',
          accessToken: 'your-access-token',
          refreshToken: 'your-refresh-token',
        },
      },
    }),

    ApiResponse({
      status: 401,
      description: 'Failed to login',
      schema: {
        example: {
          statusCode: 401,
          message: 'Failed to login',
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
