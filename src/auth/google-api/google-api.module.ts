import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GoogleApiService } from './google-api.service';

@Module({
  // Import the ConfigModule so the GoogleApiService can access environment variables.
  imports: [ConfigModule],
  // Register GoogleApiService as a provider within this module.
  providers: [GoogleApiService],
  // Export GoogleApiService to make it available for dependency injection in other modules.
  exports: [GoogleApiService],
})

export class GoogleApiModule {}





