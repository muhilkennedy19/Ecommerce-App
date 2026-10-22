import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '@/lib/auth';

export default function Index() {
  const { user, loading, configured } = useAuth();

  // Not configured yet → let the sign-in screen explain what to fill in.
  if (!configured) return <Redirect href="/sign-in" />;
  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }
  return <Redirect href={(user ? '/home' : '/sign-in') as never} />;
}
