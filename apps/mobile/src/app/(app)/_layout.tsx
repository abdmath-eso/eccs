import { Stack } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppNav } from '@/components/app-nav';
import { OfflineSync } from '@/components/offline-sync';
import { PlaceQuestion } from '@/components/place-question';
import { PushSetup } from '@/components/push-setup';

export default function AppLayout() {
  return (
    <View style={styles.root}>
      <View style={styles.root}>
        <Stack screenOptions={{ headerShown: false }} />
      </View>
      {/* Sends checklist answers saved on the phone whenever the app is open, and says where that stands. */}
      <OfflineSync />
      <AppNav />
      {/* Registers this phone for the person's push notifications and opens the right screen when one is tapped. */}
      <PushSetup />
      {/* Asks, the first time a proof photo is about to be taken, whether the place may be added to it. */}
      <PlaceQuestion />
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
