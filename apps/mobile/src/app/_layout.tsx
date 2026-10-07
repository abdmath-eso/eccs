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
function RootNavigator() {
  const { ready, user } = useSession();

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={user !== null}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={user === null}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
