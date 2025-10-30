import {
  Controller,
  Post,
  Patch,
  Put,
  Delete,
  Get,
  Query,
  Param,
  Body,
  UseInterceptors,
  HttpCode,
  Res,
  UploadedFile as UploadedFileDecorator,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';

import {
  OutboundTemplateService,
  type UploadedFile as ServiceUploadedFile,
} from './outbound-template.service';
import type { CreateTemplateDto } from './dto/create-template.dto';
import type { UpdateTemplateDto } from './dto/update-template.dto';
import type { QueryTemplatesDto } from './dto/query-templates.dto';
import type { TemplatePublic } from './interface/template.interface';

// Minimal shape we need from Multer file (avoid Express.Multer types)
type MulterFileLite = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
};

@Controller('outbound/templates')
export class OutboundTemplateController {
  constructor(private readonly service: OutboundTemplateService) {}

  /** Cast Multer file -> service's UploadedFile shape */
  private toUploadedFile(file?: MulterFileLite | null): ServiceUploadedFile | undefined {
    if (!file) return undefined;
    return {
      buffer: file.buffer,
      mimetype: file.mimetype,
      originalname: file.originalname,
      size: file.size,
    };
  }

  /** Create template (optional media: image/video/document) */
  @Post()
  @UseInterceptors(FileInterceptor('media'))
  async create(
    @Body() body: CreateTemplateDto,
    @UploadedFileDecorator(
      new ParseFilePipe({
        fileIsRequired: false,
        validators: [
          // Hard cap; service enforces stricter per-type limits
          new MaxFileSizeValidator({ maxSize: 100 * 1024 * 1024 }),
          new FileTypeValidator({ fileType: /(image|video|application)\/.*/ }),
        ],
      }),
    )
    file?: MulterFileLite,
  ): Promise<TemplatePublic> {
    return this.service.create(body, this.toUploadedFile(file));
  }

  /** Update non-media fields */
  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: UpdateTemplateDto): Promise<TemplatePublic> {
    return this.service.update(id, body);
  }

  /** Replace media buffer */
  @Put(':id/media')
  @UseInterceptors(FileInterceptor('media'))
  async replaceMedia(
    @Param('id') id: string,
    @UploadedFileDecorator(
      new ParseFilePipe({
        fileIsRequired: true,
        validators: [
          new MaxFileSizeValidator({ maxSize: 100 * 1024 * 1024 }),
          new FileTypeValidator({ fileType: /(image|video|application)\/.*/ }),
        ],
      }),
    )
    file: MulterFileLite,
  ): Promise<TemplatePublic> {
    return this.service.replaceMedia(id, this.toUploadedFile(file));
  }

  /** Remove media and reset media fields */
  @Delete(':id/media')
  async clearMedia(@Param('id') id: string): Promise<TemplatePublic> {
    return this.service.clearMedia(id);
  }

  /** Public (non-binary) read */
  @Get(':id')
  async get(@Param('id') id: string): Promise<TemplatePublic> {
    return this.service.get(id);
  }

  /** Stream raw media (binary) */
  @Get(':id/media')
  @HttpCode(200)
  async getMedia(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const { buffer, mimeType, fileName } = await this.service.getMediaBinary(id);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', Buffer.byteLength(buffer).toString());
    res.setHeader('Content-Disposition', `inline; filename="${fileName ?? 'media'}"`);
    res.end(buffer);
  }

  /** List with pagination */
  @Get()
  async list(@Query() query: QueryTemplatesDto) {
    return this.service.list(query);
  }

  /** Delete template */
  @Delete(':id')
  @HttpCode(204)
  async delete(@Param('id') id: string): Promise<void> {
    await this.service.delete(id);
  }
}
