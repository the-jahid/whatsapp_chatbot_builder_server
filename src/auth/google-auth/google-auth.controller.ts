import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  ValidationPipe,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { GoogleAuthService } from './google-auth.service';
import { ClerkAuthGuard } from '../clerk-auth.guard';
import { UserService } from 'src/user/services/user.service';
import type { Request } from 'express';
import {
  GoogleCallbackDto,
  GoogleAuthUrlResponseDto,
  GoogleCallbackResponseDto,
  AuthErrorResponseDto,
} from './dto/google-auth.dto';

type ReqWithAuth = Request & {
  auth?: {
    clerkUserId?: string;
    sessionId?: string;
  };
};

@ApiTags('Authentication')
@Controller('auth')
export class GoogleAuthController {
  constructor(
    private readonly googleAuthService: GoogleAuthService,
    private readonly userService: UserService,
  ) { }

  /**
   * GET /auth/google/url
   * This endpoint initiates the Google OAuth flow. It returns a URL
   * that the frontend should redirect the user to.
   */
  @Get('google/url')
  @ApiOperation({
    summary: 'Get Google OAuth URL',
    description:
      'Generates and returns the Google OAuth authorization URL. Redirect the user to this URL to initiate the OAuth flow.',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully generated Google OAuth URL',
    type: GoogleAuthUrlResponseDto,
  })
  getGoogleAuthUrl(): GoogleAuthUrlResponseDto {
    const url = this.googleAuthService.generateAuthUrl();
    return { url };
  }

  /**
   * POST /auth/google/callback
   * This endpoint is hit after the user grants consent on Google's site.
   * It receives the authorization code and exchanges it for tokens.
   */
  @Post('google/callback')
  @UseGuards(ClerkAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Exchange Google OAuth code for tokens',
    description:
      'Exchanges the authorization code from Google for access and refresh tokens. Requires authentication via Clerk session token.',
  })
  @ApiResponse({
    status: 201,
    description: 'Successfully exchanged code and connected Google account',
    type: GoogleCallbackResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Missing or invalid Bearer token',
    type: AuthErrorResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Invalid or expired authorization code',
    type: AuthErrorResponseDto,
  })
  async handleGoogleCallback(
    @Req() req: ReqWithAuth,
    @Body(new ValidationPipe()) body: GoogleCallbackDto,
  ) {
    const me = await this.userService.getFromAuth(req.auth ?? {});

    return this.googleAuthService.exchangeCodeAndSaveConnection(
      body.code,
      me.id,
    );
  }
}

