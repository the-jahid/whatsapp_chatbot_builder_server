import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { GoogleApiService } from '../google-api/google-api.service';

import { CalendarProvider } from '@prisma/client';
import { Credentials } from 'google-auth-library';
import { CalendarConnectionService } from 'src/CalendarConnection/calendar-connection.service';
import { CreateCalendarConnectionDto } from 'src/CalendarConnection/dto/calendar-connection.dto';


@Injectable()
export class GoogleAuthService {
  private readonly logger = new Logger(GoogleAuthService.name);

  constructor(
    private readonly googleApiService: GoogleApiService,
    private readonly connectionService: CalendarConnectionService,
  ) {}

  /**
   * Generates the Google Authentication URL by calling the GoogleApiService.
   * @returns The URL for the Google consent screen.
   */
  generateAuthUrl(): string {
    return this.googleApiService.getAuthUrl();
  }

  /**
   * Handles the final step of the OAuth flow.
   * It exchanges the authorization code for tokens, gets the user's profile,
   * and saves the new calendar connection to the database.
   * @param code The authorization code from Google's redirect.
   * @param userId The ID of the user initiating the connection.
   * @returns A success message object.
   */
  async exchangeCodeAndSaveConnection(code: string, userId: string) {
    try {
      // Step 1: Exchange the authorization code for tokens.
      this.logger.log(`Exchanging authorization code for tokens for user: ${userId}`);
      const tokens: Credentials = await this.googleApiService.getTokensFromCode(code);

      // Validate that we received all necessary token information from Google.
      if (!tokens.access_token || !tokens.refresh_token || !tokens.expiry_date) {
        throw new Error('Incomplete token data received from Google.');
      }

      // Step 2: Use the new access token to get the user's Google profile.
      this.logger.log(`Fetching Google profile for user: ${userId}`);
      const profile = await this.googleApiService.getUserProfile(tokens.access_token);
      if (!profile.email) {
        throw new Error('Could not retrieve email from Google profile.');
      }

      // Step 3: Prepare the DTO and save the new connection to the database.
      this.logger.log(`Saving calendar connection for Google account: ${profile.email}`);
      const connectionDto: CreateCalendarConnectionDto = {
        provider: CalendarProvider.GOOGLE,
        accountEmail: profile.email,
        accessToken: tokens.access_token, // IMPORTANT: Encrypt this in a real app.
        refreshToken: tokens.refresh_token, // IMPORTANT: Encrypt this in a real app.
        accessTokenExpiresAt: new Date(tokens.expiry_date),
        calendarId: 'primary', // Default to 'primary', can be made configurable later.
        userId: userId,
        isPrimary: true, // Set the first connection as primary by default
      }
      
      await this.connectionService.create(connectionDto);

      return { message: 'Google Calendar connected successfully.' };
    } catch (error) {
      this.logger.error(`Failed to connect Google Calendar for user ${userId}:`, error.stack);
      // Throw a generic error to avoid leaking implementation details to the client.
      throw new InternalServerErrorException('A problem occurred while connecting your Google Calendar.');
    }
  }
}
