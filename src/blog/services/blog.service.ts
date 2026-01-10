// src/blog/services/blog.service.ts
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Blog, Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateBlogDto, UpdateBlogDto, QueryBlogsDto, UploadedFile, BlogPublic } from '../dto/blog.dto';

@Injectable()
export class BlogService {
    constructor(private prisma: PrismaService) { }

    // Convert Blog to BlogPublic (without binary data)
    private toPublic(blog: Blog): BlogPublic {
        return {
            id: blog.id,
            title: blog.title,
            content: blog.content,
            viewCount: blog.viewCount,
            createdAt: blog.createdAt,
            updatedAt: blog.updatedAt,
            oauthId: blog.oauthId,
            hasImage: !!blog.imageData,
            imageMimeType: blog.imageMimeType,
            imageFileName: blog.imageFileName,
            imageSize: blog.imageSize,
        };
    }

    // ===========================
    // Blog CRUD
    // ===========================

    async createBlog(oauthId: string, data: CreateBlogDto, file?: UploadedFile): Promise<BlogPublic> {
        const blog = await this.prisma.blog.create({
            data: {
                ...data,
                oauthId,
                ...(file && {
                    imageData: file.buffer as any,
                    imageMimeType: file.mimetype,
                    imageFileName: file.originalname,
                    imageSize: file.size,
                }),
            },
        });
        return this.toPublic(blog);
    }

    async findAllBlogs(query: QueryBlogsDto): Promise<{ blogs: BlogPublic[]; total: number; page: number; limit: number }> {
        const { page, limit, oauthId, search } = query;
        const skip = (page - 1) * limit;

        const where: Prisma.BlogWhereInput = {
            ...(oauthId && { oauthId }),
            ...(search && {
                OR: [
                    { title: { contains: search, mode: 'insensitive' } },
                    { content: { contains: search, mode: 'insensitive' } },
                ],
            }),
        };

        const [blogs, total] = await Promise.all([
            this.prisma.blog.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
            }),
            this.prisma.blog.count({ where }),
        ]);

        return { blogs: blogs.map(b => this.toPublic(b)), total, page, limit };
    }

    async findBlogById(id: string): Promise<BlogPublic> {
        const blog = await this.prisma.blog.findUnique({ where: { id } });
        if (!blog) throw new NotFoundException(`Blog with ID "${id}" not found.`);
        return this.toPublic(blog);
    }

    async findBlogsByOauthId(oauthId: string, query: QueryBlogsDto): Promise<{ blogs: BlogPublic[]; total: number; page: number; limit: number }> {
        return this.findAllBlogs({ ...query, oauthId });
    }

    async updateBlog(id: string, data: UpdateBlogDto, oauthId: string, file?: UploadedFile): Promise<BlogPublic> {
        const blog = await this.prisma.blog.findUnique({ where: { id } });
        if (!blog) throw new NotFoundException(`Blog with ID "${id}" not found.`);

        // Only author can update their own blog
        if (blog.oauthId !== oauthId) {
            throw new NotFoundException(`Blog with ID "${id}" not found.`);
        }

        const updated = await this.prisma.blog.update({
            where: { id },
            data: {
                ...data,
                ...(file && {
                    imageData: file.buffer as any,
                    imageMimeType: file.mimetype,
                    imageFileName: file.originalname,
                    imageSize: file.size,
                }),
            },
        });
        return this.toPublic(updated);
    }

    async deleteBlog(id: string, oauthId: string): Promise<void> {
        const blog = await this.prisma.blog.findUnique({ where: { id } });
        if (!blog) throw new NotFoundException(`Blog with ID "${id}" not found.`);

        // Only author can delete their own blog
        if (blog.oauthId !== oauthId) {
            throw new NotFoundException(`Blog with ID "${id}" not found.`);
        }

        await this.prisma.blog.delete({ where: { id } });
    }

    async incrementViewCount(id: string): Promise<void> {
        await this.prisma.blog.update({
            where: { id },
            data: { viewCount: { increment: 1 } },
        });
    }

    // ===========================
    // Image Operations
    // ===========================

    async getImage(id: string): Promise<{ buffer: Buffer; mimeType: string; fileName: string }> {
        const blog = await this.prisma.blog.findUnique({
            where: { id },
            select: { imageData: true, imageMimeType: true, imageFileName: true },
        });

        if (!blog || !blog.imageData) {
            throw new NotFoundException(`Blog image not found.`);
        }

        return {
            buffer: Buffer.from(blog.imageData),
            mimeType: blog.imageMimeType || 'image/jpeg',
            fileName: blog.imageFileName || 'image',
        };
    }

    async deleteImage(id: string, oauthId: string): Promise<BlogPublic> {
        const blog = await this.prisma.blog.findUnique({ where: { id } });
        if (!blog) throw new NotFoundException(`Blog with ID "${id}" not found.`);

        if (blog.oauthId !== oauthId) {
            throw new NotFoundException(`Blog with ID "${id}" not found.`);
        }

        const updated = await this.prisma.blog.update({
            where: { id },
            data: {
                imageData: null,
                imageMimeType: null,
                imageFileName: null,
                imageSize: null,
            },
        });
        return this.toPublic(updated);
    }
}
