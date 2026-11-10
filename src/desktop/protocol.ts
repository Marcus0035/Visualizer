import type { Bands } from '../audio/analysis';
import type { SourceKind } from '../audio/AudioEngine';
import type { Palette } from '../modes/types';
import type { Settings } from '../settings';

/** Everything the settings window shows, sent by the visualizer after each change. */
export interface DesktopState {
  settings: Settings;
  source: { kind: SourceKind | null; label: string; playing: boolean };
  hasImage: boolean;
  canGoBack: boolean;
  canExportInBackground: boolean;
  customPalettes: Palette[];
  imagePalette: Palette | null;
  accent: string;
}

/** Visualizer -> settings window */
export type ToSettings =
  | { type: 'state'; state: DesktopState }
  | { type: 'meter'; bands: Bands }
  | { type: 'status'; text: string; error: boolean }
  | { type: 'reply'; id: number; ok: boolean; value?: unknown; error?: string };

/** Settings window (or the host) -> visualizer */
export type ToMain =
  | { type: 'call'; id: number; name: string; args: unknown[] }
  | { type: 'hello' }
  | { type: 'settingsVisible'; on: boolean }
  | { type: 'loadFile'; kind: 'audio' | 'image'; url: string; name: string };
