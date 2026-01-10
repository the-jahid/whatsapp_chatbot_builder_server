// src/blog/dto/blog.dto.ts
import { z } from 'zod';

// ===========================
// Blog DTOs
// ===========================

export const createBlogSchema = z.object({
    title: z.string().min(1, 'Title is required').max(200),
    content: z.string().min(1, 'Content is required'),
});

export const updateBlogSchema = createBlogSchema.partial();

export const queryBlogsSchema = z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(10),
    oauthId: z.string().optional(),
    search: z.string().optional(),
});

export type CreateBlogDto = z.infer<typeof createBlogSchema>;
export type UpdateBlogDto = z.infer<typeof updateBlogSchema>;
export type QueryBlogsDto = z.infer<typeof queryBlogsSchema>;

// Uploaded file type (to avoid Express.Multer types)
export interface UploadedFile {
    buffer: Buffer;
    mimetype: string;
    originalname: string;
    size: number;
}

// Blog response type (without binary data)
export interface BlogPublic {
    id: string;
    title: string;
    content: string;
    viewCount: number;
    createdAt: Date;
    updatedAt: Date;
    oauthId: string;
    hasImage: boolean;
    imageMimeType: string | null;
    imageFileName: string | null;
    imageSize: number | null;
}
