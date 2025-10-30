import { PipeTransform, ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { ZodSchema, ZodError } from 'zod';

/**
 * A custom validation pipe that uses a Zod schema to validate incoming request data.
 * If validation fails, it throws a BadRequestException with a formatted error response.
 */
export class ZodValidationPipe implements PipeTransform {
  constructor(private schema: ZodSchema) {}

  /**
   * Transforms and validates the incoming value against the Zod schema.
   * @param value - The value to be transformed and validated.
   * @param metadata - Metadata about the argument being processed.
   * @returns The validated value.
   * @throws BadRequestException if validation fails.
   */
  transform(value: unknown, metadata: ArgumentMetadata) {
    console.log('=== ZodValidationPipe Debug ===');
    console.log('Metadata type:', metadata.type);
    console.log('Metadata metatype:', metadata.metatype);
    console.log('Raw value type:', typeof value);
    console.log('Raw value:', value);
    
    // If value is undefined or null, log it
    if (value === undefined || value === null) {
      console.log('Value is undefined or null');
    }
    
    // Check if it's a Buffer or other special type
    if (Buffer.isBuffer(value)) {
      console.log('Value is a Buffer, converting to string');
      value = value.toString();
    }
    
    // Log the exact string representation
    if (typeof value === 'string') {
      console.log('String length:', value.length);
      console.log('First 100 chars:', value.substring(0, 100));
      console.log('String starts with {:', value.trim().startsWith('{'));
      console.log('String starts with ":', value.startsWith('"'));
    }
    
    try {
      // Handle string values that might be JSON
      let valueToValidate = value;
      
      // Only process Body arguments for potential JSON parsing
      if (metadata.type === 'body' && typeof value === 'string' && value.trim()) {
        console.log('Attempting to parse string as JSON...');
        try {
          valueToValidate = JSON.parse(value);
          console.log('Successfully parsed JSON:', valueToValidate);
        } catch (e) {
          console.log('JSON parse error:', e.message);
          // Try to clean the string and parse again
          const cleaned = value.trim();
          if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
            // It might be a double-encoded string
            try {
              const unquoted = JSON.parse(cleaned);
              console.log('String was double-quoted, unquoted to:', unquoted);
              if (typeof unquoted === 'string') {
                valueToValidate = JSON.parse(unquoted);
                console.log('Successfully parsed double-encoded JSON:', valueToValidate);
              }
            } catch (e2) {
              console.log('Double-decode attempt failed:', e2.message);
            }
          }
        }
      }
      
      console.log('Final value to validate type:', typeof valueToValidate);
      console.log('Final value to validate:', valueToValidate);
      
      // Attempt to parse and validate the value using the provided schema.
      const parsedValue = this.schema.parse(valueToValidate);
      console.log('Validation successful, parsed value:', parsedValue);
      return parsedValue;
    } catch (error) {
      console.log('Validation error:', error);
      // If the error is a ZodError, format it into a user-friendly response.
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
      // For any other type of error, throw a generic bad request exception.
      throw new BadRequestException('Invalid input data');
    }
  }
}
