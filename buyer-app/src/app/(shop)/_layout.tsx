import { Redirect, Stack, router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '@/lib/auth';
import { CartProvider } from '@/lib/cart';

/** Route a tapped notification that carries a productId (broadcast / back-in-stock) to that
 *  product page, so the buyer can add it to the cart. Uses the response LISTENER (fires once
 *  per real tap) rather than useLastNotificationResponse (which returns a cached value that
 *  re-fires on every remount and would re-navigate / stack screens). */
function useNotificationRouting() {
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      // Only the default tap, not a dismiss or custom action button.
      if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
      const data = response.notification.request.content.data as { productId?: string } | undefined;
      const productId = data?.productId;
      if (productId) router.push(('/product/' + productId) as never);
    });
    return () => sub.remove();
  }, []);
}

// The shop area is a Stack so detail/checkout push OVER the bottom tabs.
// The visible tabs (Home/Orders/Profile) live in the (tabs) group.
export default function ShopLayout() {
  const { user, loading } = useAuth();
  useNotificationRouting();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }
  if (!user) return <Redirect href={'/sign-in' as never} />;

  return (
    <CartProvider>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="checkout" options={{ title: 'Checkout' }} />
        <Stack.Screen name="product/[id]" options={{ title: 'Product' }} />
      </Stack>
    </CartProvider>
  );
}
