import './style.css';
import { AudioEngine } from './audio/AudioEngine';
import { AUTO_EVERY, AutoClock, EVERYTHING, autoStep } from './autopilot';
import { MODES } from './modes';
import { PALETTES } from './modes/palettes';
import type { Mode, Palette } from './modes/types';
import { type OverlayImage, forgetImage, loadImageFile, restoreImage } from './overlay/image';
import { IMAGE_PALETTE_ID, paletteFromCanvas } from './overlay/imagePalette';
import { FONTS, renderText } from './overlay/text';
import { EXPORT_SIZES, type ExportFormat, VideoRecorder, download, exportFileName, pickType } from './export/recorder';
import { FILTERS } from './render/filters';
import { Renderer } from './render/Renderer';
import { DEFAULTS, type Effects, loadSettings, paramValue, saveSettings, variantOf } from './settings';
import { h, icon } from './ui/dom';
import { IMAGE_CHOICES, Panel, type PanelActions } from './ui/Panel';

const settings = loadSettings();
if (!MODES.some((m) => m.id === settings.mode)) settings.mode = MODES[0].id;
// Forget variants and settings of modes that no longer exist
for (const store of [settings.variants, settings.params]) {
  for (const id of Object.keys(store)) if (!MODES.some((m) => m.id === id)) delete store[id];
}
// The image palette comes back once the stored image is restored
if (settings.palette !== IMAGE_PALETTE_ID && !PALETTES.some((p) => p.id === settings.palette)) settings.palette = PALETTES[0].id;
if (!FONTS.some((f) => f.id === settings.font)) settings.font = FONTS[0].id;
if (!Number.isInteger(settings.filter) || !FILTERS[settings.filter]) settings.filter = 0;
settings.filterAmount = Math.min(1, Math.max(0, settings.filterAmount));
for (const [key, , names] of IMAGE_CHOICES) {
  if (!Number.isInteger(settings[key]) || settings[key] < 0 || settings[key] >= names.length) settings[key] = DEFAULTS[key];
}
settings.imageOpacity = Math.min(1, Math.max(0.1, settings.imageOpacity));
settings.imageGlow = Math.min(1, Math.max(0, settings.imageGlow));
if (!AUTO_EVERY.includes(settings.autoBeats)) settings.autoBeats = 1;
settings.autoSkip = [...new Set(settings.autoSkip.filter((id) => MODES.some((m) => m.id === id)))];
// The autopilot needs at least one mode to pick from
if (settings.autoSkip.length >= MODES.length) settings.autoSkip = [];

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

let hasImage = false;
/** Colors taken from the user image, offered as the first palette */
let imagePalette: Palette | null = null;

const allPalettes = (): Palette[] => (imagePalette ? [imagePalette, ...PALETTES] : PALETTES);
const currentPalette = (): Palette => allPalettes().find((p) => p.id === settings.palette) ?? PALETTES[0];

function showImage(img: OverlayImage): void {
  renderer.setImage(img);
  hasImage = true;
  imagePalette = paletteFromCanvas(img.canvas);
  panel.setImagePalette(imagePalette);
}
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
    showImage(image);
    // A new image turns straight into a motif in its own colors
    settings.mode = 'motif';
    settings.palette = IMAGE_PALETTE_ID;
    changed();
    panel.setStatus(saved ? '' : 'Obrázek je moc velký na uložení, po restartu zmizí.');
  } catch {
    if (job === imageJob) panel.setStatus('Obrázek nejde načíst.', true);
  }
  panel.sync();
}

let recorder: VideoRecorder | null = null;
let recordTimer = 0;

/** Record the stage in the chosen format with the source audio; a file source plays once from the start. */
function startExport(format: ExportFormat): void {
  if (recorder) return;
  const type = typeof MediaRecorder === 'undefined' ? null : pickType((t) => MediaRecorder.isTypeSupported(t));
  if (!type) {
    panel.setStatus('Tenhle prohlížeč neumí nahrávat video.', true);
    return;
  }
  renderer.setFixedSize(EXPORT_SIZES[format]);
  renderer.resize(); // the first recorded frame already has the export size
  canvas.classList.add('exporting');
  try {
    recorder = new VideoRecorder(canvas, audio.recordStream(), type, format);
  } catch (err) {
    renderer.setFixedSize(null);
    canvas.classList.remove('exporting');
    panel.setStatus(`Nahrávání nejde spustit: ${(err as Error).message}`, true);
    return;
  }
  const media = audio.playFromStart();
  media?.addEventListener('ended', () => void stopExport(), { once: true });
  panel.setRecording(0);
  recordTimer = window.setInterval(() => recorder && panel.setRecording(recorder.seconds), 250);
}

async function stopExport(): Promise<void> {
  const r = recorder;
  if (!r) return;
  recorder = null;
  clearInterval(recordTimer);
  panel.setRecording(null);
  const blob = await r.stop();
  renderer.setFixedSize(null);
  canvas.classList.remove('exporting');
  audio.restoreLoop();
  download(blob, exportFileName(r.type, r.format, new Date()));
  panel.setStatus(r.type.startsWith('video/mp4') ? 'Video je stažené.' : 'Video je stažené (WebM, tenhle prohlížeč neumí MP4).');
}

const autoClock = new AutoClock();

/** Autopilot jump: new mode, variant, settings... as allowed in the Autopilot tab. */
function autoJump(): void {
  autoClock.reset();
  autoStep(settings, { modes: MODES, palettes: PALETTES, filterCount: FILTERS.length });
  panel.refreshParams();
  changed();
}

/** Earlier looks for the back button, newest last */
const history: string[] = [];

function look(): string {
  const { mode, variants, params, palette, filter } = settings;
  return JSON.stringify({ mode, variants, params, palette, filter });
}

/** Random button and scroll wheel: everything new, like flipping through a feed. */
function randomize(): void {
  history.push(look());
  if (history.length > 100) history.shift();
  autoClock.reset();
  autoStep(settings, { modes: MODES, palettes: PALETTES, filterCount: FILTERS.length }, Math.random, EVERYTHING);
  panel.refreshParams();
  changed();
}

function back(): void {
  const prev = history.pop();
  if (!prev) return;
  Object.assign(settings, JSON.parse(prev));
  autoClock.reset();
  panel.refreshParams();
  changed();
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
    imagePalette = null;
    panel.setImagePalette(null);
    if (settings.palette === IMAGE_PALETTE_ID) settings.palette = PALETTES[0].id;
    changed();
  },
  startExport,
  stopExport: () => void stopExport(),
  setImageChoice(key, i) {
    settings[key] = i;
    changed();
  },
  setImageAmount(key, v) {
    settings[key] = v;
    saveSettings(settings);
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
  setFilter(i) {
    settings.filter = i;
    changed();
  },
  setFilterAmount(v) {
    settings.filterAmount = v;
    saveSettings(settings);
  },
  setFilterBeat(on) {
    settings.filterBeat = on;
    changed();
  },
  setAuto(on) {
    settings.auto = on;
    autoClock.reset();
    changed();
  },
  setAutoBeats(kicks) {
    settings.autoBeats = kicks;
    changed();
  },
  setAutoPart(key, on) {
    settings[key] = on;
    changed();
  },
  setAutoSkip(modeId, skip) {
    const rest = settings.autoSkip.filter((id) => id !== modeId);
    if (skip && rest.length + 1 >= MODES.length) return panel.setStatus('Aspoň jeden režim musí v autopilotu zůstat.');
    settings.autoSkip = skip ? [...rest, modeId] : rest;
    changed();
  },
  autoNow: () => autoJump(),
  randomize: () => randomize(),
  back: () => back(),
  canGoBack: () => history.length > 0,
  setFont(id) {
    settings.font = id;
    changed();
    void updateText();
  },
};

const panel = new Panel(actions);
document.body.append(panel.leftbar, panel.toolbar, panel.el, panel.exportDialog, panel.toast);
audio.onchange = () => panel.sync();
changed();
void updateText();
const restoreJob = ++imageJob;
void restoreImage().then((img) => {
  if (!img || restoreJob !== imageJob) return;
  showImage(img);
  changed();
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
      const list = allPalettes();
      const i = list.findIndex((p) => p.id === settings.palette);
      return actions.setPalette(list[(i + 1) % list.length].id);
    }
    case 'c':
      return actions.setEffect('crt', !settings.crt);
    case 'g':
      return actions.setEffect('grain', !settings.grain);
    case 's':
      return actions.setEffect('strobe', !settings.strobe);
    case 'x':
      return actions.setEffect('glitch', !settings.glitch);
    case 'n':
      return actions.setFilter((settings.filter + 1) % FILTERS.length);
    case 'a':
      actions.setAuto(!settings.auto);
      return panel.setStatus(settings.auto ? 'Autopilot zapnutý' : 'Autopilot vypnutý');
    case 'r':
      return autoJump();
    case 'arrowright':
    case 'arrowdown':
      if (panel.isOpen) return;
      e.preventDefault();
      return randomize();
    case 'arrowleft':
    case 'arrowup':
      if (panel.isOpen) return;
      e.preventDefault();
      return back();
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

// Doomscroll: wheel down = something new, up = back. One step per scroll gesture, so a
// touchpad's long inertia stream does not skip through dozens of looks
let lastWheel = 0;
window.addEventListener(
  'wheel',
  (e) => {
    if (start.isConnected || panel.isOpen || Math.abs(e.deltaY) < 2) return;
    const now = performance.now();
    if (now - lastWheel > 250) {
      if (e.deltaY > 0) randomize();
      else back();
    }
    lastWheel = now;
  },
  { passive: true },
);

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
/** Local dev server: start with its track (vite.config.ts) instead of the demo loop. */
async function useDevAudio(): Promise<boolean> {
  try {
    const res = await fetch('/dev-audio');
    if (!res.ok) return false;
    const blob = await res.blob();
    const name = decodeURIComponent(res.headers.get('X-Audio-Name') ?? 'skladba');
    await audio.useFile(new File([blob], name, { type: blob.type }));
    return true;
  } catch {
    return false;
  }
}

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
        if (!(import.meta.env.DEV && (await useDevAudio()))) await audio.useDemo();
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
    if (settings.auto && autoClock.tick(a.beat, a.level, dt, settings.autoBeats)) autoJump();
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
