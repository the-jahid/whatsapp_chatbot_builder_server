import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  ValidationPipe,
  Req,
} from '@nestjs/common';
import { GoogleAuthService } from './google-auth.service';
import { IsNotEmpty, IsString } from 'class-validator';
import { ClerkAuthGuard } from '../clerk-auth.guard';
import { UserService } from 'src/user/services/user.service';
import type { Request } from 'express';
// NOTE: The following are examples of how you would secure the endpoints.
// You would need to implement your own AuthGuard and a decorator to extract the user.
// import { AuthGuard } from '../auth/auth.guard';
// import { User } from '../auth/user.decorator';

/**
 * A simple DTO class to validate the incoming callback payload.
 */
class GoogleCallbackDto {
  @IsString()
  @IsNotEmpty()
  code: string;
}

type ReqWithAuth = Request & {
  auth?: {
    clerkUserId?: string,
    sessionId?: string
    };
}


@Controller('auth')
// @UseGuards(AuthGuard) // Example: Secure all routes in this controller.
export class GoogleAuthController {
  constructor(
    private readonly googleAuthService: GoogleAuthService,
    private readonly userService:UserService
  ) {}

  /**
   * GET /auth/google/url
   * This endpoint initiates the Google OAuth flow. It returns a URL
   * that the frontend should redirect the user to.
   */
  @Get('google/url')
  getGoogleAuthUrl() {
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
  async handleGoogleCallback(
    @Req() req: ReqWithAuth,
    @Body(new ValidationPipe()) body: GoogleCallbackDto,
    // @User('id') userId: string, // In a real app, get the user ID from the session.
  ) {
    // const userId = '92241b07-63d2-4bff-a9cd-8665cbf56a9e'; // Replace with actual user from request

    const me = await this.userService.getFromAuth(req.auth ?? {});

    

    return this.googleAuthService.exchangeCodeAndSaveConnection(
      body.code,
      me.id,
    );
  }
}





