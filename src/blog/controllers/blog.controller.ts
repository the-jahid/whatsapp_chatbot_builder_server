// src/blog/controllers/blog.controller.ts
import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    Query,
    Req,
    Res,
    UseGuards,
    UseInterceptors,
    UploadedFile as UploadedFileDecorator,
    ParseFilePipe,
    MaxFileSizeValidator,
    FileTypeValidator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
    ApiBadRequestResponse,
    ApiBearerAuth,
    ApiConsumes,
    ApiCreatedResponse,
    ApiNoContentResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiQuery,
    ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { BlogService } from '../services/blog.service';
import {
    CreateBlogDto,
    createBlogSchema,
    UpdateBlogDto,
    updateBlogSchema,
    QueryBlogsDto,
    queryBlogsSchema,
    UploadedFile,
    BlogPublic,
} from '../dto/blog.dto';
import { ZodValidationPipe } from 'src/common/pipes/zod.validation.pipe';
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';
import { Public } from 'src/common/decorators/public.decorator';

type ReqWithAuth = Request & { auth?: { clerkUserId?: string; sessionId?: string } };

// Minimal Multer file type
type MulterFileLite = {
    buffer: Buffer;
    mimetype: string;
    originalname: string;
    size: number;
};

@ApiTags('blogs')
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard)
@Controller('blogs')
export class BlogController {
    constructor(private readonly blogService: BlogService) { }

    private toUploadedFile(file?: MulterFileLite | null): UploadedFile | undefined {
        if (!file) return undefined;
        return {
            buffer: file.buffer,
            mimetype: file.mimetype,
            originalname: file.originalname,
            size: file.size,
        };
    }

    // ===========================
    // Blog Endpoints
    // ===========================

    @Post()
    @UseInterceptors(FileInterceptor('image'))
    @ApiConsumes('multipart/form-data')
    @ApiOperation({ summary: 'Create a new blog post with optional image (auth required)' })
    @ApiCreatedResponse({ description: 'Blog created successfully.' })
    @ApiBadRequestResponse({ description: 'Validation failed.' })
    async createBlog(
        @Req() req: ReqWithAuth,
        @Body() body: any,
        @UploadedFileDecorator(
            new ParseFilePipe({
                fileIsRequired: false,
                validators: [
                    new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 }), // 10MB
                    new FileTypeValidator({ fileType: /image\/(jpeg|png|gif|webp)/ }),
                ],
            }),
        )
        file?: MulterFileLite,
    ): Promise<BlogPublic> {
        const oauthId = req.auth?.clerkUserId;
        if (!oauthId) throw new Error('Unauthorized');

        // Manually validate with Zod since we're using multipart
        const dto = createBlogSchema.parse({ title: body.title, content: body.content });
        return this.blogService.createBlog(oauthId, dto, this.toUploadedFile(file));
    }

    @Public()
    @Get()
    @ApiOperation({ summary: 'Get all blogs (public)' })
    @ApiOkResponse({ description: 'List of blogs.' })
    @ApiQuery({ name: 'page', required: false, type: Number })
    @ApiQuery({ name: 'limit', required: false, type: Number })
    @ApiQuery({ name: 'search', required: false, type: String })
    async findAllBlogs(
        @Query(new ZodValidationPipe(queryBlogsSchema)) query: QueryBlogsDto,
    ): Promise<{ blogs: BlogPublic[]; total: number; page: number; limit: number }> {
        return this.blogService.findAllBlogs(query);
    }

    @Get('my')
    @ApiOperation({ summary: 'Get my blogs (auth required)' })
    @ApiOkResponse({ description: 'List of user blogs.' })
    @ApiQuery({ name: 'page', required: false, type: Number })
    @ApiQuery({ name: 'limit', required: false, type: Number })
    async findMyBlogs(
        @Req() req: ReqWithAuth,
        @Query(new ZodValidationPipe(queryBlogsSchema)) query: QueryBlogsDto,
    ): Promise<{ blogs: BlogPublic[]; total: number; page: number; limit: number }> {
        const oauthId = req.auth?.clerkUserId;
        if (!oauthId) throw new Error('Unauthorized');
        return this.blogService.findBlogsByOauthId(oauthId, query);
    }

    @Public()
    @Get(':id')
    @ApiOperation({ summary: 'Get a blog by ID (public)' })
    @ApiOkResponse({ description: 'Blog found.' })
    @ApiNotFoundResponse({ description: 'Blog not found.' })
    async findById(@Param('id', ParseUUIDPipe) id: string): Promise<BlogPublic> {
        const blog = await this.blogService.findBlogById(id);
        await this.blogService.incrementViewCount(id);
        return blog;
    }

    @Public()
    @Get(':id/image')
    @HttpCode(200)
    @ApiOperation({ summary: 'Get blog image (public)' })
    @ApiOkResponse({ description: 'Image binary.' })
    @ApiNotFoundResponse({ description: 'Image not found.' })
    async getImage(
        @Param('id', ParseUUIDPipe) id: string,
        @Res() res: Response,
    ): Promise<void> {
        const { buffer, mimeType, fileName } = await this.blogService.getImage(id);
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Length', Buffer.byteLength(buffer).toString());
        res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
        res.end(buffer);
    }

    @Patch(':id')
    @UseInterceptors(FileInterceptor('image'))
    @ApiConsumes('multipart/form-data')
    @ApiOperation({ summary: 'Update a blog with optional new image (auth required, author only)' })
    @ApiOkResponse({ description: 'Blog updated.' })
    @ApiBadRequestResponse({ description: 'Validation failed.' })
    @ApiNotFoundResponse({ description: 'Blog not found or not owned by user.' })
    async updateBlog(
        @Req() req: ReqWithAuth,
        @Param('id', ParseUUIDPipe) id: string,
        @Body() body: any,
        @UploadedFileDecorator(
            new ParseFilePipe({
                fileIsRequired: false,
                validators: [
                    new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 }),
                    new FileTypeValidator({ fileType: /image\/(jpeg|png|gif|webp)/ }),
                ],
            }),
        )
        file?: MulterFileLite,
    ): Promise<BlogPublic> {
        const oauthId = req.auth?.clerkUserId;
        if (!oauthId) throw new Error('Unauthorized');

        // Manually validate with Zod
        const dto = updateBlogSchema.parse({
            ...(body.title && { title: body.title }),
            ...(body.content && { content: body.content })
        });
        return this.blogService.updateBlog(id, dto, oauthId, this.toUploadedFile(file));
    }

    @Delete(':id/image')
    @ApiOperation({ summary: 'Delete blog image (auth required, author only)' })
    @ApiOkResponse({ description: 'Image deleted.' })
    @ApiNotFoundResponse({ description: 'Blog not found or not owned by user.' })
    async deleteImage(
        @Req() req: ReqWithAuth,
        @Param('id', ParseUUIDPipe) id: string,
    ): Promise<BlogPublic> {
        const oauthId = req.auth?.clerkUserId;
        if (!oauthId) throw new Error('Unauthorized');
        return this.blogService.deleteImage(id, oauthId);
    }

    @Delete(':id')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Delete a blog (auth required, author only)' })
    @ApiNoContentResponse({ description: 'Blog deleted.' })
    @ApiNotFoundResponse({ description: 'Blog not found or not owned by user.' })
    async deleteBlog(
        @Req() req: ReqWithAuth,
        @Param('id', ParseUUIDPipe) id: string,
    ): Promise<void> {
        const oauthId = req.auth?.clerkUserId;
        if (!oauthId) throw new Error('Unauthorized');
        await this.blogService.deleteBlog(id, oauthId);
    }
}
