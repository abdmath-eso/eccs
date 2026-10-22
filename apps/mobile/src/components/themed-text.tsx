import { Platform, StyleSheet, Text, type TextProps } from 'react-native';

import { isRightToLeft } from '@eccs/i18n';

import { Fonts, ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/lib/session';

export type ThemedTextProps = TextProps & {
  type?: 'default' | 'title' | 'small' | 'smallBold' | 'subtitle' | 'link' | 'linkPrimary' | 'code';
  themeColor?: ThemeColor;
};

/**
 * Every language but English is written here in an Indian script or in Urdu: taller letters that
 * need more room between lines (Material's language support: "tall" scripts get more line
 * height), and fonts with no medium weight, so a medium line came out half regular (the script)
 * and half medium (digits and names). In those languages body text is regular, with more room.
 */
export const tallScript = (language: string) => language !== 'EN';

export function ThemedText({ style, type = 'default', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();
  const { language } = useSession();
  const tall = tallScript(language);

  return (
    <Text
      style={[
        { color: theme[themeColor ?? 'text'] },
        // Urdu reads right to left. (The layout around the text is mirrored by `DirectionView`.)
        isRightToLeft(language) && styles.rightToLeft,
        type === 'default' && styles.default,
        type === 'default' && tall && styles.defaultTall,
        type === 'title' && styles.title,
        type === 'small' && styles.small,
        type === 'small' && tall && styles.smallTall,
        type === 'smallBold' && styles.smallBold,
        type === 'smallBold' && tall && styles.smallBoldTall,
        type === 'subtitle' && styles.subtitle,
        type === 'link' && styles.link,
        type === 'linkPrimary' && styles.linkPrimary,
        type === 'code' && styles.code,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  rightToLeft: { writingDirection: 'rtl' },
  small: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: 500,
  },
  smallBold: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: 700,
  },
  smallTall: { lineHeight: 22, fontWeight: 400 },
  smallBoldTall: { lineHeight: 22 },
  defaultTall: { lineHeight: 26, fontWeight: 400 },
  default: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: 500,
  },
  title: {
    fontSize: 48,
    fontWeight: 600,
    lineHeight: 52,
  },
  subtitle: {
    fontSize: 32,
    lineHeight: 44,
    fontWeight: 600,
  },
  link: {
    lineHeight: 30,
    fontSize: 14,
  },
  linkPrimary: {
    lineHeight: 30,
    fontSize: 14,
    color: '#3c87f7',
  },
  code: {
    fontFamily: Fonts.mono,
    fontWeight: Platform.select({ android: 700 }) ?? 500,
    fontSize: 12,
  },
});
