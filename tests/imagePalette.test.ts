import { describe, expect, it } from 'vitest';
import { hexToRgb } from '../src/modes/palettes';
import { IMAGE_PALETTE_ID, paletteFromPixels } from '../src/overlay/imagePalette';

/** RGBA pixels: `n` copies of each color */
function pixels(colors: [number, number, number, number?][], n = 100): Uint8ClampedArray {
  const out: number[] = [];
  for (const [r, g, b, a = 255] of colors) for (let i = 0; i < n; i++) out.push(r, g, b, a);
  return new Uint8ClampedArray(out);
}

describe('paletteFromPixels', () => {
  it('picks the vivid color as primary even next to lots of grey', () => {
    const p = paletteFromPixels(pixels([[40, 40, 40], [200, 200, 200], [0, 90, 255]]));
    const [r, g, b] = hexToRgb(p.a);
    expect(b).toBeGreaterThan(0.8);
    expect(r).toBeLessThan(0.2);
    expect(g).toBeLessThan(b);
    expect(p.id).toBe(IMAGE_PALETTE_ID);
  });

  it('uses a second hue for the secondary color', () => {
    const p = paletteFromPixels(pixels([[255, 20, 20], [20, 200, 40]]));
    const a = hexToRgb(p.a);
    const b = hexToRgb(p.b);
    expect(a[0]).toBeGreaterThan(a[1]);
    expect(b[1]).toBeGreaterThan(b[0]);
  });

  it('keeps the background near black and all colors valid', () => {
    const p = paletteFromPixels(pixels([[255, 230, 0], [250, 250, 250]]));
    for (const c of [p.bg, p.a, p.b, p.c]) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    expect(Math.max(...hexToRgb(p.bg))).toBeLessThan(0.06);
  });

  it('ignores transparent pixels and survives an empty image', () => {
    const p = paletteFromPixels(pixels([[0, 255, 0, 0], [255, 0, 200]]));
    expect(hexToRgb(p.a)[1]).toBeLessThan(0.2);
    expect(paletteFromPixels(new Uint8ClampedArray(0)).a).toMatch(/^#[0-9a-f]{6}$/);
  });
});
