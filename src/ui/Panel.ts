import type { Bands } from '../audio/analysis';
import type { SourceKind } from '../audio/AudioEngine';
import { PALETTES } from '../modes/palettes';
import type { Mode } from '../modes/types';
import { FONTS } from '../overlay/text';
import { type Effects, type Settings, paramValue, variantOf } from '../settings';
import { h, icon, toggle } from './dom';

/** What the panel needs from the app. */
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
  setImageStyle(index: number): void;
  setOverlaySize(value: number): void;
  setText(text: string): void;
  setFont(id: string): void;
}

const IMAGE_STYLES = ['Barvy palety', 'Obrys', 'Originál'];

const SOURCES: { kind: SourceKind; label: string; icon: string }[] = [
  { kind: 'demo', label: 'Demo', icon: 'Music' },
  { kind: 'input', label: 'Vstup', icon: 'Mic' },
  { kind: 'file', label: 'Soubor', icon: 'Upload' },
  { kind: 'tab', label: 'Karta', icon: 'Monitor' },
];

const SHORTCUTS: [string, string][] = [
  ['V', 'další varianta'],
  ['P', 'další paleta'],
  ['C / G / S / X', 'CRT / zrno / strobe / glitch'],
  ['Mezerník', 'přehrát / pauza souboru'],
  ['F', 'celá obrazovka'],
  ['H', 'skrýt panel'],
];

export class Panel {
  readonly el: HTMLElement;
  private readonly status = h('p', { class: 'status', 'aria-live': 'polite' });
  private readonly meters: HTMLElement[] = [];
  private readonly sourceBtns = new Map<SourceKind, HTMLButtonElement>();
  private readonly modeBtns = new Map<string, HTMLButtonElement>();
  private readonly paletteBtns = new Map<string, HTMLButtonElement>();
  private readonly variantBox = h('div', { class: 'chips' });
  private readonly sourceExtra = h('div', { class: 'source-extra' });
  private readonly fxSetters = new Map<keyof Effects, (on: boolean) => void>();
  private chipsFor = '';
  private paramsFor = '';
  private readonly paramsBox = h('div', { class: 'params' });
  private extraFor = '';
  private playBtn: HTMLButtonElement | null = null;
  private readonly imageStyleBtns: HTMLButtonElement[] = [];
  private readonly fontBtns = new Map<string, HTMLButtonElement>();
  private readonly removeImageBtn: HTMLButtonElement;

  constructor(private readonly app: PanelActions) {
    const s = app.settings;

    const meter = h('div', { class: 'meter', title: 'Basy / středy / výšky' });
    for (let i = 0; i < 3; i++) {
      const bar = h('i');
      this.meters.push(bar);
      meter.append(bar);
    }

    const collapse = h(
      'button',
      { class: 'icon-btn', title: 'Skrýt panel (H)', 'aria-label': 'Skrýt panel', onclick: () => this.setOpen(false) },
      icon('ChevronLeft'),
    );

    const sources = h('div', { class: 'segmented' });
    for (const src of SOURCES) {
      const b = h(
        'button',
        { type: 'button', 'aria-pressed': 'false', onclick: () => this.chooseSource(src.kind) },
        icon(src.icon),
        h('span', {}, src.label),
      );
      this.sourceBtns.set(src.kind, b);
      sources.append(b);
    }

    const modes = h('div', { class: 'modes' });
    app.modes.forEach((m, i) => {
      const b = h(
        'button',
        { type: 'button', 'aria-pressed': 'false', onclick: () => app.setMode(m.id) },
        icon(m.icon, 18),
        h('span', {}, m.name),
        h('kbd', {}, String(i + 1)),
      );
      this.modeBtns.set(m.id, b);
      modes.append(b);
    });

    const palettes = h('div', { class: 'palettes' });
    for (const p of PALETTES) {
      const b = h('button', {
        type: 'button',
        class: 'swatch',
        title: p.name,
        'aria-label': `Paleta ${p.name}`,
        'aria-pressed': 'false',
        style: { background: `linear-gradient(135deg, ${p.a} 0 40%, ${p.b} 40% 70%, ${p.c} 70%)`, outlineColor: p.a },
        onclick: () => app.setPalette(p.id),
      });
      this.paletteBtns.set(p.id, b);
      palettes.append(b);
    }

    const slider = (label: string, min: number, max: number, step: number, value: number, set: (v: number) => void) =>
      h(
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

    const fx = h('div', { class: 'switches' });
    const fxDefs: [keyof Effects, string, string?][] = [
      ['crt', 'CRT obrazovka'],
      ['grain', 'Zrno'],
      ['strobe', 'Strobe na beat', 'Blikání, pozor při citlivosti na světlo'],
      ['glitch', 'Glitch na beat', 'Obraz se na kick roztrhá do pruhů'],
    ];
    for (const [key, label, hint] of fxDefs) {
      const t = toggle(label, s[key], (on) => app.setEffect(key, on), hint);
      this.fxSetters.set(key, t.set);
      fx.append(t.row);
    }

    this.removeImageBtn = h(
      'button',
      { class: 'icon-btn', title: 'Odebrat obrázek', 'aria-label': 'Odebrat obrázek', onclick: () => app.removeImage() },
      icon('Trash2'),
    );
    const imageRow = h(
      'div',
      { class: 'overlay-row' },
      h('button', { type: 'button', class: 'btn', onclick: () => app.pickImage() }, icon('ImagePlus'), h('span', {}, 'Vlastní obrázek')),
      this.removeImageBtn,
    );
    const imageStyles = h('div', { class: 'chips' });
    IMAGE_STYLES.forEach((name, i) => {
      const b = h('button', { type: 'button', class: 'chip', onclick: () => app.setImageStyle(i) }, name);
      this.imageStyleBtns.push(b);
      imageStyles.append(b);
    });

    let typing = 0;
    const textRow = h(
      'label',
      { class: 'text-input' },
      icon('Type'),
      h('input', {
        type: 'text',
        value: s.text,
        maxLength: 80,
        placeholder: 'Text, svislá čára = nový řádek',
        'aria-label': 'Text na obrazovce',
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

    const help = h(
      'details',
      { class: 'help' },
      h('summary', {}, icon('Keyboard'), h('span', {}, 'Klávesové zkratky')),
      h('dl', {}, ...[[`1 - ${app.modes.length}`, 'režim'], ...SHORTCUTS].flatMap(([k, v]) => [h('dt', {}, h('kbd', {}, k)), h('dd', {}, v)])),
    );

    this.el = h(
      'aside',
      { class: 'panel', 'aria-label': 'Ovládání' },
      h('header', {}, h('h1', {}, 'Visualizer'), meter, collapse),
      section('Zdroj zvuku', sources, this.sourceExtra, this.status),
      section('Režim', modes, this.variantBox, this.paramsBox),
      section('Paleta', palettes),
      section(
        'Citlivost a hlasitost',
        slider('Citlivost', 0.25, 4, 0.05, s.sensitivity, (v) => app.setSensitivity(v)),
        slider('Hlasitost', 0, 1, 0.01, s.volume, (v) => app.setVolume(v)),
      ),
      section(
        'Obrázek a text',
        imageRow,
        imageStyles,
        textRow,
        fonts,
        slider('Velikost', 0.2, 1, 0.01, s.overlaySize, (v) => app.setOverlaySize(v)),
      ),
      section('Efekty', fx),
      h(
        'footer',
        {},
        help,
        h(
          'button',
          { class: 'icon-btn', title: 'Celá obrazovka (F)', 'aria-label': 'Celá obrazovka', onclick: () => app.toggleFullscreen() },
          icon('Maximize'),
        ),
      ),
    );

    this.setOpen(s.panelOpen);
  }

  /** Small handle shown when the panel is collapsed. */
  readonly opener = h(
    'button',
    {
      class: 'opener icon-btn',
      title: 'Zobrazit panel (H)',
      'aria-label': 'Zobrazit panel',
      onclick: () => this.setOpen(true),
    },
    icon('SlidersHorizontal', 18),
  );

  setOpen(open: boolean): void {
    this.app.settings.panelOpen = open;
    this.el.inert = !open; // keep focus and Space out of the hidden panel
    document.body.classList.toggle('panel-closed', !open);
  }

  toggleOpen(): void {
    this.setOpen(!this.app.settings.panelOpen);
  }

  setStatus(text: string, error = false): void {
    this.status.textContent = text;
    this.status.classList.toggle('error', error);
  }

  meter(b: Bands): void {
    const v = [b.bass, b.mid, b.treble];
    this.meters.forEach((m, i) => (m.style.transform = `scaleY(${Math.min(1, v[i] * 1.4).toFixed(3)})`));
  }

  /** Refresh pressed states; rebuild variant chips and source controls only when they change. */
  sync(): void {
    const s = this.app.settings;
    const src = this.app.source();
    for (const [k, b] of this.sourceBtns) b.setAttribute('aria-pressed', String(k === src.kind));
    for (const [id, b] of this.modeBtns) b.setAttribute('aria-pressed', String(id === s.mode));
    for (const [id, b] of this.paletteBtns) b.setAttribute('aria-pressed', String(id === s.palette));
    for (const [k, set] of this.fxSetters) set(s[k]);
    this.imageStyleBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(i === s.imageStyle)));
    for (const [id, b] of this.fontBtns) b.setAttribute('aria-pressed', String(id === s.font));
    this.removeImageBtn.hidden = !this.app.hasImage();

    const mode = this.app.modes.find((m) => m.id === s.mode)!;
    if (this.chipsFor !== mode.id) {
      this.chipsFor = mode.id;
      this.variantBox.replaceChildren(
        ...mode.variants.map((name, i) =>
          h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', onclick: () => this.app.setVariant(i) }, name),
        ),
      );
    }
    if (this.paramsFor !== mode.id) {
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
      this.playBtn.setAttribute('aria-label', src.playing ? 'Pauza' : 'Přehrát');
      this.playBtn.replaceChildren(icon(src.playing ? 'Pause' : 'Play'));
    }
  }

  /** Sliders and option chips for the current mode's own settings. */
  private renderParams(mode: Mode): void {
    const s = this.app.settings;
    const params = mode.params ?? [];
    this.paramsBox.hidden = params.length === 0;
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
      return h(
        'label',
        { class: 'slider' },
        h('span', {}, p.label),
        h('input', {
          type: 'range',
          min: String(p.min ?? 0),
          max: String(p.max ?? 1),
          step: String(p.step ?? 0.01),
          value: String(value),
          oninput: (e: Event) => this.app.setParam(p.id, Number((e.target as HTMLInputElement).value)),
        }),
      );
    });

    const reset = h('button', { type: 'button', class: 'link-btn' }, 'Výchozí nastavení');
    reset.addEventListener('click', () => {
      this.app.resetParams();
      this.paramsFor = '';
      this.sync();
    });
    this.paramsBox.replaceChildren(h('h3', {}, `Nastavení: ${mode.name}`), ...rows, reset);
  }

  private async renderDevices(key: string): Promise<void> {
    const devices = await this.app.listInputs();
    if (this.extraFor !== key) return; // source changed meanwhile
    const select = h(
      'select',
      {
        'aria-label': 'Vstupní zařízení',
        onchange: (e: Event) => void this.run(this.app.useInput((e.target as HTMLSelectElement).value)),
      },
      ...devices.map((d, i) =>
        h('option', { value: d.deviceId, selected: d.deviceId === this.app.settings.inputDevice }, d.label || `Vstup ${i + 1}`),
      ),
    );
    this.sourceExtra.replaceChildren(
      select,
      h('small', { class: 'hint' }, 'Zvuk systému: vyber zařízení „Monitor of …“'),
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

function section(title: string, ...children: Node[]): HTMLElement {
  return h('section', {}, h('h2', {}, title), ...children);
}
