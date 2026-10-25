import type { Bands } from '../audio/analysis';
import type { SourceKind } from '../audio/AudioEngine';
import { PALETTES } from '../modes/palettes';
import type { Mode, Palette } from '../modes/types';
import { AUTO_EVERY } from '../autopilot';
import { IMAGE_PALETTE_ID } from '../overlay/imagePalette';
import { FONTS } from '../overlay/text';
import type { ExportFormat } from '../export/recorder';
import { FILTERS } from '../render/filters';
import { type Effects, type Settings, paramValue, variantOf } from '../settings';
import { h, icon, toggle } from './dom';

/** What the settings window needs from the app. */
export interface PanelActions {
  modes: Mode[];
  settings: Settings;
  source(): { kind: SourceKind | null; label: string; playing: boolean };
  setMode(id: string): void;
  setVariant(index: number): void;
  setParam(id: string, value: number): void;
  resetParams(): void;
  setPalette(id: string): void;
  setSensitivity(value: number): void;
  setVolume(value: number): void;
  setEffect(key: keyof Effects, on: boolean): void;
  useDemo(): Promise<void>;
  useInput(deviceId: string): Promise<void>;
  useTab(): Promise<void>;
  pickFile(): void;
  togglePlay(): void;
  listInputs(): Promise<MediaDeviceInfo[]>;
  toggleFullscreen(): void;
  hasImage(): boolean;
  pickImage(): void;
  removeImage(): void;
  /** Start a video export, or stop the running one */
  startExport(format: ExportFormat, background: boolean): void;
  /** Stops a recording (and downloads it) or cancels a background export */
  stopExport(): void;
  /** A loaded track that can be turned into a video in the background */
  canExportInBackground(): boolean;
  setImageChoice(key: ImageChoice, index: number): void;
  setImageAmount(key: 'imageOpacity' | 'imageGlow' | 'imageFade', value: number): void;
  setOverlaySize(value: number): void;
  setText(text: string): void;
  setFont(id: string): void;
  saveSettings(): void;
  setFilter(index: number): void;
  setFilterAmount(value: number): void;
  setFilterBeat(on: boolean): void;
  setAuto(on: boolean): void;
  setAutoBeats(kicks: number): void;
  setAutoPart(key: AutoPart, on: boolean): void;
  setAutoSkip(modeId: string, skip: boolean): void;
  autoNow(): void;
  randomize(): void;
  back(): void;
  canGoBack(): boolean;
}

export type AutoPart = 'autoMode' | 'autoVariant' | 'autoParams' | 'autoPalette' | 'autoFilter';

const TABS = [
  { id: 'sound', label: 'Sound', icon: 'AudioLines' },
  { id: 'mode', label: 'Mode', icon: 'Zap' },
  { id: 'look', label: 'Colors & effects', icon: 'Palette' },
  { id: 'filters', label: 'Filters', icon: 'Film' },
  { id: 'auto', label: 'Autopilot', icon: 'Shuffle' },
  { id: 'overlay', label: 'Image & text', icon: 'ImagePlus' },
  { id: 'keys', label: 'Shortcuts', icon: 'Keyboard' },
] as const;

type TabId = (typeof TABS)[number]['id'];

/** Image settings shown as chips; the index is the stored value */
export const IMAGE_CHOICES = [
  ['imageStyle', 'Look', ['Palette colors', 'Outline', 'Original']],
  ['imageShape', 'Crop', ['Original', 'Circle', 'Square', 'Hexagon', 'Heart']],
  ['imageMotion', 'Motion on beat', ['Still', 'Pulse', 'Bounce', 'Spin', 'Shake']],
  ['imagePos', 'Position', ['Center', 'Top', 'Bottom', 'Corner']],
] as const;

export type ImageChoice = (typeof IMAGE_CHOICES)[number][0];

const SOURCES: { kind: SourceKind; label: string; icon: string }[] = [
  { kind: 'demo', label: 'Demo', icon: 'Music' },
  { kind: 'input', label: 'Input', icon: 'Mic' },
  { kind: 'file', label: 'File', icon: 'Upload' },
  { kind: 'tab', label: 'Tab', icon: 'Monitor' },
];

const SHORTCUTS: [string, string][] = [
  ['V', 'next variant'],
  ['P', 'next palette'],
  ['C', 'CRT screen'],
  ['G', 'grain'],
  ['S', 'strobe on beat'],
  ['X', 'glitch on beat'],
  ['N', 'next filter'],
  ['A', 'autopilot on / off'],
  ['R', 'autopilot: change now'],
  ['Wheel down / right arrow', 'random visual'],
  ['Wheel up / left arrow', 'back to previous'],
  ['Space', 'play / pause file'],
  ['F', 'fullscreen'],
  ['H', 'open / close settings'],
  ['Esc', 'close settings'],
];

const BANDS = ['Bass', 'Mids', 'Highs'];

function card(title: string, ...children: (Node | null)[]): HTMLElement {
  return h('section', { class: 'card' }, h('h2', {}, title), ...children);
}

function slider(label: string, min: number, max: number, step: number, value: number, set: (v: number) => void) {
  return h(
    'label',
    { class: 'slider' },
    h('span', {}, label),
    h('input', {
      type: 'range',
      min: String(min),
      max: String(max),
      step: String(step),
      value: String(value),
      oninput: (e: Event) => set(Number((e.target as HTMLInputElement).value)),
    }),
  );
}

/** Top-right toolbar plus a full-window settings dialog split into tabs. */
export class Panel {
  /** The settings dialog */
  readonly el: HTMLElement;
  /** Small buttons in the top-right corner */
  readonly toolbar: HTMLElement;
  /** Random and back buttons in the top-left corner */
  readonly leftbar: HTMLElement;
  private readonly backBtn: HTMLButtonElement;
  /** Short messages; sits above everything so it is seen with the dialog open or closed */
  readonly toast = h('div', { class: 'toast', role: 'status' });

  private readonly status = h('p', { class: 'status', 'aria-live': 'polite' });
  private toastTimer = 0;
  private readonly meters: HTMLElement[] = [];
  private readonly sourceBtns = new Map<SourceKind, HTMLButtonElement>();
  private readonly modeBtns = new Map<string, HTMLButtonElement>();
  private readonly paletteBtns = new Map<string, HTMLButtonElement>();
  private readonly paletteGrid = h('div', { class: 'palette-grid' });
  private readonly variantBox = h('div', { class: 'chips' });
  private readonly sourceExtra = h('div', { class: 'source-extra' });
  private readonly fxSetters = new Map<keyof Effects, (on: boolean) => void>();
  private readonly paramsBox = h('div', { class: 'params' });
  private readonly paramsCard: HTMLElement;
  private readonly imageChoiceBtns = new Map<ImageChoice, HTMLButtonElement[]>();
  private readonly fontBtns = new Map<string, HTMLButtonElement>();
  private readonly removeImageBtn: HTMLButtonElement;
  private readonly filterBtns: HTMLButtonElement[] = [];
  private filterBeatSet: (on: boolean) => void = () => {};
  private readonly autoBtn: HTMLButtonElement;
  private readonly autoSetters = new Map<AutoPart | 'auto', (on: boolean) => void>();
  private readonly autoBeatsBtns = new Map<number, HTMLButtonElement>();
  private readonly autoModeBtns = new Map<string, HTMLButtonElement>();
  private readonly tabBtns = new Map<TabId, HTMLButtonElement>();
  private readonly tabPanels = new Map<TabId, HTMLElement>();
  private readonly closeBtn: HTMLButtonElement;
  private chipsFor = '';
  private paramsFor = '';
  /** A mode slider is being dragged: do not rebuild the sliders under the pointer */
  private draggingParam = false;
  private extraFor = '';
  private playBtn: HTMLButtonElement | null = null;
  private opener: HTMLElement | null = null;
  private readonly settingsBtn: HTMLButtonElement;
  /** Download button; shows the recording time and stops the export while recording */
  private readonly exportBtn: HTMLButtonElement;
  private readonly exportLabel = h('span', { class: 'rec-time' });
  /** Choose PC or phone video */
  readonly exportDialog: HTMLDialogElement;
  private readonly exportNote = h('p', { class: 'hint' });
  /** Recording or rendering in the background */
  private exportBusy = false;
  private background = true;
  private readonly backgroundRow: HTMLElement;
  /** Elements made inert while the dialog is open (focus stays inside) */
  private inerted: HTMLElement[] = [];

  constructor(private readonly app: PanelActions) {
    const s = app.settings;

    // Toolbar
    const miniMeter = h('div', { class: 'meter', title: 'Bass / mids / highs' });
    for (let i = 0; i < 3; i++) {
      const bar = h('i');
      this.meters.push(bar);
      miniMeter.append(bar);
    }
    this.settingsBtn = h(
      'button',
      { class: 'tool-btn', title: 'Settings (H)', 'aria-label': 'Settings', onclick: () => this.open() },
      icon('Settings', 18),
    );
    this.autoBtn = h(
      'button',
      { class: 'tool-btn', title: 'Autopilot (A)', 'aria-label': 'Autopilot', 'aria-pressed': 'false', onclick: () => app.setAuto(!s.auto) },
      icon('Shuffle', 18),
    );
    this.exportBtn = h(
      'button',
      {
        class: 'tool-btn export-btn',
        title: 'Download video',
        'aria-label': 'Download video',
        onclick: () => (this.exportBusy ? app.stopExport() : this.openExport()),
      },
      icon('Download', 18),
      this.exportLabel,
    );
    const option = (format: ExportFormat, iconName: string, title: string, detail: string) =>
      h(
        'button',
        {
          type: 'button',
          class: `export-option ${format}`,
          onclick: () => {
            this.exportDialog.close();
            app.startExport(format, this.background && app.canExportInBackground());
          },
        },
        h('i', { class: 'export-frame' }, icon(iconName, 26)),
        h('strong', {}, title),
        h('small', {}, detail),
      );
    this.exportDialog = h(
      'dialog',
      { class: 'export-dialog', 'aria-labelledby': 'export-title' },
      h(
        'header',
        { class: 'modal-head' },
        h('h1', { id: 'export-title' }, 'Download video'),
        h(
          'button',
          { type: 'button', class: 'icon-btn close', title: 'Close (Esc)', 'aria-label': 'Close', onclick: () => this.exportDialog.close() },
          icon('X', 20),
        ),
      ),
      h(
        'div',
        { class: 'export-options' },
        option('pc', 'Monitor', 'For PC', 'Landscape 16:9, 1920 × 1080'),
        option('phone', 'Smartphone', 'For phone', 'Portrait 9:16, 1080 × 1920'),
      ),
      (this.backgroundRow = h(
        'div',
        { class: 'export-background' },
        toggle('In the background', true, (on) => {
          this.background = on;
          this.updateExportNote();
        }).row,
      )),
      this.exportNote,
    );
    // Click outside the window closes it
    this.exportDialog.addEventListener('click', (e) => {
      if (e.target === this.exportDialog) this.exportDialog.close();
    });
    this.toolbar = h(
      'div',
      { class: 'toolbar' },
      miniMeter,
      this.exportBtn,
      this.autoBtn,
      h(
        'button',
        { class: 'tool-btn', title: 'Fullscreen (F)', 'aria-label': 'Fullscreen', onclick: () => app.toggleFullscreen() },
        icon('Maximize', 18),
      ),
      this.settingsBtn,
    );

    this.backBtn = h(
      'button',
      { class: 'tool-btn', title: 'Back (wheel up)', 'aria-label': 'Back to the previous visual', onclick: () => app.back() },
      icon('Undo2', 18),
    );
    this.leftbar = h(
      'div',
      { class: 'toolbar left' },
      h(
        'button',
        { class: 'tool-btn random-btn', title: 'Random visual (wheel down)', onclick: () => app.randomize() },
        icon('Dices', 18),
        h('span', {}, 'Random'),
      ),
      this.backBtn,
    );

    // Sound
    const sources = h('div', { class: 'segmented' });
    for (const src of SOURCES) {
      const b = h(
        'button',
        { type: 'button', 'aria-pressed': 'false', onclick: () => this.chooseSource(src.kind) },
        icon(src.icon, 18),
        h('span', {}, src.label),
      );
      this.sourceBtns.set(src.kind, b);
      sources.append(b);
    }
    const levels = h('div', { class: 'levels' });
    BANDS.forEach((name) => {
      const fill = h('i');
      this.meters.push(fill);
      levels.append(h('div', { class: 'level' }, h('span', {}, name), h('div', { class: 'level-bar' }, fill)));
    });

    // Mode
    const modes = h('div', { class: 'mode-grid' });
    app.modes.forEach((m, i) => {
      const b = h(
        'button',
        { type: 'button', class: 'mode-btn', 'aria-pressed': 'false', onclick: () => app.setMode(m.id) },
        icon(m.icon, 22),
        h('span', {}, m.name),
        h('kbd', {}, String(i + 1)),
      );
      this.modeBtns.set(m.id, b);
      modes.append(b);
    });

    // Look
    const palettes = this.paletteGrid;
    for (const p of PALETTES) palettes.append(this.paletteButton(p));
    const fx = h('div', { class: 'switches' });
    const fxDefs: [keyof Effects, string, string?][] = [
      ['sections', 'Calm intro and breaks', 'With a loaded track, effects rest in the quiet parts'],
      ['strictPalette', 'Palette colors only', 'Filters, image and mode cannot add other colors'],
      ['crt', 'CRT screen', 'Curvature, scanlines and color shift'],
      ['grain', 'Grain', 'Film-like noise'],
      ['strobe', 'Strobe on beat', 'Flashing, take care if sensitive to light'],
      ['glitch', 'Glitch on beat', 'The picture tears into strips on the kick'],
    ];
    for (const [key, label, hint] of fxDefs) {
      const t = toggle(label, s[key], (on) => app.setEffect(key, on), hint);
      this.fxSetters.set(key, t.set);
      fx.append(t.row);
    }

    // Overlay
    this.removeImageBtn = h(
      'button',
      { class: 'icon-btn', title: 'Remove image', 'aria-label': 'Remove image', onclick: () => app.removeImage() },
      icon('Trash2'),
    );
    const imageChoices = IMAGE_CHOICES.flatMap(([key, title, names]) => {
      const chips = h('div', { class: 'chips' });
      const btns = names.map((name, i) => h('button', { type: 'button', class: 'chip', onclick: () => app.setImageChoice(key, i) }, name));
      this.imageChoiceBtns.set(key, btns);
      chips.append(...btns);
      return [h('h3', {}, title), chips];
    });
    let typing = 0;
    const textInput = h(
      'label',
      { class: 'text-input' },
      icon('Type'),
      h('input', {
        type: 'text',
        value: s.text,
        maxLength: 80,
        placeholder: 'Text, vertical bar = new line',
        'aria-label': 'Text on screen',
        oninput: (e: Event) => {
          const value = (e.target as HTMLInputElement).value;
          clearTimeout(typing);
          typing = window.setTimeout(() => app.setText(value), 200);
        },
      }),
    );
    const fonts = h('div', { class: 'chips' });
    for (const f of FONTS) {
      const b = h('button', { type: 'button', class: 'chip', style: { fontFamily: `"${f.family}"` }, onclick: () => app.setFont(f.id) }, f.name);
      this.fontBtns.set(f.id, b);
      fonts.append(b);
    }

    this.paramsCard = card('Mode settings', this.paramsBox);
    this.paramsBox.addEventListener('pointerdown', () => (this.draggingParam = true));
    window.addEventListener('pointerup', () => (this.draggingParam = false));
    window.addEventListener('pointercancel', () => (this.draggingParam = false));

    // Filters
    const filters = h('div', { class: 'filter-grid' });
    FILTERS.forEach((f, i) => {
      const b = h(
        'button',
        { type: 'button', class: 'filter-btn', 'aria-pressed': 'false', onclick: () => app.setFilter(i) },
        icon(f.icon, 20),
        h('span', { class: 'filter-name' }, f.name),
        h('small', {}, f.hint),
      );
      this.filterBtns.push(b);
      filters.append(b);
    });
    const filterBeat = toggle('Stronger on kick', s.filterBeat, (on) => app.setFilterBeat(on), 'The filter gets stronger on every kick');
    this.filterBeatSet = filterBeat.set;

    // Autopilot
    const autoOn = toggle('Autopilot', s.auto, (on) => app.setAuto(on), 'Switches modes and their settings by itself, on the kick');
    this.autoSetters.set('auto', autoOn.set);
    const autoBeats = h('div', { class: 'chips' });
    for (const n of AUTO_EVERY) {
      const b = h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', onclick: () => app.setAutoBeats(n) }, String(n));
      this.autoBeatsBtns.set(n, b);
      autoBeats.append(b);
    }
    const autoParts = h('div', { class: 'switches' });
    const partDefs: [AutoPart, string, string][] = [
      ['autoMode', 'Mode', 'Switches between the selected modes'],
      ['autoVariant', 'Variant', 'E.g. tunnel, lasers, blocks'],
      ['autoParams', 'Mode settings', 'Speed, density, flash, brightness'],
      ['autoPalette', 'Colors', 'Only dark single-color palettes'],
      ['autoFilter', 'Filter', 'Sometimes a full-screen filter, sometimes a clean picture'],
    ];
    for (const [key, label, hint] of partDefs) {
      const t = toggle(label, s[key], (on) => app.setAutoPart(key, on), hint);
      this.autoSetters.set(key, t.set);
      autoParts.append(t.row);
    }
    const autoModes = h('div', { class: 'chips' });
    for (const m of app.modes) {
      const b = h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false' }, m.name);
      b.addEventListener('click', () => app.setAutoSkip(m.id, !s.autoSkip.includes(m.id)));
      this.autoModeBtns.set(m.id, b);
      autoModes.append(b);
    }

    const panels: Record<TabId, HTMLElement[]> = {
      sound: [
        card('Sound source', sources, this.sourceExtra, this.status),
        card(
          'Levels',
          slider('Sensitivity', 0.25, 4, 0.05, s.sensitivity, (v) => app.setSensitivity(v)),
          slider('Volume', 0, 1, 0.01, s.volume, (v) => app.setVolume(v)),
          levels,
          h('small', { class: 'hint' }, 'Set the sensitivity so the bass almost reaches the top on the kick.'),
        ),
      ],
      mode: [card('Mode', modes, h('h3', {}, 'Variant'), this.variantBox), this.paramsCard],
      look: [h('section', { class: 'card wide' }, h('h2', {}, 'Palette'), palettes), card('Effects', fx)],
      filters: [
        h('section', { class: 'card wide' }, h('h2', {}, 'Full-screen filter'), filters),
        card(
          'Filter settings',
          slider('Strength', 0, 1, 0.01, s.filterAmount, (v) => app.setFilterAmount(v)),
          filterBeat.row,
          h('small', { class: 'hint' }, 'The filter runs over any mode, image and text.'),
        ),
      ],
      auto: [
        card(
          'Autopilot',
          autoOn.row,
          h('div', { class: 'param-options' }, h('span', {}, 'Change every N kicks'), autoBeats),
          h('button', { type: 'button', class: 'btn', onclick: () => app.autoNow() }, icon('Shuffle'), h('span', {}, 'Change now')),
          h('small', { class: 'hint' }, 'Without a clear kick it changes by time. Manual changes still work.'),
        ),
        card('What changes', autoParts),
        card('Modes in the autopilot', autoModes, h('small', { class: 'hint' }, 'The autopilot skips modes that are off.')),
      ],
      overlay: [
        card(
          'Image',
          h(
            'div',
            { class: 'overlay-row' },
            h('button', { type: 'button', class: 'btn', onclick: () => app.pickImage() }, icon('ImagePlus'), h('span', {}, 'Choose image')),
            this.removeImageBtn,
          ),
          ...imageChoices,
          slider('Opacity', 0.1, 1, 0.01, s.imageOpacity, (v) => app.setImageAmount('imageOpacity', v)),
          slider('Glow around', 0, 1, 0.01, s.imageGlow, (v) => app.setImageAmount('imageGlow', v)),
          slider('Fade out edges', 0, 1, 0.01, s.imageFade, (v) => app.setImageAmount('imageFade', v)),
          h('small', { class: 'hint' }, 'You can also drop an image onto the window.'),
        ),
        card('Text', textInput, h('h3', {}, 'Font'), fonts),
        card('Size', slider('Image and text', 0.2, 1, 0.01, s.overlaySize, (v) => app.setOverlaySize(v))),
      ],
      keys: [
        card(
          'Keyboard shortcuts',
          h(
            'dl',
            { class: 'keys' },
            ...[[`1 - ${app.modes.length}`, 'mode'], ...SHORTCUTS].flatMap(([k, v]) => [h('dt', {}, h('kbd', {}, k)), h('dd', {}, v)]),
          ),
        ),
      ],
    };

    const tablist = h('nav', { class: 'tabs', role: 'tablist', 'aria-label': 'Settings sections' });
    const body = h('div', { class: 'modal-body' });
    for (const t of TABS) {
      const btn = h(
        'button',
        { type: 'button', role: 'tab', id: `tab-${t.id}`, 'aria-controls': `panel-${t.id}`, onclick: () => this.showTab(t.id) },
        icon(t.icon, 18),
        h('span', {}, t.label),
      );
      btn.addEventListener('keydown', (e) => this.tabKeys(e, t.id));
      const panel = h(
        'div',
        { class: 'tab-panel', role: 'tabpanel', id: `panel-${t.id}`, 'aria-labelledby': `tab-${t.id}`, tabindex: '0' },
        ...panels[t.id],
      );
      this.tabBtns.set(t.id, btn);
      this.tabPanels.set(t.id, panel);
      tablist.append(btn);
      body.append(panel);
    }

    this.closeBtn = h(
      'button',
      { class: 'icon-btn close', title: 'Close (Esc)', 'aria-label': 'Close settings', onclick: () => this.close() },
      icon('X', 20),
    );

    this.el = h(
      'div',
      { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'settings-title' },
      h(
        'div',
        { class: 'modal-window' },
        h('header', { class: 'modal-head' }, h('h1', { id: 'settings-title' }, 'Settings'), tablist, this.closeBtn),
        body,
      ),
    );
    // Click on the dimmed area around the window closes it; a drag that merely ends there does not
    let downOnBackdrop = false;
    this.el.addEventListener('pointerdown', (e) => (downOnBackdrop = e.target === this.el));
    this.el.addEventListener('click', (e) => {
      if (downOnBackdrop && e.target === this.el) this.close();
    });

    this.el.inert = true;
    const saved = TABS.find((t) => t.id === s.settingsTab);
    this.showTab(saved ? saved.id : 'mode');
  }

  private updateExportNote(): void {
    const canBackground = this.app.canExportInBackground();
    this.backgroundRow.hidden = !canBackground;
    this.exportNote.textContent =
      canBackground && this.background
        ? 'The video is made from the whole track faster than real time. You can keep using the app meanwhile.'
        : this.app.source().kind === 'file'
          ? 'Records the whole track from the start, with sound. Stop earlier with the same button.'
          : 'Records picture and sound until you stop it with the same button.';
  }

  private openExport(): void {
    this.updateExportNote();
    this.exportDialog.showModal();
  }

  private exportState(busy: boolean, iconName: string, text: string, label: string): void {
    this.exportBusy = busy;
    this.exportBtn.classList.toggle('recording', busy);
    this.exportBtn.classList.remove('rendering');
    this.exportBtn.replaceChildren(icon(iconName, busy ? 14 : 18), this.exportLabel);
    this.exportLabel.textContent = text;
    this.exportBtn.title = label;
    this.exportBtn.setAttribute('aria-label', label);
  }

  /** Recording time in seconds, or null when not recording. */
  setRecording(seconds: number | null): void {
    if (seconds === null) return this.exportState(false, 'Download', '', 'Download video');
    const s = Math.floor(seconds);
    this.exportState(true, 'Square', `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, 'Stop recording and download');
  }

  /** Background export progress 0..1, or null when done. */
  setExportProgress(fraction: number | null): void {
    if (fraction === null) return this.exportState(false, 'Download', '', 'Download video');
    this.exportState(true, 'X', `${Math.floor(fraction * 100)} %`, 'Cancel the video');
    this.exportBtn.classList.add('rendering');
  }

  get isOpen(): boolean {
    return document.body.classList.contains('modal-open');
  }

  open(): void {
    if (this.isOpen) return;
    this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.el.inert = false;
    this.inerted = Array.from(document.body.children).filter(
      (c): c is HTMLElement => c instanceof HTMLElement && c !== this.el && c !== this.toast && !c.inert,
    );
    for (const c of this.inerted) c.inert = true;
    document.body.classList.add('modal-open');
    this.tabBtns.get(this.app.settings.settingsTab as TabId)?.focus();
  }

  close(): void {
    if (!this.isOpen) return;
    this.el.inert = true;
    for (const c of this.inerted) c.inert = false;
    this.inerted = [];
    document.body.classList.remove('modal-open');
    const back = this.opener?.isConnected && this.opener !== document.body ? this.opener : this.settingsBtn;
    back.focus();
    this.opener = null;
  }

  toggleOpen(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  private showTab(id: TabId): void {
    for (const [t, btn] of this.tabBtns) {
      btn.setAttribute('aria-selected', String(t === id));
      btn.tabIndex = t === id ? 0 : -1;
    }
    for (const [t, panel] of this.tabPanels) panel.hidden = t !== id;
    if (this.app.settings.settingsTab !== id) {
      this.app.settings.settingsTab = id;
      this.app.saveSettings();
    }
  }

  /** Arrow keys move between tabs (WAI-ARIA tabs pattern). */
  private tabKeys(e: KeyboardEvent, id: TabId): void {
    const i = TABS.findIndex((t) => t.id === id);
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    this.showTab(TABS[next].id);
    this.tabBtns.get(TABS[next].id)?.focus();
  }

  /** Show a message in the sound tab and as a short toast. */
  setStatus(text: string, error = false): void {
    this.status.textContent = text;
    this.status.classList.toggle('error', error);
    if (text) {
      this.toast.textContent = text;
      this.toast.classList.toggle('error', error);
      this.toast.classList.add('show');
      clearTimeout(this.toastTimer);
      this.toastTimer = window.setTimeout(() => this.toast.classList.remove('show'), 4000);
    }
  }

  meter(b: Bands): void {
    const v = [b.bass, b.mid, b.treble];
    this.meters.forEach((m, i) => {
      const scale = Math.min(1, v[i % 3] * 1.4).toFixed(3);
      m.style.transform = i < 3 ? `scaleY(${scale})` : `scaleX(${scale})`;
    });
  }

  private paletteButton(p: Palette): HTMLButtonElement {
    const b = h(
      'button',
      { type: 'button', class: 'palette-btn', 'aria-pressed': 'false', onclick: () => this.app.setPalette(p.id) },
      h('i', { class: 'swatch', style: { background: `linear-gradient(135deg, ${p.bg} 0 30%, ${p.b} 30% 55%, ${p.a} 55% 80%, ${p.c} 80%)` } }),
      h('span', {}, p.name),
    );
    b.style.setProperty('--swatch', p.a);
    this.paletteBtns.set(p.id, b);
    return b;
  }

  /** Show the palette taken from the user image first in the grid, or remove it (null). */
  setImagePalette(p: Palette | null): void {
    this.paletteBtns.get(IMAGE_PALETTE_ID)?.remove();
    this.paletteBtns.delete(IMAGE_PALETTE_ID);
    if (p) this.paletteGrid.prepend(this.paletteButton(p));
    this.sync();
  }

  /** Refresh pressed states; rebuild variant chips and source controls only when they change. */
  sync(): void {
    const s = this.app.settings;
    const src = this.app.source();
    for (const [k, b] of this.sourceBtns) b.setAttribute('aria-pressed', String(k === src.kind));
    for (const [id, b] of this.modeBtns) b.setAttribute('aria-pressed', String(id === s.mode));
    for (const [id, b] of this.paletteBtns) b.setAttribute('aria-pressed', String(id === s.palette));
    for (const [k, set] of this.fxSetters) set(s[k]);
    for (const [key, btns] of this.imageChoiceBtns) btns.forEach((b, i) => b.setAttribute('aria-pressed', String(i === s[key])));
    for (const [id, b] of this.fontBtns) b.setAttribute('aria-pressed', String(id === s.font));
    this.removeImageBtn.hidden = !this.app.hasImage();
    this.filterBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(i === s.filter)));
    this.filterBeatSet(s.filterBeat);
    this.autoBtn.setAttribute('aria-pressed', String(s.auto));
    this.backBtn.disabled = !this.app.canGoBack();
    for (const [k, set] of this.autoSetters) set(s[k]);
    for (const [n, b] of this.autoBeatsBtns) b.setAttribute('aria-pressed', String(n === s.autoBeats));
    for (const [id, b] of this.autoModeBtns) b.setAttribute('aria-pressed', String(!s.autoSkip.includes(id)));

    const mode = this.app.modes.find((m) => m.id === s.mode)!;
    if (this.chipsFor !== mode.id) {
      this.chipsFor = mode.id;
      this.variantBox.replaceChildren(
        ...mode.variants.map((name, i) =>
          h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', onclick: () => this.app.setVariant(i) }, name),
        ),
      );
    }
    if (this.paramsFor !== mode.id && !this.draggingParam) {
      this.paramsFor = mode.id;
      this.renderParams(mode);
    }
    const current = variantOf(mode, s);
    Array.from(this.variantBox.children).forEach((c, i) => c.setAttribute('aria-pressed', String(i === current)));

    const extraKey = `${src.kind}:${src.label}`;
    if (this.extraFor !== extraKey) {
      this.extraFor = extraKey;
      this.playBtn = null;
      this.sourceExtra.replaceChildren();
      if (src.kind === 'file') {
        this.playBtn = h('button', { class: 'icon-btn', onclick: () => this.app.togglePlay() });
        this.sourceExtra.append(
          h('div', { class: 'file-row' }, this.playBtn, h('span', { class: 'file-name', title: src.label }, src.label)),
        );
      } else if (src.kind === 'input') {
        void this.renderDevices(extraKey);
      }
    }
    if (this.playBtn) {
      this.playBtn.setAttribute('aria-label', src.playing ? 'Pause' : 'Play');
      this.playBtn.replaceChildren(icon(src.playing ? 'Pause' : 'Play'));
    }
  }

  /** Rebuild the mode settings on the next sync (their values changed from outside). */
  refreshParams(): void {
    this.paramsFor = '';
  }

  /** Sliders and option chips for the current mode's own settings. */
  private renderParams(mode: Mode): void {
    const s = this.app.settings;
    const params = mode.params ?? [];
    this.paramsCard.hidden = params.length === 0;
    if (params.length === 0) return this.paramsBox.replaceChildren();

    const rows = params.map((p) => {
      const value = paramValue(mode, p, s);
      if (p.options) {
        const chips = h('div', { class: 'chips' });
        for (const o of p.options) {
          const b = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(o.value === value) }, o.label);
          b.addEventListener('click', () => {
            this.app.setParam(p.id, o.value);
            for (const c of chips.children) c.setAttribute('aria-pressed', String(c === b));
          });
          chips.append(b);
        }
        return h('div', { class: 'param-options' }, h('span', {}, p.label), chips);
      }
      return slider(p.label, p.min ?? 0, p.max ?? 1, p.step ?? 0.01, value, (v) => this.app.setParam(p.id, v));
    });

    const reset = h('button', { type: 'button', class: 'link-btn' }, 'Reset to defaults');
    reset.addEventListener('click', () => {
      this.app.resetParams();
      this.paramsFor = '';
      this.sync();
    });
    this.paramsBox.replaceChildren(...rows, reset);
  }

  private async renderDevices(key: string): Promise<void> {
    const devices = await this.app.listInputs();
    if (this.extraFor !== key) return; // source changed meanwhile
    const select = h(
      'select',
      {
        'aria-label': 'Input device',
        onchange: (e: Event) => void this.run(this.app.useInput((e.target as HTMLSelectElement).value)),
      },
      ...devices.map((d, i) =>
        h('option', { value: d.deviceId, selected: d.deviceId === this.app.settings.inputDevice }, d.label || `Input ${i + 1}`),
      ),
    );
    this.sourceExtra.replaceChildren(
      select,
      h('small', { class: 'hint' }, 'System sound: pick the “Monitor of …” device'),
    );
  }

  private chooseSource(kind: SourceKind): void {
    if (kind === 'demo') void this.run(this.app.useDemo());
    else if (kind === 'input') void this.run(this.app.useInput(this.app.settings.inputDevice));
    else if (kind === 'tab') void this.run(this.app.useTab());
    else this.app.pickFile();
  }

  private async run(task: Promise<void>): Promise<void> {
    try {
      await task;
      this.setStatus('');
    } catch (err) {
      this.setStatus(err instanceof Error ? err.message : String(err), true);
    }
    this.sync();
  }
}
