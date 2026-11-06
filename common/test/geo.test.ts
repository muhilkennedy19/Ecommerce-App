import { describe, expect, it } from 'vitest';

import {
  DEFAULT_COURIER_MIN_MOVE_METERS,
  courierShouldWrite,
  haversineMeters,
} from '../src/util/geo';

describe('haversineMeters', () => {
  it('is zero for identical points', () => {
    expect(haversineMeters(12.9716, 77.5946, 12.9716, 77.5946)).toBe(0);
  });

  it('is symmetric in its arguments', () => {
    const a = haversineMeters(12.9716, 77.5946, 13.0827, 80.2707);
    const b = haversineMeters(13.0827, 80.2707, 12.9716, 77.5946);
    expect(Math.abs(a - b)).toBeLessThan(1e-6);
  });

  it('measures a ~111m-per-0.001°-latitude step near the equator', () => {
    // One thousandth of a degree of latitude is ~111.2 m everywhere.
    const d = haversineMeters(0, 0, 0.001, 0);
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(112);
  });

  it('approximates the Bengaluru↔Chennai great-circle (~290 km)', () => {
    const d = haversineMeters(12.9716, 77.5946, 13.0827, 80.2707);
    expect(d / 1000).toBeGreaterThan(280);
    expect(d / 1000).toBeLessThan(300);
  });
});

describe('courierShouldWrite', () => {
  it('always writes the first fix (no previous position)', () => {
    expect(courierShouldWrite(null, null, 12.9716, 77.5946)).toBe(true);
    expect(courierShouldWrite(undefined, undefined, 12.9716, 77.5946, 20)).toBe(true);
  });

  it('suppresses a sub-threshold nudge and allows a past-threshold move', () => {
    // ~11 m north — below the 20 m default.
    expect(courierShouldWrite(12.9716, 77.5946, 12.97170, 77.5946, 20)).toBe(false);
    // ~33 m north — above it.
    expect(courierShouldWrite(12.9716, 77.5946, 12.97190, 77.5946, 20)).toBe(true);
  });

  it('falls back to the default threshold for an invalid minMeters', () => {
    const smallMove = (min: number | null | undefined) =>
      courierShouldWrite(12.9716, 77.5946, 12.97170, 77.5946, min); // ~11 m
    expect(smallMove(0)).toBe(false);
    expect(smallMove(-5)).toBe(false);
    expect(smallMove(NaN)).toBe(false);
    expect(DEFAULT_COURIER_MIN_MOVE_METERS).toBe(20);
  });

  it('honours a lowered threshold', () => {
    // ~11 m move clears a 5 m threshold.
    expect(courierShouldWrite(12.9716, 77.5946, 12.97170, 77.5946, 5)).toBe(true);
  });
});
