import { Redirect, Stack, router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '@/lib/auth';
import { CartProvider } from '@/lib/cart';

/** Route a tapped notification to the right place. A `productId` (broadcast / back-in-stock)
 *  opens that product; an `orderId` from a delivery push (order-arriving / order-status) opens
 *  that order's live track screen. Uses the response LISTENER (fires once per real tap) rather
 *  than useLastNotificationResponse (which returns a cached value that re-fires on every remount
 *  and would re-navigate / stack screens). */
function useNotificationRouting() {
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      // Only the default tap, not a dismiss or custom action button.
      if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
      const data = response.notification.request.content.data as
        | { productId?: string; orderId?: string; event?: string }
        | undefined;
      if (data?.productId) {
        router.push(('/product/' + data.productId) as never);
      } else if (data?.orderId && (data.event === 'order-arriving' || data.event === 'order-status')) {
        router.push(('/track/' + data.orderId) as never);
      }
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
