/**
 * Geographic helpers for live courier tracking. Pure functions, no platform APIs — safe to use
 * in both apps and in a headless background task.
 */

/** Default throttle distance (metres) when a shop hasn't set `courierMinMoveMeters`. */
export const DEFAULT_COURIER_MIN_MOVE_METERS = 20;

/**
 * Default radius (metres) within which the courier is considered "arrived" at the buyer's
 * address, triggering the one-time "reaching your doorstep" push. Used when a shop hasn't set
 * `arrivalRadiusMeters`. Kept generous enough to tolerate consumer-GPS jitter (~10–20 m).
 */
export const DEFAULT_ARRIVAL_RADIUS_METERS = 20;

/**
 * Cadence (ms) shared by both ends of live delivery tracking: the courier device requests a
 * location fix at most this often (write side), and the buyer's open map screen re-reads the
 * order on the same beat (read side). One number keeps the two in lock-step and bounds reads —
 * the buyer polls ONLY while actively viewing the map, never in the background.
 */
export const COURIER_UPDATE_INTERVAL_MS = 10_000;

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/**
 * Great-circle distance between two WGS84 points, in metres (haversine). Accurate to well
 * within a metre at city scale, which is all the courier-move throttle needs. Returns 0 for
 * identical points and is symmetric in its arguments.
 */
export function haversineMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Whether a courier at (`toLat`,`toLng`) has moved far enough from its last written position
 * (`fromLat`,`fromLng`) to justify a fresh write. A missing previous position (first fix)
 * always qualifies. `minMeters` falls back to the default when not a positive finite number.
 */
export function courierShouldWrite(
  fromLat: number | null | undefined,
  fromLng: number | null | undefined,
  toLat: number,
  toLng: number,
  minMeters?: number | null,
): boolean {
  if (fromLat == null || fromLng == null) return true;
  const threshold =
    typeof minMeters === 'number' && Number.isFinite(minMeters) && minMeters > 0
      ? minMeters
      : DEFAULT_COURIER_MIN_MOVE_METERS;
  return haversineMeters(fromLat, fromLng, toLat, toLng) >= threshold;
}
