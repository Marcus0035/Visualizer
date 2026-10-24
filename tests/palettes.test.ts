import { describe, expect, it } from 'vitest';
import { PALETTES, hexToRgb, mixHex } from '../src/modes/palettes';

describe('mixHex', () => {
  it('returns the endpoints and the midpoint', () => {
    expect(mixHex('#ff0000', '#000000', 0)).toBe('#ff0000');
    expect(mixHex('#ff0000', '#000000', 1)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
});

describe('PALETTES', () => {
  it('has unique ids and valid colors', () => {
    expect(new Set(PALETTES.map((p) => p.id)).size).toBe(PALETTES.length);
    for (const p of PALETTES) for (const c of [p.bg, p.a, p.b, p.c]) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('dark palettes keep the background near black', () => {
    const krev = PALETTES.find((p) => p.id === 'blood')!;
    expect(Math.max(...hexToRgb(krev.bg))).toBeLessThan(0.06);
  });
});
