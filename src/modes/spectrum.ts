import type { AudioFrame } from '../audio/AudioEngine';
import { logBars } from '../audio/analysis';
import type { Mode2D, View } from './types';

const COUNT = 64;
const bars = new Float32Array(COUNT);
const peaks = new Float32Array(COUNT);
const minimalBars = new Float32Array(8);

function updatePeaks(dt: number): void {
  for (let i = 0; i < COUNT; i++) peaks[i] = Math.max(bars[i], peaks[i] - dt * 0.6);
}

function barsUp(g: CanvasRenderingContext2D, v: View): void {
  const { width: w, height: h, dpr, palette: p } = v;
  const gap = 3 * dpr;
  const bw = (w - gap * (COUNT + 1)) / COUNT;
  const floor = h * 0.92;
  const maxH = h * 0.8;

  const grad = g.createLinearGradient(0, floor, 0, floor - maxH);
  grad.addColorStop(0, p.b);
  grad.addColorStop(1, p.a);
  g.fillStyle = grad;
  for (let i = 0; i < COUNT; i++) {
    const bh = Math.max(2 * dpr, bars[i] * maxH);
    g.fillRect(gap + i * (bw + gap), floor - bh, bw, bh);
  }
  g.fillStyle = p.c;
  for (let i = 0; i < COUNT; i++) {
    g.fillRect(gap + i * (bw + gap), floor - peaks[i] * maxH - 4 * dpr, bw, 2 * dpr);
  }
}

function mirrored(g: CanvasRenderingContext2D, v: View): void {
  const { width: w, height: h, dpr, palette: p } = v;
  const cx = w / 2;
  const cy = h / 2;
  const gap = 2 * dpr;
  const bw = (w / 2 - gap * COUNT) / COUNT;
  const maxH = h * 0.42;

  const grad = g.createLinearGradient(0, cy - maxH, 0, cy + maxH);
  grad.addColorStop(0, p.a);
  grad.addColorStop(0.5, p.c);
  grad.addColorStop(1, p.a);
  g.fillStyle = grad;
  for (let i = 0; i < COUNT; i++) {
    const bh = Math.max(dpr, bars[i] * maxH);
    const off = i * (bw + gap) + gap / 2;
    g.fillRect(cx + off, cy - bh, bw, bh * 2);
    g.fillRect(cx - off - bw, cy - bh, bw, bh * 2);
  }
}

/** Flat 60s/70s poster: a sun pumped by the bass, horizon by the mids, pills by the spectrum. */
function minimal(g: CanvasRenderingContext2D, a: AudioFrame, v: View): void {
  const { width: w, height: h, palette: p } = v;
  const { bass, mid, treble } = a.bands;
  const horizon = h * (0.72 - mid * 0.18);
  const sunX = w * 0.34;
  const sunR = Math.min(w, h) * (0.2 + bass * 0.14);

  g.fillStyle = p.a;
  g.beginPath();
  g.arc(sunX, horizon, sunR, 0, Math.PI * 2);
  g.fill();

  // Horizontal cut-outs across the lower part of the sun
  g.fillStyle = p.bg;
  const stripes = 5;
  for (let i = 0; i < stripes; i++) {
    const y = horizon - sunR * (0.12 + i * 0.13);
    const t = sunR * (0.025 + treble * 0.05) * (stripes - i) * 0.35;
    g.fillRect(sunX - sunR, y - t / 2, sunR * 2, t);
  }

  g.fillStyle = p.c;
  g.fillRect(0, horizon, w, h - horizon);

  logBars(a.spectrum, a.sampleRate, minimalBars.length, 40, 12000, minimalBars);
  const pw = w * 0.035;
  const left = w * 0.6;
  g.fillStyle = p.b;
  for (let i = 0; i < minimalBars.length; i++) {
    const ph = Math.max(pw, minimalBars[i] * h * 0.55);
    const x = left + i * pw * 1.35;
    g.beginPath();
    g.roundRect(x, horizon - ph, pw, ph + pw / 2, pw / 2);
    g.fill();
  }
}

export const spectrum: Mode2D = {
  kind: '2d',
  id: 'spectrum',
  name: 'Spektrum',
  icon: 'ChartColumn',
  variants: ['Sloupce', 'Zrcadlo', 'Minimal'],

  reset() {
    peaks.fill(0);
  },

  render(g, a, v) {
    g.fillStyle = v.palette.bg;
    g.fillRect(0, 0, v.width, v.height);
    logBars(a.spectrum, a.sampleRate, COUNT, 30, 16000, bars);
    updatePeaks(v.dt);

    if (v.variant === 0) barsUp(g, v);
    else if (v.variant === 1) mirrored(g, v);
    else minimal(g, a, v);
  },
};
