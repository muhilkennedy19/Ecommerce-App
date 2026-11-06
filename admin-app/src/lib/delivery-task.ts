import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_COURIER_MIN_MOVE_METERS,
  courierShouldWrite,
  initFirebase,
  updateOrderCourierLocation,
} from '@common';
import type { LocationObject } from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { firebaseConfig } from '@/lib/config';
import { logError } from '@/lib/logging';

/**
 * Background courier-location task. Defined at module top-level (Expo requirement) by importing
 * this file for its side effect from the root layout, so registration happens before the app —
 * including a cold headless background launch — mounts any React tree.
 *
 * The task is intentionally dumb and self-contained: it reads everything it needs (which orders
 * are being delivered, the move threshold, the last position written per order) from
 * AsyncStorage, written by the React-side controller in `delivery-tracking.tsx`. That keeps the
 * task free of React/context, which never runs in a headless task.
 */
export const COURIER_TASK = 'courier-location-updates';

const K_ACTIVE = 'courier.activeOrderIds';
const K_MIN = 'courier.minMoveMeters';
const K_LAST = 'courier.lastWritten';

type LatLng = { lat: number; lng: number };

/** Persist the orders this courier is actively delivering (the task writes location to each). */
export async function setActiveCourierOrders(ids: string[]): Promise<void> {
  await AsyncStorage.setItem(K_ACTIVE, JSON.stringify(ids));
}

/** Persist the shop's write-throttle distance so a superuser's change takes effect live. */
export async function setCourierMinMove(meters: number): Promise<void> {
  await AsyncStorage.setItem(K_MIN, String(meters));
}

async function readActive(): Promise<string[]> {
  try {
    const parsed: unknown = JSON.parse((await AsyncStorage.getItem(K_ACTIVE)) ?? '[]');
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

async function readMin(): Promise<number> {
  const n = Number(await AsyncStorage.getItem(K_MIN));
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_COURIER_MIN_MOVE_METERS;
}

async function readLast(): Promise<Record<string, LatLng>> {
  try {
    const parsed: unknown = JSON.parse((await AsyncStorage.getItem(K_LAST)) ?? '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, LatLng>) : {};
  } catch {
    return {};
  }
}

TaskManager.defineTask(COURIER_TASK, async ({ data, error }) => {
  if (error) return;
  const locations = (data as { locations?: LocationObject[] } | undefined)?.locations;
  const fix = locations?.at(-1);
  if (!fix) return;
  try {
    // Idempotent: reuses the app initialized by AuthProvider when the process is alive (the
    // foreground service keeps it alive during a delivery); bootstraps Firebase on a cold
    // headless launch. A write before auth is restored just fails and is retried next fix.
    initFirebase(firebaseConfig);
    const [ids, minMeters, last] = await Promise.all([readActive(), readMin(), readLast()]);
    if (ids.length === 0) return;
    const lat = fix.coords.latitude;
    const lng = fix.coords.longitude;
    const now = Date.now();
    let changed = false;
    for (const id of ids) {
      const prev = last[id];
      if (!courierShouldWrite(prev?.lat, prev?.lng, lat, lng, minMeters)) continue;
      // Sequential by necessity, but a courier has at most a handful of live deliveries.
      await updateOrderCourierLocation(id, lat, lng, now);
      last[id] = { lat, lng };
      changed = true;
    }
    if (changed) await AsyncStorage.setItem(K_LAST, JSON.stringify(last));
  } catch (e) {
    logError('courier.task', e);
  }
});
