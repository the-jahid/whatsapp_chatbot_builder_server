import { Module } from '@nestjs/common';
import { GoogleAuthService } from './google-auth.service';
import { GoogleAuthController } from './google-auth.controller';
import { GoogleApiModule } from '../google-api/google-api.module';
import { CalendarConnectionModule } from 'src/CalendarConnection/calendar-connection.module';
import { UserModule } from 'src/user/user.module';


@Module({
  // Import the modules whose exported providers are required by this module.
  imports: [
    GoogleApiModule, // Makes GoogleApiService available.
    CalendarConnectionModule, // Makes CalendarConnectionService available.
    UserModule
  ],
  // Register the controller that defines the API endpoints for this module.
  controllers: [GoogleAuthController],
  // Register the service that contains the business logic.
  providers: [GoogleAuthService],
})

export class GoogleAuthModule {}
