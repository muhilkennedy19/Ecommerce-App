import { describe, expect, it } from 'vitest';

import { makeOrderCode, orderDisplayCode, orderMatchesCode } from '../src/util/ordercode';

describe('makeOrderCode', () => {
  it('starts with mken and uses the unambiguous alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = makeOrderCode();
      expect(code).toMatch(/^mken[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
      // No visually ambiguous characters in the suffix.
      expect(code.slice(4)).not.toMatch(/[O01IL]/);
    }
  });

  it('is practically unique across a batch', () => {
    const codes = new Set(Array.from({ length: 500 }, () => makeOrderCode()));
    expect(codes.size).toBeGreaterThan(495); // allow a vanishingly rare collision
  });
});

describe('orderDisplayCode', () => {
  it('prefers orderCode, falls back to a slice of the id', () => {
    expect(orderDisplayCode({ orderCode: 'mkenK7P3Q2', id: 'abc123xyz' })).toBe('mkenK7P3Q2');
    expect(orderDisplayCode({ orderCode: null, id: 'abcdefgh12345' })).toBe('abcdefgh');
    expect(orderDisplayCode({ id: 'short' })).toBe('short');
  });
});

describe('orderMatchesCode', () => {
  const o = { orderCode: 'mkenK7P3Q2', id: 'firestoreDocId99' };

  it('matches empty/whitespace query (shows everything)', () => {
    expect(orderMatchesCode(o, '')).toBe(true);
    expect(orderMatchesCode(o, '   ')).toBe(true);
  });

  it('is case-insensitive and ignores # and all spaces', () => {
    expect(orderMatchesCode(o, 'K7P3')).toBe(true);
    expect(orderMatchesCode(o, 'mkenk7p3q2')).toBe(true);
    expect(orderMatchesCode(o, '#MKENK7P3Q2')).toBe(true);
    expect(orderMatchesCode(o, ' k7 p3 ')).toBe(true); // all whitespace is stripped, not just trimmed
  });

  it('matches the doc id too (legacy orders without a code)', () => {
    expect(orderMatchesCode({ orderCode: null, id: 'firestoreDocId99' }, 'DocId99')).toBe(true);
  });

  it('rejects a non-matching query', () => {
    expect(orderMatchesCode(o, 'ZZZZ')).toBe(false);
  });
});
