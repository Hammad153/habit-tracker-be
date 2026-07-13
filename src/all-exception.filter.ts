import {
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Request, Response } from 'express';
import { MyLoggerService } from '../log/my-logger/my-logger.service';
import { PrismaClientValidationError } from '@prisma/client/runtime/client';

@Catch()
export class AllExceptionFilter extends BaseExceptionFilter {
  private readonly logger = new MyLoggerService(AllExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal Server Error';
    let code: string | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();

      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object') {
        message = (res as any).message || JSON.stringify(res);
        code = (res as any).code;
      }
    } else if (exception instanceof PrismaClientValidationError) {
      status = 422;
      message = exception.message.replace(/\n/g, '');
    } else if (exception instanceof Error) {
      message = exception.message || message;
    }

    const responsePayload = {
      statusCode: status,
      ...(code ? { code } : {}),
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
    };

    response.status(status).json(responsePayload);

    // 📜 Log it
    this.logger.error(
      `${status} - ${message} - ${request.method} ${request.url}`,
      AllExceptionFilter.name,
    );
  }
}

export { AllExceptionFilter as AllExcenptionFilter };
