import type { RefObject } from 'react';
import type { ScrollView } from 'react-native';

import { Spacing } from '@/constants/theme';

// Long enough for the screen to finish redrawing (for example to show the message
// beside the item) before the scroll starts. In a browser, a redraw in the middle of
// a smooth scroll cancels it, so scrolling in the same instant silently did nothing.
const AFTER_REDRAW_MS = 80;

/**
 * Scrolls a screen so that something `y` down the page sits just under the top,
 * for example the first item still to be answered. Pass the screen's `scrollRef`.
 */
export function scrollToY(ref: RefObject<ScrollView | null>, y: number) {
  setTimeout(() => ref.current?.scrollTo({ y: Math.max(0, y - Spacing.three), animated: true }), AFTER_REDRAW_MS);
}
