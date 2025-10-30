// ===================================================
// Controller: src/user/controllers/user.controller.ts
// ===================================================
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { User } from '@prisma/client';

import { UserService } from '../services/user.service';
import {
  CreateUserDto,
  createUserSchema,
  UpdateUserDto,
  updateUserSchema,
} from '../schemas/user.schema';
import { ZodValidationPipe } from 'src/common/pipes/zod.validation.pipe';

// Auth
import { ClerkAuthGuard } from 'src/auth/clerk-auth.guard';
import { Public } from 'src/common/decorators/public.decorator';

type ReqWithAuth = Request & { auth?: { clerkUserId?: string; sessionId?: string } };

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard) // protect all routes by default…
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  // -----------------------------------------------
  // Create (typically via webhooks/admin) — left OPEN
  // -----------------------------------------------
  @Public()
  @Post()
  @ApiOperation({ summary: 'Create a new user (system/webhook/admin)' })
  @ApiCreatedResponse({ description: 'User created.' })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  @ApiConflictResponse({
    description: 'User with same email or OAuth ID already exists.',
  })
  create(
    @Body(new ZodValidationPipe(createUserSchema)) createUserDto: CreateUserDto,
  ): Promise<User> {
    return this.userService.createUser(createUserDto);
  }

  // -----------------------------------------------
  // Me endpoints (auth required)
  // -----------------------------------------------
  @Get('me')
  @ApiOperation({ summary: 'Get my profile (auth required)' })
  @ApiOkResponse({ description: 'Current user returned.' })
  @ApiNotFoundResponse({ description: 'User not found for this session.' })
  async me(@Req() req: ReqWithAuth): Promise<User> {
    const me = await this.userService.getFromAuth(req.auth ?? {});
    if (!me) throw new NotFoundException('User not found for this session.');
    return me;
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update my profile (auth required)' })
  @ApiOkResponse({ description: 'User updated.' })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  @ApiNotFoundResponse({ description: 'User not found for this session.' })
  async updateMe(
    @Req() req: ReqWithAuth,
    @Body(new ZodValidationPipe(updateUserSchema)) dto: UpdateUserDto,
  ): Promise<User> {
    const me = await this.userService.getFromAuth(req.auth ?? {});
    return this.userService.updateUser(me.oauthId, dto);
  }

  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete my profile (auth required)' })
  @ApiNoContentResponse({ description: 'User deleted.' })
  @ApiNotFoundResponse({ description: 'User not found for this session.' })
  async deleteMe(@Req() req: ReqWithAuth): Promise<void> {
    const me = await this.userService.getFromAuth(req.auth ?? {});
    await this.userService.deleteUser(me.oauthId);
  }

  // -----------------------------------------------
  // ID-based endpoints (self-only without roles)
  // -----------------------------------------------
  @Get(':id')
  @ApiOperation({ summary: 'Get a user by ID (self only unless roles added)' })
  @ApiOkResponse({ description: 'User returned.' })
  @ApiNotFoundResponse({ description: 'User not found.' })
  async findOneById(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: ReqWithAuth,
  ): Promise<User> {
    const me = await this.userService.getFromAuth(req.auth ?? {});
    if (me.id !== id) {
      throw new ForbiddenException('You can only access your own profile.');
    }
    return me;
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a user by ID (self only unless roles added)' })
  @ApiOkResponse({ description: 'User updated.' })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  @ApiNotFoundResponse({ description: 'User not found.' })
  async updateById(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: ReqWithAuth,
    @Body(new ZodValidationPipe(updateUserSchema)) dto: UpdateUserDto,
  ): Promise<User> {
    const me = await this.userService.getFromAuth(req.auth ?? {});
    if (me.id !== id) {
      throw new ForbiddenException('You can only update your own profile.');
    }
    return this.userService.updateUser(me.oauthId, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a user by ID (self only unless roles added)' })
  @ApiNoContentResponse({ description: 'User deleted.' })
  @ApiNotFoundResponse({ description: 'User not found.' })
  async deleteById(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: ReqWithAuth,
  ): Promise<void> {
    const me = await this.userService.getFromAuth(req.auth ?? {});
    if (me.id !== id) {
      throw new ForbiddenException('You can only delete your own profile.');
    }
    await this.userService.deleteUser(me.oauthId);
  }
}
