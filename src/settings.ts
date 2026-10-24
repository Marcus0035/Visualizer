import type { Mode, ModeParam } from './modes/types';
export interface Effects {
  crt: boolean;
  grain: boolean;
  strobe: boolean;
  glitch: boolean;
}

export interface Settings extends Effects {
  mode: string;
  /** Selected variant per mode id */
  variants: Record<string, number>;
  /** Mode settings per mode id, then per param id */
  params: Record<string, Record<string, number>>;
  palette: string;
  /** Analysis gain, 0.25..4 */
  sensitivity: number;
  /** Speaker volume for demo and file sources, 0..1 */
  volume: number;
  inputDevice: string;
  /** Last open tab of the settings window */
  settingsTab: string;
  /** Overlay image look: 0 palette tones, 1 outline, 2 original */
  imageStyle: number;
  /** Overlay (image and text) size, 0.2..1 */
  overlaySize: number;
  text: string;
  font: string;
}

const KEY = 'visualizer.settings.v1';

export const DEFAULTS: Settings = {
  mode: 'techno',
  variants: {},
  params: {},
  palette: 'blood',
  sensitivity: 1,
  volume: 0.6,
  inputDevice: '',
  settingsTab: 'mode',
  crt: false,
  grain: false,
  strobe: false,
  glitch: false,
  imageStyle: 0,
  overlaySize: 0.7,
  text: '',
  font: 'anton',
};

/** Keys that would reach Object.prototype when used on a plain object */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Keep only stored values whose type matches the default, so a corrupt entry cannot break startup. */
export function parseSettings(raw: unknown): Settings {
  const s: Settings = { ...DEFAULTS, variants: {}, params: {} };
  if (!raw || typeof raw !== 'object') return s;
  const r = raw as Record<string, unknown>;
  const target = s as unknown as Record<string, unknown>;
  for (const key of Object.keys(DEFAULTS) as (keyof Settings)[]) {
    if (key === 'variants' || key === 'params') continue;
    const v = r[key];
    if (typeof v === typeof DEFAULTS[key] && (typeof v !== 'number' || Number.isFinite(v))) target[key] = v;
  }
  if (r.variants && typeof r.variants === 'object') {
    for (const [id, v] of Object.entries(r.variants)) {
      if (UNSAFE_KEYS.has(id)) continue;
      if (Number.isInteger(v) && (v as number) >= 0) s.variants[id] = v as number;
    }
  }
  if (r.params && typeof r.params === 'object') {
    for (const [mode, values] of Object.entries(r.params)) {
      if (UNSAFE_KEYS.has(mode) || !values || typeof values !== 'object') continue;
      for (const [id, v] of Object.entries(values)) {
        if (UNSAFE_KEYS.has(id)) continue;
        if (typeof v === 'number' && Number.isFinite(v)) (s.params[mode] ??= {})[id] = v;
      }
    }
  }
  return s;
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return parseSettings(JSON.parse(raw));
  } catch {
    // Storage blocked or corrupt: fall back to defaults
  }
  return parseSettings(null);
}

/** Selected variant of a mode, clamped to the variants it has. */
export function variantOf(mode: Mode, s: Settings): number {
  return Math.min(s.variants[mode.id] ?? 0, mode.variants.length - 1);
}

/** Value of one mode setting: stored value clamped to its range or options, else the default. */
export function paramValue(mode: Mode, p: ModeParam, s: Settings): number {
  const v = s.params[mode.id]?.[p.id];
  if (v === undefined) return p.default;
  if (p.options) return p.options.some((o) => o.value === v) ? v : p.default;
  return Math.min(p.max ?? Infinity, Math.max(p.min ?? -Infinity, v));
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Not critical
  }
}
