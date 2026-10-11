import { Logger, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { env } from '../config/env.js';
import { AttendanceClock } from './attendance-clock.js';
import { AttendanceController } from './attendance.controller.js';
import { AttendanceService } from './attendance.service.js';
import { AuditTrailService } from './audit-trail.service.js';
import { ClockService } from './clock.service.js';
import { FaceController } from './face.controller.js';
import { FaceService } from './face.service.js';
import { FACE_ENGINE, OffFaceEngine, type FaceEngine } from './face/face-engine.js';
import { FakeFaceEngine } from './face/fake-face-engine.js';
import { OnnxFaceEngine } from './face/onnx-face-engine.js';

/**
 * Attendance by face: clocking in and out on the outlet's linked phone, the
 * Owner's corrections, and enrolling a person's face.
 *
 * Which engine recognises faces is chosen once, when the API starts, from
 * FACE_ENGINE: the real models on this server ("onnx", the default), nothing
 * ("off"), or the stand-in the automated tests use ("fake"). If the real
 * models are missing the API still starts; the face endpoints then answer 503
 * and the assisted route keeps working.
 */
@Module({
  imports: [AuthModule],
  controllers: [AttendanceController, FaceController],
  providers: [
    AttendanceClock,
    AuditTrailService,
    AttendanceService,
    FaceService,
    ClockService,
    {
      provide: FACE_ENGINE,
      useFactory: async (): Promise<FaceEngine> => {
        const which = env.FACE_ENGINE ?? (env.NODE_ENV === 'test' ? 'fake' : 'onnx');
        if (which === 'fake') return new FakeFaceEngine();
        if (which === 'off') return new OffFaceEngine();
        const engine = await new OnnxFaceEngine().load();
        const logger = new Logger('FaceEngine');
        if (engine.ready) logger.log(`Face models loaded (${engine.modelId})`);
        else logger.warn(`Face recognition is not available: ${engine.reason}. Clocking in works through the assisted route only.`);
        return engine;
      },
    },
  ],
  // The staff screens read attendance, and marking someone as left deletes their face templates.
  exports: [AttendanceClock, AuditTrailService, AttendanceService, FaceService],
})
export class AttendanceModule {}
