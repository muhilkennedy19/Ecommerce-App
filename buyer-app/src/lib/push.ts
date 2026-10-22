import { setPushToken } from '@common';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

// SDK 58: NotificationBehavior requires shouldShowBanner / shouldShowList / shouldPlaySound /
// shouldSetBadge (the legacy shouldShowAlert is deprecated). Default channel/sound — no custom
// channel is configured for the buyer app.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/**
 * Register this device for push notifications and persist the device token under the buyer's uid.
 * Best-effort: guards against simulators, honors the permission prompt, and never throws so it is
 * safe to fire-and-forget right after sign-in.
 */
export async function registerForPush(uid: string): Promise<void> {
  try {
    if (!Device.isDevice) return;
    const { granted } = await Notifications.requestPermissionsAsync();
    if (!granted) return;
    const token = (await Notifications.getDevicePushTokenAsync()).data;
    await setPushToken(uid, String(token), 'buyer');
  } catch {
    // best-effort; never block the app on push registration
  }
}
