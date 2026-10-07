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
    // Say what kind of failure it was, where the server's answer tells us.
    if (error.status === 429) return t('error.tooMany');
    if (error.status === 403) return t('error.notAllowed');
    if (error.status >= 500) return t('error.server');
  }
  return t('error.generic');
}
