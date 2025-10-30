import { BadRequestException, createParamDecorator, ExecutionContext } from '@nestjs/common';
import { ZodError, ZodSchema } from 'zod';

export const ValidatedBody = createParamDecorator(
  (schema: ZodSchema, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const body = request.body;
    
    try {
      return schema.parse(body);
    } catch (error) {
      if (error instanceof ZodError) {
        const formattedErrors = error.errors.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
        }));
        throw new BadRequestException({
          statusCode: 400,
          message: 'Validation failed',
          errors: formattedErrors,
        });
      }
      throw new BadRequestException('Invalid input data');
    }
  },
);