import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#11181C',
    background: '#ffffff',
    backgroundElement: '#F0F3F4',
    backgroundSelected: '#DDE3E6',
    textSecondary: '#5B6770',
    primary: '#0B7A6E',
    onPrimary: '#ffffff',
    danger: '#C62828',
    warning: '#B45309',
    info: '#1D4ED8',
    border: '#D5DBDF',
    /** The edge of an input or a choice: strong enough to see (3:1) where `border` is only a divider. */
    outline: '#7A858C',
  },
  dark: {
    text: '#ffffff',
    background: '#0B0F10',
    backgroundElement: '#1C2225',
    backgroundSelected: '#2B3338',
    textSecondary: '#A9B4BA',
    primary: '#2BB5A5',
    onPrimary: '#06201D',
    danger: '#FF8A80',
    warning: '#FBBF24',
    info: '#8AB4F8',
    border: '#333D42',
    outline: '#7D8A91',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

/** Screens are laid out for a phone; on a wide browser window they stay phone-width. */
export const MaxContentWidth = 480;

/** Kitchen staff may have wet or gloved hands: keep every tap target at least this tall. */
export const MinTouchSize = 52;
