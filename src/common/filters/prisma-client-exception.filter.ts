import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpStatus,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';

@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaClientExceptionFilter implements ExceptionFilter {
  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'An internal database error occurred.';

    switch (exception.code) {
      // This is the code for "Unique constraint failed"
      case 'P2002': {
        status = HttpStatus.CONFLICT; // 409 Conflict
        const fields = (exception.meta?.target as string[])?.join(', ');
        message = `An agent with this ${fields} already exists. Please use a different value.`;
        break;
      }
      // This is the code for "Record to update/delete not found"
      case 'P2025': {
        status = HttpStatus.NOT_FOUND; // 404 Not Found
        message = (exception.meta?.cause as string) || 'The requested record does not exist.';
        break;
      }
      // You can add more Prisma error codes here if needed
    }

    response.status(status).json({
      statusCode: status,
      message: message,
    });
  }
}