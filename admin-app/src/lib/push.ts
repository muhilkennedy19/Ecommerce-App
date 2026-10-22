import { setPushToken, type Role } from '@common';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

// Decide how a notification is presented while the app is in the foreground.
// SDK 58 shape: `shouldShowBanner` / `shouldShowList` replace the deprecated
// `shouldShowAlert`. All four fields are required by `NotificationBehavior`.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Register this device for push and persist its FCM/APNs token under the signed-in
 * admin user. Best-effort: any failure is swallowed so it never surfaces in the UI.
 */
export async function registerForPush(uid: string, roles?: Role[] | null): Promise<void> {
  try {
    if (!Device.isDevice) return;

    // Ask for permission only when we still can (i.e. it was undetermined).
    const perms = await Notifications.getPermissionsAsync();
    let granted = perms.granted;
    if (!granted && perms.canAskAgain) {
      granted = (await Notifications.requestPermissionsAsync()).granted;
    }
    if (!granted) return;

    // Android: a dedicated high-importance channel with the bundled custom sound.
    await Notifications.setNotificationChannelAsync('orders', {
      name: 'New orders',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'order_ring.wav',
      vibrationPattern: [0, 500, 500, 500],
      enableVibrate: true,
    });

    const token = (await Notifications.getDevicePushTokenAsync()).data;
    await setPushToken(uid, String(token), 'admin', roles ?? null);
  } catch {
    // never throw into the UI
  }
}
