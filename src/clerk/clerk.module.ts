import { Module } from '@nestjs/common';
import { ClerkController } from './clerk.controller';
import { ClerkService } from './clerk.service';
import { UserModule } from '../user/user.module'; // Import UserModule to get access to UserService

@Module({
  imports: [UserModule], // Import the module that provides UserService
  controllers: [ClerkController],
  providers: [ClerkService],
})

export class ClerkModule {}


