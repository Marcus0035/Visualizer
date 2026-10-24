import './style.css';
import { AudioEngine } from './audio/AudioEngine';
import { MODES } from './modes';
import { PALETTES } from './modes/palettes';
import type { Mode } from './modes/types';
import { forgetImage, loadImageFile, restoreImage } from './overlay/image';
import { FONTS, renderText } from './overlay/text';
import { Renderer } from './render/Renderer';
import { type Effects, loadSettings, paramValue, saveSettings, variantOf } from './settings';
import { h, icon } from './ui/dom';
import { Panel, type PanelActions } from './ui/Panel';

const settings = loadSettings();
if (!MODES.some((m) => m.id === settings.mode)) settings.mode = MODES[0].id;
// Forget variants and settings of modes that no longer exist
for (const store of [settings.variants, settings.params]) {
  for (const id of Object.keys(store)) if (!MODES.some((m) => m.id === id)) delete store[id];
}
if (!PALETTES.some((p) => p.id === settings.palette)) settings.palette = PALETTES[0].id;
if (!FONTS.some((f) => f.id === settings.font)) settings.font = FONTS[0].id;

const canvas = h('canvas', { class: 'stage' });
const fileInput = h('input', { type: 'file', accept: 'audio/*', hidden: true });
const imageInput = h('input', { type: 'file', accept: 'image/*', hidden: true });
document.body.append(canvas, fileInput, imageInput);

let renderer: Renderer;
try {
  renderer = new Renderer(canvas);
  MODES.forEach((m) => renderer.prepare(m));
} catch (err) {
  document.body.append(h('div', { class: 'fatal' }, `Nelze spustit grafiku: ${(err as Error).message}`));
  throw err;
}

// GPU reset (driver crash, suspend): simplest full recovery is a reload once the context is back
canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
canvas.addEventListener('webglcontextrestored', () => location.reload());

const audio = new AudioEngine();
audio.sensitivity = settings.sensitivity;
audio.volume = settings.volume;

const currentMode = (): Mode => MODES.find((m) => m.id === settings.mode)!;

const currentPalette = () => PALETTES.find((p) => p.id === settings.palette)!;

let hasImage = false;
let textJob = 0;
let imageJob = 0;

/** Re-render the overlay text; only the latest request wins. */
async function updateText(): Promise<void> {
  const job = ++textJob;
  const canvas = await renderText(settings.text, settings.font);
  if (job === textJob) renderer.setText(canvas);
}

async function useImage(file: File): Promise<void> {
  const job = ++imageJob;
  try {
    const { image, saved } = await loadImageFile(file);
    if (job !== imageJob) return;
    renderer.setImage(image);
    hasImage = true;
    panel.setStatus(saved ? '' : 'Obrázek je moc velký na uložení, po restartu zmizí.');
  } catch {
    if (job === imageJob) panel.setStatus('Obrázek nejde načíst.', true);
  }
  panel.sync();
}

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
  setParam(id, value) {
    (settings.params[settings.mode] ??= {})[id] = value;
    saveSettings(settings);
  },
  resetParams() {
    delete settings.params[settings.mode];
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
    const used = await audio.useInput(deviceId || undefined);
    if (!used) return; // superseded by another source
    settings.inputDevice = used;
    saveSettings(settings);
  },
  useTab: () => audio.useTab(),
  pickFile: () => fileInput.click(),
  togglePlay: () => audio.togglePlay(),
  listInputs: () => audio.listInputs(),
  toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  },
  hasImage: () => hasImage,
  pickImage: () => imageInput.click(),
  removeImage() {
    imageJob++;
    renderer.setImage(null);
    forgetImage();
    hasImage = false;
    panel.sync();
  },
  setImageStyle(i) {
    settings.imageStyle = i;
    changed();
  },
  setOverlaySize(v) {
    settings.overlaySize = v;
    saveSettings(settings);
  },
  setText(text) {
    settings.text = text;
    saveSettings(settings);
    void updateText();
  },
  saveSettings: () => saveSettings(settings),
  setFont(id) {
    settings.font = id;
    changed();
    void updateText();
  },
};

const panel = new Panel(actions);
document.body.append(panel.toolbar, panel.el, panel.toast);
audio.onchange = () => panel.sync();
changed();
void updateText();
const restoreJob = ++imageJob;
void restoreImage().then((img) => {
  if (!img || restoreJob !== imageJob) return;
  renderer.setImage(img);
  hasImage = true;
  panel.sync();
});

// A mouse click should not leave the button focused, otherwise Space presses it again
document.addEventListener('click', (e) => {
  if (e.detail > 0) (e.target as HTMLElement).closest('button')?.blur();
});

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

imageInput.addEventListener('change', () => {
  const file = imageInput.files?.[0];
  if (file) void useImage(file);
  imageInput.value = '';
});

// Drag and drop: images go to the overlay, anything else is tried as audio
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
  if (!file) return;
  if (file.type.startsWith('image/')) void useImage(file);
  // Before the start click the AudioContext cannot run yet
  else if (!start.isConnected) void playFile(file);
});

window.addEventListener('keydown', (e) => {
  if (start.isConnected) return; // nothing to control before the start click
  if (e.key === 'Escape' && panel.isOpen) return panel.close();
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  const target = e.target as HTMLElement;
  if (target.matches('input, select, textarea')) return;

  // Physical digit keys, so the Czech layout (+ e s c r) works without Shift
  const digit = /^(?:Digit|Numpad)(\d)$/.exec(e.code);
  if (digit) {
    const n = Number(digit[1]);
    if (n >= 1 && n <= MODES.length) actions.setMode(MODES[n - 1].id);
    return;
  }

  switch (e.key.toLowerCase()) {
    case 'v': {
      const m = currentMode();
      return actions.setVariant((variantOf(m, settings) + 1) % m.variants.length);
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
    case 'x':
      return actions.setEffect('glitch', !settings.glitch);
    case 'f':
      return actions.toggleFullscreen();
    case 'h':
      return panel.toggleOpen();
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
  h('p', {}, 'Startuje s demo smyčkou. Zdroj zvuku a vše ostatní najdeš v nastavení vpravo nahoře.'),
);
document.body.append(start);

let last = performance.now();
const t0 = last;
let reported = false;
function frame(now: number): void {
  requestAnimationFrame(frame); // first, so one failing frame cannot stop the loop
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  try {
    const a = audio.update(dt, now);
    const mode = currentMode();
    const params = Object.fromEntries((mode.params ?? []).map((p) => [p.id, paramValue(mode, p, settings)]));
    const scene = { mode, variant: variantOf(mode, settings), palette: currentPalette(), settings, params };
    renderer.render(scene, a, (now - t0) / 1000, dt);
    panel.meter(a.bands);
  } catch (err) {
    if (!reported) console.error(err);
    reported = true;
  }
}
requestAnimationFrame(frame);
