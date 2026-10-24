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

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    // Storage blocked or corrupt: fall back to defaults
  }
  return { ...DEFAULTS, variants: {} };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Not critical
  }
}
