import { ApiError } from '@eccs/api-client';
import type { MessageKey, Translator } from '@eccs/i18n';

/**
 * Turns a failed API call into a message in the user's language.
 * `byStatus` maps HTTP statuses that have a specific meaning on this screen.
 */
export function errorMessage(error: unknown, t: Translator, byStatus: Partial<Record<number, MessageKey>> = {}): string {
  if (error instanceof ApiError) {
    if (error.isNetworkError) return t('error.network');
    const key = byStatus[error.status];
    if (key) return t(key);
  }
  return t('error.generic');
}
