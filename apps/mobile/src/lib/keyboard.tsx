import { Fragment, type ReactNode, type Ref } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TurboModuleRegistry,
  View,
  type ScrollViewProps,
  type ViewProps,
} from 'react-native';
import type { KeyboardAwareScrollViewRef } from 'react-native-keyboard-controller';

/**
 * Keeping what is being typed in view above the keyboard (19 Oct 2026, the founder: "whenever I type
 * anywhere in the app ... where I am writing is getting hidden with the keyboard").
 *
 * The app is drawn edge to edge on Android (`edgeToEdgeEnabled`), and there Android no longer shrinks
 * the screen when the keyboard opens ("adjustResize" stops working), so React Native's own
 * KeyboardAvoidingView moves nothing. Expo's keyboard guide and the edge-to-edge library both point to
 * react-native-keyboard-controller: its scroll view brings the box being typed in above the keyboard,
 * and its sticky view keeps a footer (Buddy's message box, a Save button) just above it.
 *
 * Its native part is only in the APK. In Expo Go and in the browser, the plain React Native pieces
 * stand in, as before (the same way as VisionCamera and the mic).
 */
type Controller = typeof import('react-native-keyboard-controller');

const controller: Controller | null = (() => {
  if (Platform.OS === 'web') return null;
  try {
    if (!TurboModuleRegistry.get('KeyboardController')) return null;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native-keyboard-controller') as Controller;
  } catch {
    return null;
  }
})();

/** Whether the keyboard is handled by react-native-keyboard-controller here (the APK). */
export const keyboardHandled = controller !== null;

/** Goes around the whole app once, so the pieces below know where the keyboard is. */
export function KeyboardRoot({ children }: { children: ReactNode }) {
  if (!controller) return <Fragment>{children}</Fragment>;
  return <controller.KeyboardProvider>{children}</controller.KeyboardProvider>;
}

/**
 * A screen's scrolling body: scrolls the box being typed in to `bottomOffset` above the keyboard (the
 * footer's height and a little more). Elsewhere a plain scroll view, which takes no `bottomOffset`.
 */
export function KeyboardScrollView({
  bottomOffset,
  ref,
  ...props
}: ScrollViewProps & { bottomOffset?: number; ref?: Ref<ScrollView | null> }) {
  if (controller)
    return (
      <controller.KeyboardAwareScrollView
        ref={ref as Ref<KeyboardAwareScrollViewRef>}
        bottomOffset={bottomOffset}
        {...props}
      />
    );
  return <ScrollView ref={ref} {...props} />;
}

/** A footer that rides up with the keyboard, so it stays in view above it. `bottomInset` is the safe-area gap under it when the keyboard is closed. */
export function KeyboardFooter({ bottomInset, ...props }: ViewProps & { bottomInset: number }) {
  if (!controller) return <View {...props} />;
  return <controller.KeyboardStickyView offset={{ closed: 0, opened: bottomInset }} {...props} />;
}

/**
 * For a dialog: its content gets smaller while the keyboard is open, so the dialog stays above the
 * keyboard and scrolls. Elsewhere, React Native's own does the same on iPhones only.
 */
export function KeyboardDialogFrame(props: ViewProps) {
  if (controller) return <controller.KeyboardAvoidingView behavior="padding" {...props} />;
  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} {...props} />;
}
