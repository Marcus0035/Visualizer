import { rgba } from './palettes';
import type { Mode2D, View } from './types';

const KATAKANA = Array.from({ length: 96 }, (_, i) => String.fromCharCode(0x30a0 + i)).join('');
const GLYPHS = [KATAKANA + '0123456789', '01'];

interface Rain {
  size: number;
  rows: number;
  heads: Float32Array; // current row (fractional) per column
  speeds: Float32Array; // rows per second at level 0
  lastRow: Int32Array;
}

/** Per drawing context, so the live view and a background export do not share the rain */
const rains = new WeakMap<CanvasRenderingContext2D, Rain>();

function pick(set: string): string {
  return set[(Math.random() * set.length) | 0];
}

function setup(g: CanvasRenderingContext2D, v: View): Rain {
  const size = Math.max(12 * v.dpr, Math.round(v.width / 90));
  const cols = Math.ceil(v.width / size);
  const rows = Math.ceil(v.height / size);
  const rain: Rain = {
    size,
    rows,
    heads: new Float32Array(cols).map(() => -Math.random() * rows),
    speeds: new Float32Array(cols).map(() => 6 + Math.random() * 14),
    lastRow: new Int32Array(cols).fill(-1),
  };
  rains.set(g, rain);
  return rain;
}

export const matrix: Mode2D = {
  kind: '2d',
  id: 'matrix',
  name: 'Matrix',
  icon: 'Binary',
  variants: ['Znaky', 'Binární'],

  reset(g, v) {
    setup(g, v);
    g.fillStyle = v.palette.bg;
    g.fillRect(0, 0, v.width, v.height);
  },

  render(g, a, v) {
    const { palette: p } = v;
    let rain = rains.get(g);
    if (!rain || rain.heads.length !== Math.ceil(v.width / rain.size)) rain = setup(g, v);
    const { size, rows, heads, speeds, lastRow } = rain;
    const set = GLYPHS[v.variant] ?? GLYPHS[0];

    g.fillStyle = rgba(p.bg, 0.06 + v.dt * 2);
    g.fillRect(0, 0, v.width, v.height);
    g.font = `${size}px "Noto Sans Mono CJK JP", "DejaVu Sans Mono", monospace`;
    g.textAlign = 'center';
    g.textBaseline = 'top';

    const boost = 0.4 + a.level * 2.5 + a.bands.bass * 2;
    // A beat drops a handful of fresh streams from the top
    if (a.beat) {
      for (let k = 0; k < Math.max(3, heads.length / 12); k++) {
        const c = (Math.random() * heads.length) | 0;
        if (heads[c] > rows * 0.5) heads[c] = 0;
      }
    }

    for (let c = 0; c < heads.length; c++) {
      heads[c] += speeds[c] * boost * v.dt;
      const row = Math.floor(heads[c]);
      if (row === lastRow[c]) continue;
      const x = c * size + size / 2;

      // Previous head becomes body color
      if (lastRow[c] >= 0) {
        g.fillStyle = p.bg;
        g.fillRect(c * size, lastRow[c] * size, size, size);
        g.fillStyle = p.a;
        g.fillText(pick(set), x, lastRow[c] * size);
      }
      if (row >= 0 && row < rows) {
        g.shadowColor = p.c;
        g.shadowBlur = size * (0.3 + a.bands.treble * 1.5);
        g.fillStyle = p.c;
        g.fillText(pick(set), x, row * size);
        g.shadowBlur = 0;
      }
      lastRow[c] = row;

      if (row > rows + 4) {
        heads[c] = -Math.random() * rows * 0.6;
        speeds[c] = 6 + Math.random() * 14;
        lastRow[c] = -1;
      }
    }
  },
};
