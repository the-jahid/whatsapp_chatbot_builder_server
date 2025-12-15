import { Module } from '@nestjs/common';
import { CalendarConnectionController } from './calendar-connection.controller';
import { CalendarConnectionService } from './calendar-connection.service';
import { UserModule } from 'src/user/user.module';

@Module({
  imports: [UserModule],
  controllers: [CalendarConnectionController],
  providers: [CalendarConnectionService], // PrismaService and UserService are available globally, no need to provide them here
  exports: [CalendarConnectionService],
})
export class CalendarConnectionModule { }
