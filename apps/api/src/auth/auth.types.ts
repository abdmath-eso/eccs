import type { CurrentUserDto, Language } from '@eccs/shared';
import type { Request } from 'express';

/** The logged-in user attached to each request by AuthGuard. */
export interface AuthUser extends CurrentUserDto {
  sessionId: string;
  /**
   * The language the person's screen is in right now, which the app sends with each
   * request. Text the server words itself (the SOP library) and text the person types
   * are in this language. It is normally the same as the saved `language`, but that
   * is one setting per person and this is per phone, so the two can differ.
   */
  contentLanguage: Language;
}

/** The request header the apps send their current language in, as a code such as "TE". */
export const APP_LANGUAGE_HEADER = 'x-app-language';

export type AuthenticatedRequest = Request & { user?: AuthUser };
