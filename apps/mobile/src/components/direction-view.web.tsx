import { View } from 'react-native';
// React Native for Web keeps the direction in its own setting, which decides
// whether `start` means left or right for everything inside. It has no public
// way to change it, so this reaches for the internal one. If a later version
// moves it, the browser preview stops mirroring (phones are not affected).
import { LocaleProvider } from 'react-native-web/dist/modules/useLocale';

import { useDirection } from '@/lib/direction';

import type { DirectionViewProps } from './direction-view';

/**
 * The browser's version of `DirectionView`. The browser needs two things: the
 * `dir` mark on the box, which makes rows run the other way, and React Native
 * for Web's own direction setting, which turns `start` and `end` into the
 * correct sides.
 */
export function DirectionView({ direction, ...rest }: DirectionViewProps) {
  const app = useDirection();
  const dir = direction ?? app.direction;
  return (
    <LocaleProvider direction={dir}>
      <View {...rest} {...({ dir } as object)} />
    </LocaleProvider>
  );
}
