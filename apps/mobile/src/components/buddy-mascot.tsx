import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { useTheme } from '@/hooks/use-theme';

/**
 * ECCS Buddy's mascot, "Chef Bubble" (19 Oct 2026, the founder: "change the buddy logo to a nice
 * mascot ... it looks like gemini logo at the moment"): a speech bubble in a chef's hat, smiling.
 * The bubble says it is someone to chat with, the hat says whose (the kitchen's); it replaces the
 * sparkles, which are Gemini's sign and many other AI products'. Chosen from three drawn at the
 * app's own sizes (`.work/buddy-logo/sheet.png`): a mascot should be one simple shape that still
 * reads at 18 to 32 pixels, drawn as a vector, distinct from other brands' marks, clear on light and
 * dark, and not a human face, so nobody thinks a person is replying (VentureBeat's chatbot-avatar
 * tips; Red Hat's chatbot avatar guidance). Drawn on a 64 square, in the theme's own colours.
 * Decorative: whatever it sits in carries the words ("Ask ECCS Buddy").
 */
export function BuddyMascot({ size = 24 }: { size?: number }) {
  const theme = useTheme();
  const body = theme.primary;
  const face = theme.onPrimary;
  const hat = '#ffffff';
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      {/* The bubble and its tail. */}
      <Rect x={7} y={24} width={50} height={33} rx={14} fill={body} />
      <Path d="M17 52 L12 63 L29 55 Z" fill={body} />
      {/* The chef's hat: its outline is the same shapes a little larger behind it, so the puffs show no inner lines. */}
      <Circle cx={24.5} cy={14} r={8.8} fill={body} />
      <Circle cx={32} cy={10.5} r={10.4} fill={body} />
      <Circle cx={39.5} cy={14} r={8.8} fill={body} />
      <Rect x={19.4} y={12.4} width={25.2} height={17.2} rx={2.2} fill={body} />
      <Circle cx={24.5} cy={14} r={6.2} fill={hat} />
      <Circle cx={32} cy={10.5} r={7.8} fill={hat} />
      <Circle cx={39.5} cy={14} r={6.2} fill={hat} />
      <Rect x={22} y={15} width={20} height={12} rx={2.2} fill={hat} />
      <Path d="M26 22.8 H38" stroke={body} strokeWidth={1.6} strokeLinecap="round" opacity={0.55} />
      {/* The face. */}
      <Circle cx={24} cy={39} r={3.3} fill={face} />
      <Circle cx={40} cy={39} r={3.3} fill={face} />
      <Path d="M24.5 46 Q32 52 39.5 46" fill="none" stroke={face} strokeWidth={3.4} strokeLinecap="round" />
    </Svg>
  );
}
