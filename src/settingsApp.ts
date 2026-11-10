/**
 * Desktop settings window (settings.html): every setting at once, applied live to the
 * visualizer window. It holds no state of its own: it mirrors what the visualizer sends
 * and forwards every change to it through the desktop host.
 */
import './style.css';
import type { SourceKind } from './audio/AudioEngine';
import { isDesktop, onMessage, post } from './desktop/bridge';
import type { DesktopState, ToSettings } from './desktop/protocol';
import { MODES } from './modes';
import type { Preset, PresetList } from './presets';
import { parseSettings } from './settings';
import { h } from './ui/dom';
import { Panel, type PanelActions } from './ui/Panel';

const settings = parseSettings(null);
let state: DesktopState | null = null;
let presets: PresetList = { names: [], startup: null };
let panel: Panel | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

/** Run an action in the visualizer window; resolves with its result. */
function call<T = void>(name: keyof PanelActions, ...args: unknown[]): Promise<T> {
  const id = nextId++;
  post({ type: 'call', id, name, args });
  return new Promise<T>((resolve, reject) => pending.set(id, { resolve: resolve as (v: unknown) => void, reject }));
}

/** Fire and forget: errors show up as status messages from the visualizer */
const send =
  (name: keyof PanelActions) =>
  (...args: unknown[]): void =>
    void call(name, ...args).catch(() => {});

const actions: PanelActions = {
  modes: MODES,
  settings,
  source: () => state?.source ?? { kind: null, label: '', playing: false },
  setMode: send('setMode'),
  setVariant: send('setVariant'),
  setParam(id, value) {
    // Mirror it right away, so the echo does not rebuild the slider being moved
    (settings.params[settings.mode] ??= {})[id] = value;
    send('setParam')(id, value);
  },
  resetParams: send('resetParams'),
  setPalette: send('setPalette'),
  addPalette: send('addPalette'),
  removePalette: send('removePalette'),
  setSensitivity: send('setSensitivity'),
  setVolume: send('setVolume'),
  setEffect: send('setEffect'),
  useDemo: () => call('useDemo'),
  useInput: (deviceId) => call('useInput', deviceId),
  useTab: () => call('useTab'),
  pickFile: () => post({ type: 'pick', kind: 'audio' }),
  togglePlay: send('togglePlay'),
  listInputs: () => call<MediaDeviceInfo[]>('listInputs'),
  toggleFullscreen: () => {},
  hasImage: () => state?.hasImage ?? false,
  pickImage: () => post({ type: 'pick', kind: 'image' }),
  removeImage: send('removeImage'),
  useDefaultImage: () => call('useDefaultImage'),
  startExport: send('startExport'),
  stopExport: send('stopExport'),
  canExportInBackground: () => state?.canExportInBackground ?? false,
  setImageChoice: send('setImageChoice'),
  setImageAmount: send('setImageAmount'),
  setOverlaySize: send('setOverlaySize'),
  setText: send('setText'),
  setFont: send('setFont'),
  saveSettings: () => {},
  setFilter: send('setFilter'),
  setFilterAmount: send('setFilterAmount'),
  setFilterBeat: send('setFilterBeat'),
  setFilterPalette: send('setFilterPalette'),
  setInvert: send('setInvert'),
  setAuto: send('setAuto'),
  setAutoBeats: send('setAutoBeats'),
  setAutoPart: send('setAutoPart'),
  setAutoSkip: send('setAutoSkip'),
  autoNow: send('autoNow'),
  randomize: send('randomize'),
  toggleTimeline: send('toggleTimeline'),
  back: send('back'),
  canGoBack: () => state?.canGoBack ?? false,
  // Presets live with the host: the look comes from the visualizer, the files from the host
  presets: () => presets,
  savePreset(name) {
    void call<Preset>('currentPreset', name)
      .then((preset) => post({ type: 'presetSave', preset }))
      .catch(() => {});
  },
  loadPreset: (name) => post({ type: 'presetLoad', name }),
  removePreset: (name) => post({ type: 'presetRemove', name }),
  setStartupPreset: (name) => post({ type: 'presetStartup', name }),
};

/** The tab source needs screen sharing, which the desktop WebKit view does not offer */
const SOURCES: SourceKind[] = ['demo', 'input', 'file'];

let palettesKey = '';
let imagePaletteKey = '';

function apply(next: DesktopState): void {
  const modeParams = (s: typeof settings) => JSON.stringify([s.mode, s.params[s.mode] ?? {}]);
  const paramsBefore = modeParams(settings);
  Object.assign(settings, next.settings);
  state = next;
  if (!panel) {
    panel = new Panel(actions, { layout: 'page', sources: SOURCES, fullscreen: false });
    document.body.append(panel.el, panel.toast);
  } else if (modeParams(settings) !== paramsBefore) panel.refreshParams();
  const pk = JSON.stringify(next.customPalettes);
  if (pk !== palettesKey) {
    palettesKey = pk;
    panel.setCustomPalettes(next.customPalettes);
  }
  const ik = JSON.stringify(next.imagePalette);
  if (ik !== imagePaletteKey) {
    imagePaletteKey = ik;
    panel.setImagePalette(next.imagePalette);
  }
  panel.sync();
}

onMessage<ToSettings>((msg) => {
  switch (msg.type) {
    case 'state':
      return apply(msg.state);
    case 'meter':
      return panel?.meter(msg.bands);
    case 'status':
      return panel?.setStatus(msg.text, msg.error);
    case 'presets':
      presets = msg.list;
      return panel?.renderPresets();
    case 'reply': {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.ok) p?.resolve(msg.value);
      else p?.reject(new Error(msg.error));
    }
  }
});

if (isDesktop) post({ type: 'ready' });
else document.body.append(h('p', { class: 'settings-offline' }, 'This page is the settings window of the Visualizer desktop app.'));
