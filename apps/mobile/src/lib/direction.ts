import { isRightToLeft } from '@eccs/i18n';

import { useSession } from './session';

/** Which way the screens run: left to right, or right to left (Urdu). */
export type Direction = 'ltr' | 'rtl';

/**
 * The one place that answers "which way are we?".
 *
 * Urdu is read from right to left, so in Urdu the whole layout is mirrored:
 * rows start on the right, the menu opens from the right, "back" points right.
 * The direction comes from the language chosen in the app (not the phone's own
 * language), and changes the moment the language does, with no restart.
 *
 * How it works: the top of the app (and each pop-up) is wrapped in a
 * `DirectionView`, which tells the layout engine the direction. Rows, and
 * anything positioned with `start` / `end` (never `left` / `right`), then
 * follow by themselves. Only the few things the engine cannot know about need
 * this hook: arrows, slide and swipe directions.
 *
 * What stays left to right even in Urdu (Material Design and Apple both say
 * so): the digits of a number such as a phone number or a PIN, the number pad,
 * photos, and marks like the tick.
 */
export function useDirection() {
  const { language } = useSession();
  const isRtl = isRightToLeft(language);
  return {
    direction: (isRtl ? 'rtl' : 'ltr') as Direction,
    isRtl,
    /** 1 when left to right, -1 when right to left: multiply sideways distances by it. */
    sign: isRtl ? (-1 as const) : (1 as const),
    /** The arrow for "back" or "previous": it points to where the reading started. */
    backIcon: isRtl ? ('chevron-forward' as const) : ('chevron-back' as const),
    /** The arrow for "open this" or "next": it points the way the reading goes. */
    forwardIcon: isRtl ? ('chevron-back' as const) : ('chevron-forward' as const),
    /** The same "open this" arrow as a character, for inside a line of text. */
    forwardGlyph: isRtl ? '‹' : '›',
    /** Turns round a picture that points the reading way and has no opposite twin (the "send" arrow). */
    mirror: isRtl ? MIRROR : undefined,
  };
}

const MIRROR = { transform: [{ scaleX: -1 }] };

/**
 * Keeps a phone number (or anything else made of digits and signs) the right
 * way round inside an Urdu sentence. Without it the "+" and the groups of
 * digits can swap sides. It wraps the text in two invisible marks that say
 * "this piece reads left to right"; they change nothing in other languages.
 */
export const ltrText = (value: string) => `⁦${value}⁩`;
