import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module.js';
import { StaffController } from './staff.controller.js';
import { StaffService } from './staff.service.js';

@Module({
  // Attendance is worked out from the punches kept by the attendance module.
  imports: [AttendanceModule],
  controllers: [StaffController],
  providers: [StaffService],
})
export class StaffModule {}
