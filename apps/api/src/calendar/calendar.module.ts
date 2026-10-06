import { Module } from '@nestjs/common';
import { ChecklistsModule } from '../checklists/checklists.module.js';
import { CalendarController } from './calendar.controller.js';
import { CalendarService } from './calendar.service.js';

@Module({
  imports: [ChecklistsModule],
  controllers: [CalendarController],
  providers: [CalendarService],
})
export class CalendarModule {}
