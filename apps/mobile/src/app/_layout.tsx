import { DarkTheme, DefaultTheme, LocaleProvider, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, type ReactNode } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';

import { DirectionView } from '@/components/direction-view';
import { SnackbarProvider } from '@/components/ui/snackbar';
import { useDirection } from '@/lib/direction';
import { SessionProvider, useSession } from '@/lib/session';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <SessionProvider>
        <Mirrored>
          <SnackbarProvider>
            <RootNavigator />
          </SnackbarProvider>
        </Mirrored>
      </SessionProvider>
    </ThemeProvider>
  );
}

// Lays the whole app out in the direction of the chosen language: right to left
// in Urdu, left to right otherwise. It follows the language the moment it is
// changed, so nothing has to restart. `LocaleProvider` tells the navigation
// (screen transitions, the swipe back on an iPhone) the same thing.
function Mirrored({ children }: { children: ReactNode }) {
  const { direction } = useDirection();
  return (
    <LocaleProvider direction={direction}>
      <DirectionView style={styles.fill}>{children}</DirectionView>
    </LocaleProvider>
  );
}

// Logged-out users only ever reach the (auth) screens and logged-in users
// only the (app) screens; logging in or out swaps between them.
//
// In between sits the acceptance screen (`accept`): a logged-in person with documents
// to agree to (the Terms of Service, the Privacy Policy...) reaches nothing else until
// they agree or choose "Not now", which logs them out. It is its own screen here
// rather than one of the (auth) screens, which exist only while nobody is logged in,
// or one of the (app) screens, whose layout starts push registration, the offline
// queue and the bottom bar: all of those call the server, which refuses them until
// the person agrees. For the Owner's first login it therefore comes before the
// screen that shows their new PIN, which is the (app) home screen.
//
// The documents themselves (`legal/[key]`) can be opened in every state: from the
// acceptance screen, and from the profile. They come last, so that a change of
// state never lands on them.
function RootNavigator() {
  const { ready, user, pendingTerms } = useSession();
  const mustAgree = user !== null && pendingTerms.length > 0;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={user !== null && !mustAgree}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={mustAgree}>
        <Stack.Screen name="accept" />
      </Stack.Protected>
      <Stack.Protected guard={user === null}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Screen name="legal/[key]" />
    </Stack>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
