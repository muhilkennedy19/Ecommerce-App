import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '@/lib/auth';
import { useCourierTracking } from '@/lib/delivery-tracking';

export default function AppLayout() {
  const { user, loading } = useAuth();
  // Shares this device's location with customers while it is delivering any order (no-op until
  // the signed-in user has an `out_for_delivery` order assigned to them).
  useCourierTracking();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }
  if (!user) return <Redirect href="/sign-in" />;

  return <Stack screenOptions={{ headerShown: true, headerBackTitle: 'Back' }} />;
}
