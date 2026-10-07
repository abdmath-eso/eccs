import { Stack } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppNav } from '@/components/app-nav';

export default function AppLayout() {
  return (
    <View style={styles.root}>
      <View style={styles.root}>
        <Stack screenOptions={{ headerShown: false }} />
      </View>
      <AppNav />
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
