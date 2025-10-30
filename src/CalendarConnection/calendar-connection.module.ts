import { Module } from '@nestjs/common';
import { CalendarConnectionController } from './calendar-connection.controller';
import { CalendarConnectionService } from './calendar-connection.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { UserService } from 'src/user/services/user.service';

@Module({
  controllers: [CalendarConnectionController],
  providers: [CalendarConnectionService, PrismaService, UserService],
  exports: [CalendarConnectionService],
})
export class CalendarConnectionModule {}
