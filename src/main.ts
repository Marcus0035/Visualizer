import './style.css';
import { AudioEngine } from './audio/AudioEngine';
import { MODES } from './modes';
import { PALETTES } from './modes/palettes';
import type { Mode } from './modes/types';
import { type Effects, Renderer } from './render/Renderer';
import { loadSettings, saveSettings } from './settings';
import { h, icon } from './ui/dom';
import { Panel, type PanelActions } from './ui/Panel';

const settings = loadSettings();
if (!MODES.some((m) => m.id === settings.mode)) settings.mode = MODES[0].id;
if (!PALETTES.some((p) => p.id === settings.palette)) settings.palette = PALETTES[0].id;

const canvas = h('canvas', { class: 'stage' });
const fileInput = h('input', { type: 'file', accept: 'audio/*', hidden: true });
document.body.append(canvas, fileInput);

let renderer: Renderer;
try {
  renderer = new Renderer(canvas);
  MODES.forEach((m) => renderer.prepare(m));
} catch (err) {
  document.body.append(h('div', { class: 'fatal' }, `Nelze spustit grafiku: ${(err as Error).message}`));
  throw err;
}

const audio = new AudioEngine();
audio.sensitivity = settings.sensitivity;
audio.volume = settings.volume;

const currentMode = (): Mode => MODES.find((m) => m.id === settings.mode)!;
const variantOf = (m: Mode) => Math.min(settings.variants[m.id] ?? 0, m.variants.length - 1);

const currentPalette = () => PALETTES.find((p) => p.id === settings.palette)!;

function changed(): void {
  saveSettings(settings);
  document.documentElement.style.setProperty('--accent', currentPalette().a);
  panel.sync();
}

const actions: PanelActions = {
  modes: MODES,
  settings,
  source: () => ({ kind: audio.kind, label: audio.label, playing: audio.playing }),
  setMode(id) {
    settings.mode = id;
    changed();
  },
  setVariant(i) {
    settings.variants[settings.mode] = i;
    changed();
  },
  setPalette(id) {
    settings.palette = id;
    changed();
  },
  setSensitivity(v) {
    settings.sensitivity = audio.sensitivity = v;
    saveSettings(settings);
  },
  setVolume(v) {
    settings.volume = audio.volume = v;
    saveSettings(settings);
  },
  setEffect(key: keyof Effects, on) {
    settings[key] = on;
    changed();
  },
  useDemo: () => audio.useDemo(),
  async useInput(deviceId) {
    await audio.useInput(deviceId || undefined);
    settings.inputDevice = deviceId;
    saveSettings(settings);
  },
  useTab: () => audio.useTab(),
  pickFile: () => fileInput.click(),
  togglePlay() {
    audio.togglePlay();
    panel.sync();
  },
  listInputs: () => audio.listInputs(),
  toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  },
};

const panel = new Panel(actions);
document.body.append(panel.el, panel.opener);
changed();

async function playFile(file: File): Promise<void> {
  try {
    await audio.useFile(file);
    panel.setStatus('');
  } catch (err) {
    panel.setStatus(`Soubor nejde přehrát: ${(err as Error).message}`, true);
  }
  panel.sync();
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) void playFile(file);
  fileInput.value = '';
});

// Drag and drop an audio file anywhere
window.addEventListener('dragover', (e) => {
  e.preventDefault();
  document.body.classList.add('dragging');
});
window.addEventListener('dragleave', (e) => {
  if (e.relatedTarget === null) document.body.classList.remove('dragging');
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  document.body.classList.remove('dragging');
  const file = e.dataTransfer?.files[0];
  if (file) void playFile(file);
});

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const target = e.target as HTMLElement;
  if (target.matches('input, select, textarea')) return;

  const n = Number(e.key);
  if (n >= 1 && n <= MODES.length) return actions.setMode(MODES[n - 1].id);

  switch (e.key.toLowerCase()) {
    case 'v': {
      const m = currentMode();
      return actions.setVariant((variantOf(m) + 1) % m.variants.length);
    }
    case 'p': {
      const i = PALETTES.findIndex((p) => p.id === settings.palette);
      return actions.setPalette(PALETTES[(i + 1) % PALETTES.length].id);
    }
    case 'c':
      return actions.setEffect('crt', !settings.crt);
    case 'g':
      return actions.setEffect('grain', !settings.grain);
    case 's':
      return actions.setEffect('strobe', !settings.strobe);
    case 'f':
      return actions.toggleFullscreen();
    case 'h':
      panel.toggleOpen();
      return saveSettings(settings);
    case ' ':
      if (target.tagName === 'BUTTON') return; // let Space press the focused button
      e.preventDefault();
      return actions.togglePlay();
  }
});

// Hide the cursor and dim the panel when the mouse rests
let idleTimer = 0;
function wake(): void {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => document.body.classList.add('idle'), 3000);
}
window.addEventListener('pointermove', wake);
window.addEventListener('keydown', wake);
wake();

// Browsers only allow audio after a user gesture
const start = h(
  'div',
  { class: 'start' },
  h(
    'button',
    {
      class: 'start-btn',
      type: 'button',
      onclick: async () => {
        start.remove();
        await audio.useDemo();
        panel.sync();
      },
    },
    icon('Play', 22),
    h('span', {}, 'Spustit'),
  ),
  h('p', {}, 'Startuje s demo smyčkou. Pak si v panelu vyber mikrofon, soubor nebo zvuk systému.'),
);
document.body.append(start);

let last = performance.now();
const t0 = last;
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const a = audio.update(dt, now);
  const mode = currentMode();
  renderer.render(mode, a, (now - t0) / 1000, dt, currentPalette(), variantOf(mode), settings);
  panel.meter(a.bands);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
