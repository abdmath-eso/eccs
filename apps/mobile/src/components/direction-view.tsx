import { View, type ViewProps } from 'react-native';

import { useDirection, type Direction } from '@/lib/direction';

export interface DirectionViewProps extends ViewProps {
  /**
   * Leave out to follow the app's language. Give 'ltr' for the few things that
   * never mirror, such as the number pad.
   */
  direction?: Direction;
}

/**
 * A box whose contents are laid out in the app's direction: mirrored in Urdu,
 * ordinary otherwise. Used once round the whole app, and again as the outer
 * box of every pop-up (a pop-up is drawn outside the app's own box, so it has
 * to be told separately).
 *
 * On a phone the layout engine takes the direction as a style and passes it
 * down to everything inside. The browser preview has its own version of this
 * file (`direction-view.web.tsx`).
 */
export function DirectionView({ direction, style, ...rest }: DirectionViewProps) {
  const app = useDirection();
  return <View style={[style, { direction: direction ?? app.direction }]} {...rest} />;
}
