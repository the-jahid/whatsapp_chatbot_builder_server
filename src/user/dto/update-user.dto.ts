import { createZodDto } from 'nestjs-zod';
import { updateUserSchema } from '../schemas/user.schema';


export class UpdateUserDto extends createZodDto(updateUserSchema) {}

// Re-export the schema for use in controllers
export { updateUserSchema };

