// Palette taken from the user image: dominant colors by k-means, pushed towards the app's dark look.
import type { Palette } from '../modes/types';

export const IMAGE_PALETTE_ID = 'image';

type Rgb = [number, number, number];

const K = 6;
const MAX_SAMPLES = 4000;

function toHex(c: Rgb): string {
  return `#${c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')}`;
}

function luma(c: Rgb): number {
  return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
}

function rgbToHsv([r, g, b]: Rgb): Rgb {
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return [h / 6, max > 0 ? d / max : 0, max];
}

function hsvToRgb([h, s, v]: Rgb): Rgb {
  const f = (n: number) => {
    const k = (n + h * 6) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)];
}

/** Same hue and saturation, brightness set to `v` */
function withValue(c: Rgb, v: number): Rgb {
  const hsv = rgbToHsv(c);
  return hsvToRgb([hsv[0], hsv[1], v]);
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Hue distance 0..0.5 (fraction of the color wheel) */
function hueGap(a: Rgb, b: Rgb): number {
  const d = Math.abs(rgbToHsv(a)[0] - rgbToHsv(b)[0]);
  return Math.min(d, 1 - d);
}

/** Opaque pixels as 0..1 colors, evenly thinned to at most MAX_SAMPLES. */
function samples(rgba: Uint8ClampedArray): Rgb[] {
  const count = rgba.length / 4;
  const stride = Math.max(1, Math.floor(count / MAX_SAMPLES));
  const out: Rgb[] = [];
  for (let i = 0; i < count; i += stride) {
    const o = i * 4;
    if (rgba[o + 3] < 128) continue;
    out.push([rgba[o] / 255, rgba[o + 1] / 255, rgba[o + 2] / 255]);
  }
  return out;
}

/** Deterministic k-means: starts from brightness quantiles, so the same image gives the same palette. */
function cluster(px: Rgb[]): { color: Rgb; weight: number }[] {
  const sorted = [...px].sort((a, b) => luma(a) - luma(b));
  const k = Math.min(K, sorted.length);
  let centers: Rgb[] = Array.from({ length: k }, (_, i) => sorted[Math.floor(((i + 0.5) / k) * sorted.length)]);
  let counts: number[] = [];
  for (let iter = 0; iter < 10; iter++) {
    const sums = centers.map((): Rgb => [0, 0, 0]);
    counts = centers.map(() => 0);
    for (const p of px) {
      let best = 0;
      let bestD = Infinity;
      centers.forEach((c, j) => {
        const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      });
      sums[best][0] += p[0];
      sums[best][1] += p[1];
      sums[best][2] += p[2];
      counts[best]++;
    }
    centers = centers.map((c, j) => (counts[j] ? [sums[j][0] / counts[j], sums[j][1] / counts[j], sums[j][2] / counts[j]] : c));
  }
  return centers.map((color, j) => ({ color, weight: counts[j] / px.length })).filter((c) => c.weight > 0);
}

/**
 * Palette from RGBA pixels: the most vivid frequent color as the primary, a second hue
 * (or a deep shade) as the secondary, a light tint for highlights, near-black background.
 */
export function paletteFromPixels(rgba: Uint8ClampedArray): Palette {
  const clusters = cluster(samples(rgba));
  if (!clusters.length) clusters.push({ color: [1, 0.06, 0.19], weight: 1 });
  // Prefer saturated, not too dark colors, but frequency still counts
  const score = (c: Rgb, w: number) => {
    const [, s, v] = rgbToHsv(c);
    return Math.sqrt(w) * (0.15 + s) * (0.2 + v);
  };
  const ranked = [...clusters].sort((x, y) => score(y.color, y.weight) - score(x.color, x.weight));
  const main = ranked[0].color;
  const a = withValue(main, Math.max(0.85, rgbToHsv(main)[2]));
  const second = ranked.slice(1).find((c) => hueGap(c.color, main) > 0.08 && rgbToHsv(c.color)[1] > 0.2);
  const b = second ? withValue(second.color, Math.max(0.55, Math.min(0.8, rgbToHsv(second.color)[2]))) : mix(a, [0, 0, 0], 0.65);
  const lightest = [...clusters].sort((x, y) => luma(y.color) - luma(x.color))[0].color;
  const c = mix(mix(a, lightest, 0.5), [1, 1, 1], 0.35);
  const bg = mix(a, [0, 0, 0], 0.95);
  return { id: IMAGE_PALETTE_ID, name: 'From image', bg: toHex(bg), a: toHex(a), b: toHex(b), c: toHex(c) };
}

/** Palette of a loaded image canvas (read at a small size, it only needs the color spread). */
export function paletteFromCanvas(source: HTMLCanvasElement): Palette {
  const k = Math.min(1, 160 / Math.max(source.width, source.height));
  const small = document.createElement('canvas');
  small.width = Math.max(1, Math.round(source.width * k));
  small.height = Math.max(1, Math.round(source.height * k));
  const g = small.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(source, 0, 0, small.width, small.height);
  return paletteFromPixels(g.getImageData(0, 0, small.width, small.height).data);
}
