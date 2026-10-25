// Timeline editor: drag modes, filters and colors from the library onto tracks. While a clip
// covers the playhead the autopilot leaves that thing alone and the clip's value is shown.
import type { Mode, Palette } from '../modes/types';
import { type Clip, MIN_CLIP, TRACKS, type TrackId, describeValue, freeRange, placeClip, trackClips } from '../timeline';
import { h, icon } from './dom';

export interface TimelineApp {
  clips(): Clip[];
  setClips(clips: Clip[]): void;
  /** Length of the loaded track in seconds, 0 without one */
  duration(): number;
  time(): number;
  playing(): boolean;
  togglePlay(): void;
  seek(seconds: number): void;
  modes: Mode[];
  filters: { name: string }[];
  palettes(): Palette[];
}

const DEFAULT_LENGTH = 8;
const TRACK_H = 38;
const RULER_H = 26;

interface Item {
  track: TrackId;
  value: string;
  label: string;
  swatch?: Palette;
}

export class Timeline {
  readonly el: HTMLElement;
  private readonly body = h('div', { class: 'tl-body' });
  private readonly timeLabel = h('span', { class: 'tl-time' }, '0:00');
  private readonly playBtn = h('button', { type: 'button', class: 'icon-btn', title: 'Play / pause (Space)' });
  private readonly inspect = h('div', { class: 'tl-inspect' });
  private readonly zoom = h('input', { type: 'range', min: '4', max: '80', step: '1', 'aria-label': 'Zoom' }) as HTMLInputElement;
  private playhead = h('div', { class: 'tl-playhead' });
  private scroller: HTMLElement | null = null;
  private library: HTMLElement = h('div', { class: 'tl-library' });
  private libraryTab: TrackId = 'mode';
  private pps = 0;
  private selected: string | null = null;
  private builtFor = -1;
  private shownPlaying: boolean | null = null;

  constructor(private readonly app: TimelineApp) {
    this.zoom.addEventListener('input', () => {
      this.pps = Number(this.zoom.value);
      this.build();
    });
    this.playBtn.addEventListener('click', () => app.togglePlay());
    this.el = h(
      'section',
      { class: 'timeline', hidden: true, 'aria-label': 'Timeline' },
      h(
        'header',
        { class: 'tl-head' },
        h('strong', {}, 'Timeline'),
        this.playBtn,
        this.timeLabel,
        this.inspect,
        h('label', { class: 'tl-zoom', title: 'Zoom' }, icon('ScanEye', 14), this.zoom),
        h('button', { type: 'button', class: 'icon-btn close', title: 'Close (T)', 'aria-label': 'Close the timeline', onclick: () => this.hide() }, icon('X', 18)),
      ),
      this.body,
    );
    document.addEventListener('keydown', (e) => {
      if (this.el.hidden || !this.selected) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && !(e.target as HTMLElement).matches('input, textarea, select')) {
        e.preventDefault();
        this.remove(this.selected);
      }
    });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  toggle(): void {
    if (this.isOpen) this.hide();
    else this.show();
  }

  show(): void {
    this.el.hidden = false;
    document.body.classList.add('timeline-open');
    this.builtFor = -1;
    this.refresh();
  }

  hide(): void {
    this.el.hidden = true;
    document.body.classList.remove('timeline-open');
  }

  /** Rebuild after the clips, the track or the palettes changed. */
  refresh(): void {
    if (!this.isOpen) return;
    this.build();
    this.renderInspector();
  }

  /** Every frame: move the playhead and the clock. */
  tick(): void {
    if (!this.isOpen) return;
    const d = this.app.duration();
    if (d !== this.builtFor) this.build();
    const t = this.app.time();
    this.timeLabel.textContent = `${fmt(t)} / ${fmt(d)}`;
    const playing = this.app.playing();
    if (playing !== this.shownPlaying) {
      this.shownPlaying = playing;
      this.playBtn.replaceChildren(icon(playing ? 'Pause' : 'Play', 18));
    }
    this.playhead.style.left = `${t * this.pps}px`;
    const sc = this.scroller;
    if (sc && playing) {
      const x = t * this.pps;
      if (x < sc.scrollLeft || x > sc.scrollLeft + sc.clientWidth - 30) sc.scrollLeft = Math.max(0, x - 40);
    }
  }

  private items(track: TrackId): Item[] {
    if (track === 'mode') return this.app.modes.map((m) => ({ track, value: `${m.id}:0`, label: m.name }));
    if (track === 'filter') return this.app.filters.map((f, i) => ({ track, value: String(i), label: f.name })).slice(1);
    if (track === 'palette') return this.app.palettes().map((p) => ({ track, value: p.id, label: p.name, swatch: p }));
    return [{ track, value: 'on', label: 'Invert colors' }];
  }

  private labelOf(c: Clip): string {
    if (c.track === 'mode') {
      const { id, variant } = describeValue('mode', c.value);
      const m = this.app.modes.find((x) => x.id === id);
      return m ? `${m.name}${variant !== null && m.variants[variant] ? ` · ${m.variants[variant]}` : ''}` : id;
    }
    if (c.track === 'filter') return this.app.filters[Number(c.value)]?.name ?? 'Filter';
    if (c.track === 'palette') return this.app.palettes().find((p) => p.id === c.value)?.name ?? 'Colors';
    return 'Invert';
  }

  private add(track: TrackId, value: string, at: number): void {
    const clips = this.app.clips();
    const spot = placeClip(clips, track, at, DEFAULT_LENGTH, this.app.duration());
    if (!spot) return;
    const clip: Clip = { id: `c${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`, track, value, ...spot };
    this.selected = clip.id;
    this.app.setClips([...clips, clip]);
  }

  private remove(id: string): void {
    this.selected = null;
    this.app.setClips(this.app.clips().filter((c) => c.id !== id));
  }

  private build(): void {
    const duration = this.app.duration();
    this.builtFor = duration;
    this.library = this.buildLibrary();
    if (duration <= 0) {
      this.scroller = null;
      this.body.replaceChildren(h('p', { class: 'tl-empty' }, 'Load a music file to edit its timeline: Settings > Sound > Choose file, or drop it onto the window.'));
      return;
    }
    if (!this.pps) {
      this.pps = Math.max(4, Math.min(60, Math.floor((window.innerWidth - 360) / duration)));
      this.zoom.value = String(this.pps);
    }
    const pps = this.pps;
    const width = Math.ceil(duration * pps);
    const clips = this.app.clips();
    const keepScroll = this.scroller?.scrollLeft ?? 0;

    const labels = h('div', { class: 'tl-labels' }, h('div', { style: { height: `${RULER_H}px` } }));
    const inner = h('div', { class: 'tl-inner', style: { width: `${width}px` } });
    const ruler = h('div', { class: 'tl-ruler', style: { height: `${RULER_H}px` } });
    const step = pps >= 40 ? 1 : pps >= 18 ? 5 : pps >= 8 ? 10 : 30;
    for (let s = 0; s <= duration; s += step) ruler.append(h('span', { style: { left: `${s * pps}px` } }, fmt(s)));
    const scrub = (e: PointerEvent): void => {
      const rect = inner.getBoundingClientRect();
      this.app.seek(Math.max(0, Math.min(duration, (e.clientX - rect.left) / pps)));
    };
    ruler.addEventListener('pointerdown', (e) => {
      ruler.setPointerCapture(e.pointerId);
      scrub(e);
      const move = (ev: PointerEvent): void => scrub(ev);
      const up = (): void => {
        ruler.removeEventListener('pointermove', move);
        ruler.removeEventListener('pointerup', up);
      };
      ruler.addEventListener('pointermove', move);
      ruler.addEventListener('pointerup', up);
    });
    inner.append(ruler);

    for (const tr of TRACKS) {
      labels.append(h('div', { class: `tl-label ${tr.id}`, style: { height: `${TRACK_H}px` } }, tr.label));
      const row = h('div', { class: `tl-track ${tr.id}`, style: { height: `${TRACK_H}px` } });
      row.addEventListener('dragover', (e) => {
        if (e.dataTransfer?.types.includes('application/x-viz') && dragging === tr.id) {
          e.preventDefault();
          row.classList.add('over');
        }
      });
      row.addEventListener('dragleave', () => row.classList.remove('over'));
      row.addEventListener('drop', (e) => {
        row.classList.remove('over');
        const raw = e.dataTransfer?.getData('application/x-viz');
        if (!raw) return;
        e.preventDefault();
        const item = JSON.parse(raw) as { track: TrackId; value: string };
        if (item.track !== tr.id) return;
        const rect = inner.getBoundingClientRect();
        this.add(tr.id, item.value, (e.clientX - rect.left) / pps);
      });
      for (const c of trackClips(clips, tr.id)) row.append(this.clipEl(c, clips, pps, duration));
      inner.append(row);
    }
    inner.append(this.playhead);
    const scroller = h('div', { class: 'tl-scroll' }, inner);
    scroller.scrollLeft = keepScroll;
    this.scroller = scroller;
    this.body.replaceChildren(this.library, labels, scroller);
    scroller.scrollLeft = keepScroll;
  }

  private buildLibrary(): HTMLElement {
    const tabs = h(
      'div',
      { class: 'tl-tabs' },
      ...TRACKS.map((tr) =>
        h(
          'button',
          {
            type: 'button',
            class: 'chip',
            'aria-pressed': String(this.libraryTab === tr.id),
            onclick: () => {
              this.libraryTab = tr.id;
              this.build();
            },
          },
          tr.label,
        ),
      ),
    );
    const list = h('div', { class: 'tl-items' });
    for (const item of this.items(this.libraryTab)) {
      const b = h(
        'button',
        {
          type: 'button',
          class: `tl-item ${item.track}`,
          draggable: true,
          title: 'Drag onto the track, or click to add at the playhead',
          onclick: () => this.add(item.track, item.value, this.app.time()),
        },
        item.swatch
          ? h('i', { class: 'swatch', style: { background: `linear-gradient(135deg, ${item.swatch.bg} 0 30%, ${item.swatch.b} 30% 55%, ${item.swatch.a} 55% 80%, ${item.swatch.c} 80%)` } })
          : null,
        h('span', {}, item.label),
      );
      b.addEventListener('dragstart', (e) => {
        dragging = item.track;
        e.dataTransfer?.setData('application/x-viz', JSON.stringify({ track: item.track, value: item.value }));
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
      });
      b.addEventListener('dragend', () => (dragging = null));
      list.append(b);
    }
    return h('div', { class: 'tl-library' }, tabs, list);
  }

  private clipEl(c: Clip, all: Clip[], pps: number, limit: number): HTMLElement {
    const el = h(
      'div',
      { class: `tl-clip ${c.track}${c.id === this.selected ? ' selected' : ''}`, style: { left: `${c.start * pps}px`, width: `${(c.end - c.start) * pps}px` } },
      h('i', { class: 'tl-handle l' }),
      h('span', {}, this.labelOf(c)),
      h('i', { class: 'tl-handle r' }),
    );
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      const target = e.target as HTMLElement;
      const mode = target.classList.contains('l') ? 'l' : target.classList.contains('r') ? 'r' : 'move';
      const room = freeRange(all, c.track, (c.start + c.end) / 2, c.id);
      const max = Math.min(room.max, limit);
      const x0 = e.clientX;
      let start = c.start;
      let end = c.end;
      el.setPointerCapture(e.pointerId);
      if (this.selected !== c.id) {
        this.selected = c.id;
        for (const other of this.el.querySelectorAll('.tl-clip.selected')) other.classList.remove('selected');
        el.classList.add('selected');
        this.renderInspector();
      }
      const move = (ev: PointerEvent): void => {
        const dt = (ev.clientX - x0) / pps;
        if (mode === 'move') {
          const len = c.end - c.start;
          start = Math.min(Math.max(c.start + dt, room.min), max - len);
          end = start + len;
        } else if (mode === 'l') {
          start = Math.min(Math.max(c.start + dt, room.min), c.end - MIN_CLIP);
        } else {
          end = Math.max(Math.min(c.end + dt, max), c.start + MIN_CLIP);
        }
        el.style.left = `${start * pps}px`;
        el.style.width = `${(end - start) * pps}px`;
      };
      const up = (): void => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        if (start !== c.start || end !== c.end) this.app.setClips(all.map((x) => (x.id === c.id ? { ...x, start, end } : x)));
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
    });
    return el;
  }

  /** Details of the selected clip: variants of a mode, delete. */
  private renderInspector(): void {
    const c = this.app.clips().find((x) => x.id === this.selected);
    if (!c) {
      this.inspect.replaceChildren(h('small', {}, 'Click a clip to edit it. Without a clip the autopilot decides.'));
      return;
    }
    const parts: (Node | string)[] = [h('strong', {}, this.labelOf(c).split(' · ')[0])];
    if (c.track === 'mode') {
      const { id, variant } = describeValue('mode', c.value);
      const mode = this.app.modes.find((m) => m.id === id);
      mode?.variants.forEach((name, i) =>
        parts.push(
          h(
            'button',
            {
              type: 'button',
              class: 'chip',
              'aria-pressed': String(i === (variant ?? 0)),
              onclick: () => this.app.setClips(this.app.clips().map((x) => (x.id === c.id ? { ...x, value: `${id}:${i}` } : x))),
            },
            name,
          ),
        ),
      );
    }
    parts.push(h('button', { type: 'button', class: 'chip', title: 'Delete (Del)', onclick: () => this.remove(c.id) }, icon('Trash2', 13), ' Delete'));
    this.inspect.replaceChildren(...parts);
  }
}

let dragging: TrackId | null = null;

function fmt(s: number): string {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}
