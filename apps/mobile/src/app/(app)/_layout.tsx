import { Stack } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppNav } from '@/components/app-nav';
import { OfflineSync } from '@/components/offline-sync';

export default function AppLayout() {
  return (
    <View style={styles.root}>
      <View style={styles.root}>
        <Stack screenOptions={{ headerShown: false }} />
      </View>
      {/* Sends checklist answers saved on the phone whenever the app is open, and says where that stands. */}
      <OfflineSync />
      <AppNav />
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
