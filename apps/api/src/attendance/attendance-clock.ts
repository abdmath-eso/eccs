import { Injectable } from '@nestjs/common';
import { attendanceDayOf } from '@eccs/shared';
import { indiaDate } from '../checklists/checklists.service.js';
import { env } from '../config/env.js';

/**
 * The time, for everything to do with attendance. A punch is stamped with the
 * SERVER's time, never the phone's, because a phone's clock can be changed and
 * pay is worked out from these times.
 *
 * It is its own small class for one reason: the automated tests need to ask
 * "what happens at 1 am", or "the next morning", without waiting. They move
 * this clock; nothing else can (it refuses outside tests).
 */
@Injectable()
export class AttendanceClock {
  private fixed: number | null = null;

  now(): Date {
    return new Date(this.fixed ?? Date.now());
  }

  /** The calendar date in India. */
  date(): string {
    return indiaDate(this.now());
  }

  /** The attendance day now: before 4 am it is still yesterday's. */
  day(): string {
    return attendanceDayOf(this.now());
  }

  /** Tests only: stop the clock at a moment, or pass null to let it run again. */
  setForTest(at: Date | null): void {
    if (env.NODE_ENV !== 'test') throw new Error('The attendance clock can only be set in tests');
    this.fixed = at ? at.getTime() : null;
  }
}
