import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// CORRECTED: Import OAuth2Client directly.
import { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';

@Injectable()
export class GoogleApiService {
  private readonly logger = new Logger(GoogleApiService.name);
  // CORRECTED: Use the imported OAuth2Client type directly.
  private oauthClient: OAuth2Client;

  constructor() {
    const clientId = '1005621406349-kamen9nl3j7bh7r9rp0acu98m6ka6l71.apps.googleusercontent.com'
    const clientSecret = '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'
    const redirectUri =  'http://localhost:3001/google'

    console.log('clie', clientId, clientSecret, redirectUri)

    

    this.oauthClient = new google.auth.OAuth2(
      clientId,
      clientSecret,
      redirectUri,
    );
  }

  /**
   * Generates the URL for Google's consent screen.
   * @returns The authorization URL.
   */
  getAuthUrl(): string {
    const scopes = [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ];

    

    return this.oauthClient.generateAuthUrl({
      access_type: 'offline', // Required to get a refresh token
      prompt: 'consent', // Ensures the user is always prompted for consent
      scope: scopes,
    });
  }

  /**
   * Exchanges an authorization code for access and refresh tokens.
   * @param code The authorization code from Google's redirect.
   * @returns An object containing the tokens.
   */
  async getTokensFromCode(code: string) {
    try {
      const { tokens } = await this.oauthClient.getToken(code);
      return tokens;
    } catch (error) {
      this.logger.error('Failed to retrieve tokens from code', error);
      throw new Error('Could not exchange code for tokens.');
    }
  }

  /**
   * Retrieves the user's profile information using an access token.
   * This method is stateless and safe for concurrent requests.
   * @param accessToken The user's access token.
   * @returns The user's profile data.
   */
  async getUserProfile(accessToken: string) {
    try {
      // Create a temporary, request-specific client to avoid race conditions.
      const requestClient = new google.auth.OAuth2();
      requestClient.setCredentials({ access_token: accessToken });

      const oauth2 = google.oauth2({
        auth: requestClient,
        version: 'v2',
      });
      const { data } = await oauth2.userinfo.get();
      return data;
    } catch (error) {
      this.logger.error('Failed to retrieve user profile', error);
      throw new Error('Could not retrieve user profile.');
    }
  }

  /**
   * Gets a new access token using a refresh token.
   * This method is stateless and safe for concurrent requests.
   * @param refreshToken The stored refresh token for the user.
   * @returns The new access token.
   */
  async getNewAccessToken(refreshToken: string) {
    try {
      // Create a temporary, request-specific client from the main template.
      // This inherits the clientID and clientSecret without mutating the shared instance.
      const requestClient = new google.auth.OAuth2(
        this.oauthClient._clientId,
        this.oauthClient._clientSecret,
      );
      requestClient.setCredentials({ refresh_token: refreshToken });

      const { credentials } = await requestClient.refreshAccessToken();
      return credentials.access_token;
    } catch (error) {
      this.logger.error('Failed to refresh access token', error);
      throw new Error('Could not refresh access token.');
    }
  }
}
