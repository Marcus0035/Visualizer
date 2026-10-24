import { rgba } from './palettes';
import type { Mode2D, View } from './types';

const COUNT = 900;
const DEPTH = 1;
const xs = new Float32Array(COUNT);
const ys = new Float32Array(COUNT);
const zs = new Float32Array(COUNT);
const hue = new Uint8Array(COUNT); // which palette color

function spawn(i: number, z = Math.random() * DEPTH): void {
  xs[i] = (Math.random() * 2 - 1) * 1.2;
  ys[i] = (Math.random() * 2 - 1) * 1.2;
  zs[i] = Math.max(0.02, z);
  hue[i] = Math.random() < 0.15 ? 1 : Math.random() < 0.3 ? 2 : 0;
}

for (let i = 0; i < COUNT; i++) spawn(i);

let drift = 0;

function project(i: number, z: number, v: View): [number, number] {
  const f = Math.min(v.width, v.height) * 0.5;
  return [v.width / 2 + (xs[i] / z) * f, v.height / 2 + (ys[i] / z) * f];
}

export const interstellar: Mode2D = {
  kind: '2d',
  id: 'interstellar',
  name: 'Interstellar',
  icon: 'Orbit',
  variants: ['Hvězdné pole', 'Warp'],

  reset(g, v) {
    g.fillStyle = v.palette.bg;
    g.fillRect(0, 0, v.width, v.height);
  },

  render(g, a, v) {
    const { dpr, palette: p } = v;
    const warp = v.variant === 1;
    const colors = [p.c, p.a, p.b];

    g.fillStyle = warp ? rgba(p.bg, 0.35) : p.bg;
    g.fillRect(0, 0, v.width, v.height);

    // Bass drives speed, a beat gives a short kick forward
    const speed = (warp ? 0.5 : 0.08) + a.bands.bass * (warp ? 1.6 : 0.6) + a.pulse * 0.4;
    drift += v.dt * (0.05 + a.bands.mid * 0.3);
    const sway = Math.sin(drift) * 0.002;

    g.lineCap = 'round';
    for (let i = 0; i < COUNT; i++) {
      const prevZ = zs[i];
      zs[i] -= speed * v.dt;
      xs[i] += sway;
      if (zs[i] <= 0.02) {
        spawn(i, DEPTH);
        continue;
      }
      const [x, y] = project(i, zs[i], v);
      if (x < -50 || x > v.width + 50 || y < -50 || y > v.height + 50) {
        spawn(i, DEPTH);
        continue;
      }
      const near = 1 - zs[i] / DEPTH;
      const alpha = Math.min(1, near * 1.4 + a.bands.treble * 0.5);
      const color = colors[hue[i]];

      if (warp) {
        const [px, py] = project(i, prevZ, v);
        g.strokeStyle = rgba(color, alpha);
        g.lineWidth = (0.5 + near * 2.5) * dpr;
        g.beginPath();
        g.moveTo(px, py);
        g.lineTo(x, y);
        g.stroke();
      } else {
        const r = (0.4 + near * near * 2.6) * dpr * (1 + a.pulse * 0.5);
        g.fillStyle = rgba(color, alpha);
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
      }
    }
  },
};
