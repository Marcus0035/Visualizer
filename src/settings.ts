import type { Mode } from './modes/types';
import type { Effects } from './render/Renderer';

export interface Settings extends Effects {
  mode: string;
  /** Selected variant per mode id */
  variants: Record<string, number>;
  palette: string;
  /** Analysis gain, 0.25..4 */
  sensitivity: number;
  /** Speaker volume for demo and file sources, 0..1 */
  volume: number;
  inputDevice: string;
  panelOpen: boolean;
}

const KEY = 'visualizer.settings.v1';

export const DEFAULTS: Settings = {
  mode: 'oscilloscope',
  variants: {},
  palette: 'neon',
  sensitivity: 1,
  volume: 0.6,
  inputDevice: '',
  panelOpen: true,
  crt: false,
  grain: false,
  strobe: false,
};

/** Keep only stored values whose type matches the default, so a corrupt entry cannot break startup. */
export function parseSettings(raw: unknown): Settings {
  const s: Settings = { ...DEFAULTS, variants: {} };
  if (!raw || typeof raw !== 'object') return s;
  const r = raw as Record<string, unknown>;
  const target = s as unknown as Record<string, unknown>;
  for (const key of Object.keys(DEFAULTS) as (keyof Settings)[]) {
    if (key === 'variants') continue;
    const v = r[key];
    if (typeof v === typeof DEFAULTS[key] && (typeof v !== 'number' || Number.isFinite(v))) target[key] = v;
  }
  if (r.variants && typeof r.variants === 'object') {
    for (const [id, v] of Object.entries(r.variants)) {
      if (Number.isInteger(v) && (v as number) >= 0) s.variants[id] = v as number;
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

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Not critical
  }
}
