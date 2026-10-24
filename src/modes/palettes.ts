import type { Palette } from './types';

/**
 * Dark palette around one vivid primary: near-black tinted background, a deep shade
 * of the primary, and a light tint (instead of white) for highlights.
 */
function dark(id: string, name: string, primary: string): Palette {
  return {
    id,
    name,
    bg: mixHex(primary, '#000000', 0.96),
    a: primary,
    b: mixHex(primary, '#000000', 0.72),
    c: mixHex(primary, '#ffffff', 0.4),
    dark: true,
  };
}

export const PALETTES: Palette[] = [
  dark('blood', 'Krev', '#ff1030'),
  dark('toxic', 'Jed', '#39ff14'),
  dark('ultra', 'Ultrafialová', '#8a2bff'),
  dark('cobalt', 'Kobalt', '#1f5bff'),
  dark('fire', 'Oheň', '#ff5a00'),
  dark('teal', 'Tyrkys', '#00e5d4'),
  dark('magenta', 'Magenta', '#ff00b3'),
  dark('gold', 'Zlato', '#ffc400'),
  { id: 'warehouse', name: 'Warehouse', bg: '#000000', a: '#ff1a1a', b: '#5a0000', c: '#ffffff' },
  { id: 'acid', name: 'Acid', bg: '#020300', a: '#c6ff00', b: '#ff00aa', c: '#ffffff' },
  { id: 'neon', name: 'Neon', bg: '#06020f', a: '#ff2bd6', b: '#00e5ff', c: '#f8ff3a' },
  { id: 'phosphor', name: 'Fosfor', bg: '#010a04', a: '#39ff6a', b: '#0fae3c', c: '#c6ffd2' },
  { id: 'amber', name: 'Jantar', bg: '#0a0500', a: '#ffb000', b: '#ff5e00', c: '#ffe2a0' },
  { id: 'ice', name: 'Led', bg: '#000814', a: '#48cae4', b: '#0077b6', c: '#e0fbff' },
  { id: 'mono', name: 'Mono', bg: '#000000', a: '#ffffff', b: '#7a7a7a', c: '#ffffff' },
];

/** '#rrggbb' -> [r, g, b] in 0..1 */
export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** '#rrggbb' + alpha -> 'rgba(...)' for Canvas 2D */
export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`;
}

/** Linear mix of two '#rrggbb' colors, t = 0 gives `from`, t = 1 gives `to`. */
export function mixHex(from: string, to: string, t: number): string {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const hex = a.map((v, i) => Math.round((v + (b[i] - v) * t) * 255).toString(16).padStart(2, '0'));
  return `#${hex.join('')}`;
}
