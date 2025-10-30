import { z } from 'zod';

// Schema for creating a user, matching the Prisma model.
export const createUserSchema = z.object({
  email: z
    .string({ required_error: 'Email is required.' })
    .email({ message: 'A valid email address is required.' })
    .trim(),
  oauthId: z
    .string({ required_error: 'OAuth ID is required.' })
    .min(1, { message: 'OAuth ID cannot be empty.' }),
  username: z
    .string()
    .min(3, { message: 'Username must be at least 3 characters.' })
    .optional(), // Matches the optional 'username' in Prisma
});

// Schema for updating a user. Only the username is updatable in this model.
// All fields should be optional for partial updates.
export const updateUserSchema = z.object({
  username: z
    .string()
    .min(3, { message: 'Username must be at least 3 characters.' })
    .optional(),
});

// We infer our TypeScript types directly from the schemas for type safety.
export type CreateUserDto = z.infer<typeof createUserSchema>;
export type UpdateUserDto = z.infer<typeof updateUserSchema>;
