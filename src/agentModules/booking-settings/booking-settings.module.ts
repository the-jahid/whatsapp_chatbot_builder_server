// src/agentModules/booking-settings/booking-settings.module.ts
import { Module } from '@nestjs/common';
import { BookingSettingsController } from './booking-settings.controller';
import { BookingSettingsService } from './booking-settings.service';
import { UserModule } from 'src/user/user.module';


@Module({
  imports: [UserModule],
  controllers: [BookingSettingsController],
  providers: [BookingSettingsService],
  exports: [BookingSettingsService],
})


export class BookingSettingsModule {}



