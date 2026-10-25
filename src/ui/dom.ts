import {
  Activity,
  Binary,
  ChartColumn,
  Keyboard,
  Maximize,
  Mic,
  Monitor,
  Music,
  Orbit,
  Pause,
  Play,
  Upload,
  Waves,
  ImagePlus,
  Trash2,
  Type,
  Zap,
  AudioLines,
  Palette,
  Settings,
  X,
  Ban,
  MonitorX,
  Videotape,
  Blocks,
  Vibrate,
  Hexagon,
  Grid3x3,
  CircleDot,
  Sparkles,
  ScanEye,
  Film,
  Shuffle,
  Dices,
  Undo2,
  LayoutGrid,
  Download,
  Smartphone,
  Square,
  Droplets,
  Tv,
  Gamepad2,
  Plus,
  createElement,
  type IconNode,
} from 'lucide';

const ICONS: Record<string, IconNode> = {
  LayoutGrid,
  Download,
  Smartphone,
  Square,
  Droplets,
  Tv,
  Gamepad2,
  Plus,
  Activity,
  Binary,
  ChartColumn,
  Keyboard,
  Maximize,
  Mic,
  Monitor,
  Music,
  Orbit,
  Pause,
  Play,
  Upload,
  Waves,
  ImagePlus,
  Trash2,
  Type,
  Zap,
  AudioLines,
  Palette,
  Settings,
  X,
  Ban,
  MonitorX,
  Videotape,
  Blocks,
  Vibrate,
  Hexagon,
  Grid3x3,
  CircleDot,
  Sparkles,
  ScanEye,
  Film,
  Shuffle,
  Dices,
  Undo2,
};

export function icon(name: string, size = 16): SVGElement {
  const node = ICONS[name];
  if (!node) throw new Error(`Unknown icon ${name}`);
  return createElement(node, { width: size, height: size, 'stroke-width': 1.75, 'aria-hidden': 'true' });
}

type Child = Node | string | null | undefined | false;

/** Tiny element builder: h('button', { class: 'x', onclick }, 'Label') */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, unknown>> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

/** Accessible on/off switch (role="switch"). */
export function toggle(label: string, checked: boolean, onChange: (on: boolean) => void, hint?: string) {
  const btn = h('button', { class: 'switch', role: 'switch', 'aria-checked': String(checked), type: 'button' });
  const set = (on: boolean) => btn.setAttribute('aria-checked', String(on));
  btn.addEventListener('click', () => {
    const on = btn.getAttribute('aria-checked') !== 'true';
    set(on);
    onChange(on);
  });
  const row = h(
    'label',
    { class: 'switch-row' },
    h('span', { class: 'switch-text' }, label, hint ? h('small', {}, hint) : null),
    btn,
  );
  return { row, set };
}
