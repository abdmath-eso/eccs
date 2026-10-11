import { HttpException, HttpStatus } from '@nestjs/common';
import { ATTENDANCE_ERROR } from '@eccs/shared';

type Code = (typeof ATTENDANCE_ERROR)[keyof typeof ATTENDANCE_ERROR];

/**
 * An error the app can act on: `code` is what the app reads (and words in the
 * person's own language); `message` is the plain English fallback.
 */
export const attendanceError = (status: HttpStatus, code: Code, message: string, extra: Record<string, unknown> = {}) =>
  new HttpException({ code, message, ...extra }, status);

/** What the app is told about a photo it should take again. Each is a 400: nothing is wrong with the server. */
export const photoError = (code: Code, message: string, extra: Record<string, unknown> = {}) =>
  attendanceError(HttpStatus.BAD_REQUEST, code, message, extra);

export const engineUnavailable = (reason: string | null) =>
  attendanceError(
    HttpStatus.SERVICE_UNAVAILABLE,
    ATTENDANCE_ERROR.engineUnavailable,
    'Face recognition is not available on the server at the moment. Ask the owner or manager to clock you in.',
    // The reason helps whoever runs the server; it says nothing about any person.
    reason ? { reason } : {},
  );
