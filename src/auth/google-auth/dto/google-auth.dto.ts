import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

// ============================================================================
// Request DTOs
// ============================================================================

/**
 * Request body for Google OAuth callback
 */
export class GoogleCallbackDto {
    @ApiProperty({
        description: 'The authorization code received from Google OAuth redirect',
        example: '4/0AXEy...',
    })
    @IsString()
    @IsNotEmpty()
    code: string;
}

// ============================================================================
// Response DTOs
// ============================================================================

/**
 * Response for GET /auth/google/url
 */
export class GoogleAuthUrlResponseDto {
    @ApiProperty({
        description: 'The Google OAuth authorization URL to redirect the user to',
        example: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=...',
    })
    url: string;
}

/**
 * Response for successful Google OAuth callback
 */
export class GoogleCallbackResponseDto {
    @ApiProperty({
        description: 'Success message',
        example: 'Google account connected successfully',
    })
    message: string;

    @ApiProperty({
        description: 'The connected user ID',
        example: 'user_2abc123...',
    })
    userId: string;
}

/**
 * Standard error response shape
 */
export class AuthErrorResponseDto {
    @ApiProperty({
        description: 'HTTP status code',
        example: 401,
    })
    statusCode: number;

    @ApiProperty({
        description: 'Error message',
        example: 'Unauthorized',
    })
    message: string;

    @ApiProperty({
        description: 'Error type',
        example: 'Unauthorized',
        required: false,
    })
    error?: string;
}
