import { createZodDto } from 'nestjs-zod';
import { createUserSchema } from '../schemas/user.schema';


export class CreateUserDto extends createZodDto(createUserSchema) {}

// Re-export the schema for use in controllers
export { createUserSchema };