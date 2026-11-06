import {
  COURIER_UPDATE_INTERVAL_MS,
  DEFAULT_ARRIVAL_RADIUS_METERS,
  DEFAULT_COURIER_MIN_MOVE_METERS,
  getIdToken,
  haversineMeters,
  markOrderArrivalNotified,
  sendNotify,
  subscribeOrders,
  subscribeShop,
  type Order,
} from '@common';
import * as Location from 'expo-location';
import { useCallback, useEffect, useRef } from 'react';

import { COURIER_TASK, setActiveCourierOrders, setCourierMinMove } from '@/lib/delivery-task';
import { notifyUrl, shopId } from '@/lib/config';
import { logError } from '@/lib/logging';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/feedback';
import { useT } from '@/lib/i18n';

/**
 * Drives courier location sharing on the seller device. Mounted once under the authenticated
 * area. It watches the orders this user is delivering (`courierId == me`, still
 * `out_for_delivery`) and:
 *   1. starts a foreground-service background location task while there is at least one,
 *      stopping it when the last is served/cancelled (the task does the throttled writes);
 *   2. fires the one-time "reaching your doorstep" push the moment the courier comes within the
 *      shop's arrival radius of the buyer's address.
 */
export function useCourierTracking(): void {
  const { user } = useAuth();
  const t = useT();
  const toast = useToast();
  const uid = user?.uid;
  const warnedRef = useRef(false);
  const radiusRef = useRef(DEFAULT_ARRIVAL_RADIUS_METERS);
  // In-session guard against re-firing the arrival push before the persisted flag round-trips
  // back through the orders subscription.
  const notifiedRef = useRef<Set<string>>(new Set());

  // Mirror the shop's throttle + arrival radius. The throttle goes to AsyncStorage for the task;
  // the radius stays in a ref the arrival check reads.
  useEffect(() => {
    return subscribeShop(shopId, (s) => {
      const m = s?.courierMinMoveMeters;
      void setCourierMinMove(typeof m === 'number' && m > 0 ? m : DEFAULT_COURIER_MIN_MOVE_METERS);
      const r = s?.arrivalRadiusMeters;
      radiusRef.current = typeof r === 'number' && r > 0 ? r : DEFAULT_ARRIVAL_RADIUS_METERS;
    });
  }, []);

  const syncTracking = useCallback(
    async (ids: string[]): Promise<void> => {
      try {
        await setActiveCourierOrders(ids);
        const running = await Location.hasStartedLocationUpdatesAsync(COURIER_TASK).catch(
          () => false,
        );

        if (ids.length > 0 && !running) {
          const granted = await ensureForegroundPermission();
          if (!granted) {
            if (!warnedRef.current) {
              warnedRef.current = true;
              toast({
                type: 'error',
                title: t('track.permTitle', 'Location needed'),
                message: t('track.permMsg', 'Allow location so customers can follow their delivery on the map.'),
              });
            }
            return;
          }
          // Best-effort "Allow all the time"; if the user keeps it to "While using", updates
          // still flow via the foreground service whenever the app is open.
          await Location.requestBackgroundPermissionsAsync().catch(() => undefined);
          await Location.startLocationUpdatesAsync(COURIER_TASK, {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: COURIER_UPDATE_INTERVAL_MS,
            distanceInterval: 5,
            pausesUpdatesAutomatically: false,
            showsBackgroundLocationIndicator: true,
            foregroundService: {
              notificationTitle: t('track.fgTitle', 'Sharing delivery location'),
              notificationBody: t('track.fgBody', 'Your location is shared with the customer while you deliver.'),
            },
          });
        } else if (ids.length === 0 && running) {
          await Location.stopLocationUpdatesAsync(COURIER_TASK);
        }
      } catch (e) {
        logError('courier.sync', e);
      }
    },
    [t, toast],
  );

  // Fire the one-time doorstep push for any order whose courier fix is now within the arrival
  // radius of its delivery pin. Idempotent: the persisted `arrivalNotifiedAt` flag guards across
  // sessions, the in-memory Set guards within one.
  const checkArrivals = useCallback(async (orders: Order[]): Promise<void> => {
    const radius = radiusRef.current;
    const arrived = orders.filter((o) => {
      if (o.arrivalNotifiedAt || notifiedRef.current.has(o.id)) return false;
      if (o.courierLat == null || o.courierLng == null) return false;
      if (o.address?.lat == null || o.address?.lng == null) return false;
      return haversineMeters(o.courierLat, o.courierLng, o.address.lat, o.address.lng) <= radius;
    });
    if (arrived.length === 0) return;
    const idToken = await getIdToken().catch(() => null);
    await Promise.all(
      arrived.map(async (o) => {
        notifiedRef.current.add(o.id); // immediate guard, before any await resolves
        try {
          await sendNotify(notifyUrl, idToken, {
            event: 'order-arriving',
            customerId: o.customerId,
            orderId: o.id,
          });
          await markOrderArrivalNotified(o.id, Date.now());
        } catch (e) {
          logError('courier.arrival', e);
        }
      }),
    );
  }, []);

  useEffect(() => {
    if (!uid) return;
    return subscribeOrders(
      shopId,
      (orders) => {
        const mine = orders.filter((o) => o.courierId === uid);
        void syncTracking(mine.map((o) => o.id));
        void checkArrivals(mine);
      },
      'out_for_delivery',
      50,
    );
  }, [uid, syncTracking, checkArrivals]);
}

async function ensureForegroundPermission(): Promise<boolean> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}
