// src/blog/blog.module.ts
import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import * as multer from 'multer';
import { BlogController } from './controllers/blog.controller';
import { BlogService } from './services/blog.service';

@Module({
    imports: [
        MulterModule.register({
            storage: multer.memoryStorage(),
            limits: {
                fileSize: 10 * 1024 * 1024, // 10 MB max for blog images
            },
        }),
    ],
    controllers: [BlogController],
    providers: [BlogService],
    exports: [BlogService],
})
export class BlogModule { }
