import { Module } from '@nestjs/common';
import { AppointmentLeadItemController } from './appointment-lead-item.controller';
import { AppointmentLeadItemService } from './appointment-lead-item.service';


@Module({
  controllers: [AppointmentLeadItemController],
  providers: [AppointmentLeadItemService],
  exports: [AppointmentLeadItemService],
})
export class AppointmentLeadItemModule {}
