import type { Palette } from './types';

export const PALETTES: Palette[] = [
  { id: 'neon', name: 'Neon', bg: '#06020f', a: '#ff2bd6', b: '#00e5ff', c: '#f8ff3a' },
  { id: 'phosphor', name: 'Fosfor', bg: '#010a04', a: '#39ff6a', b: '#0fae3c', c: '#c6ffd2' },
  { id: 'amber', name: 'Jantar', bg: '#0a0500', a: '#ffb000', b: '#ff5e00', c: '#ffe2a0' },
  { id: 'sixties', name: '60. léta', bg: '#f1e4c8', a: '#e4572e', b: '#f3a712', c: '#29335c' },
  { id: 'ice', name: 'Led', bg: '#000814', a: '#48cae4', b: '#0077b6', c: '#e0fbff' },
  { id: 'mono', name: 'Mono', bg: '#000000', a: '#ffffff', b: '#7a7a7a', c: '#ffffff' },
  { id: 'warehouse', name: 'Warehouse', bg: '#000000', a: '#ff1a1a', b: '#5a0000', c: '#ffffff' },
  { id: 'acid', name: 'Acid', bg: '#020300', a: '#c6ff00', b: '#ff00aa', c: '#ffffff' },
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
