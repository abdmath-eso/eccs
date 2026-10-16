import { ApiError } from '@eccs/api-client';
import type { MessageKey, Translator } from '@eccs/i18n';
import { ATTENDANCE_ERROR, LEGAL_ERROR } from '@eccs/shared';

/**
 * Turns a failed API call into a message in the user's language.
 * `byStatus` maps HTTP statuses that have a specific meaning on this screen.
 */
const BUDDY_ERRORS: Record<string, MessageKey> = {
  BUDDY_NOT_ALLOWED: 'buddy.error.BUDDY_NOT_ALLOWED',
  BUDDY_CARD_USED: 'buddy.error.BUDDY_CARD_USED',
  BUDDY_CARD_EXPIRED: 'buddy.error.BUDDY_CARD_EXPIRED',
  BUDDY_CARD_CANCELLED: 'buddy.error.BUDDY_CARD_CANCELLED',
  BUDDY_CARD_BUSY: 'buddy.error.BUDDY_CARD_BUSY',
  BUDDY_CARD_NOT_FOUND: 'buddy.error.BUDDY_CARD_NOT_FOUND',
};

export function errorMessage(error: unknown, t: Translator, byStatus: Partial<Record<number, MessageKey>> = {}): string {
  if (error instanceof ApiError) {
    if (error.isNetworkError) return t('error.network');
    const key = byStatus[error.status];
    if (key) return t(key);
    // Say what kind of failure it was, where the server's answer tells us.
    // A person's own attendance, pay or staff record, which only the Owner can change.
    if (error.code === ATTENDANCE_ERROR.ownRecord) return t('team.self.locked');
    // The terms must be agreed to first. The session opens the acceptance screen by
    // itself (see session.tsx), so this sentence only shows for a moment, if at all.
    if (error.code === LEGAL_ERROR.notAccepted) return t('legal.error.notAccepted');
    // ECCS Buddy: only for the Owner and the Manager; a card used, run out, cancelled or busy.
    if (error.code && error.code in BUDDY_ERRORS) return t(BUDDY_ERRORS[error.code]!);
    if (error.status === 429) return t('error.tooMany');
    if (error.status === 403) return t('error.notAllowed');
    if (error.status >= 500) return t('error.server');
  }
  return t('error.generic');
}
