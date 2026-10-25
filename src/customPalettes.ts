// Palettes made by the user (picked by hand or taken from a dropped image), kept in the browser.
import type { Palette } from './modes/types';

const KEY = 'visualizer.palettes.v1';
const HEX = /^#[0-9a-f]{6}$/i;
const MAX = 24;

export const CUSTOM_PREFIX = 'custom-';

function valid(p: unknown): p is Palette {
  if (!p || typeof p !== 'object') return false;
  const r = p as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    r.id.startsWith(CUSTOM_PREFIX) &&
    typeof r.name === 'string' &&
    [r.bg, r.a, r.b, r.c].every((c) => typeof c === 'string' && HEX.test(c))
  );
}

export function loadCustomPalettes(): Palette[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (Array.isArray(raw)) return raw.filter(valid).slice(0, MAX);
  } catch {
    // Storage blocked or corrupt: no custom palettes
  }
  return [];
}

export function saveCustomPalettes(list: readonly Palette[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Not critical
  }
}

/** A new palette with a fresh id; the name falls back to "Custom N". */
export function newCustomPalette(existing: readonly Palette[], name: string, colors: Pick<Palette, 'bg' | 'a' | 'b' | 'c'>): Palette {
  let n = 1;
  while (existing.some((p) => p.id === `${CUSTOM_PREFIX}${n}`)) n++;
  return { id: `${CUSTOM_PREFIX}${n}`, name: name.trim().slice(0, 24) || `Custom ${n}`, ...colors };
}
