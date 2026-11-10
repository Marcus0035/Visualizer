// Presets: a saved look (settings and image), kept by the desktop host as files in the data
// folder. One preset may be marked for startup; the host hands it to the visualizer page
// before its scripts run (window.__visualizerStartupPreset).
import { type Settings, parseSettings } from './settings';

export interface Preset {
  name: string;
  settings: Settings;
  /** Overlay image as a data URL, null when the look has no image */
  image: string | null;
}

export interface PresetList {
  names: string[];
  /** Preset that opens with the app */
  startup: string | null;
}

/** Settings that belong to this machine or the current track, not to a look: a preset never changes them */
const KEEP = ['inputDevice', 'volume', 'settingsTab', 'timeline', 'timelineSnap'] as const;

/** The look of `stored` on top of `current`, keeping what belongs to the machine and track. */
export function presetSettings(current: Settings, stored: unknown): Settings {
  const next = parseSettings(stored);
  const target = next as unknown as Record<string, unknown>;
  for (const key of KEEP) target[key] = structuredClone(current[key]);
  return next;
}

/** A preset from untrusted JSON (file or message), or null when it is not one. */
export function parsePreset(raw: unknown): Preset | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== 'string' || !r.name.trim() || !r.settings || typeof r.settings !== 'object') return null;
  const image = typeof r.image === 'string' && r.image.startsWith('data:image/') ? r.image : null;
  return { name: r.name.trim(), settings: parseSettings(r.settings), image };
}

/** Desktop app: the startup preset the host injected, if any. */
export function startupPreset(): Preset | null {
  return parsePreset((window as unknown as { __visualizerStartupPreset?: unknown }).__visualizerStartupPreset);
}
