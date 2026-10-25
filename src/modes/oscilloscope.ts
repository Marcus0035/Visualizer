import type { AudioFrame } from '../audio/AudioEngine';
import { rgba } from './palettes';
import type { Mode2D, View } from './types';

const SPAN = 1024; // samples shown in the wave variant

/** First rising zero crossing in the first half, so the trace stands still. */
function triggerIndex(wave: Float32Array): number {
  const limit = wave.length - SPAN - 1;
  for (let i = 0; i < limit; i++) if (wave[i] <= 0 && wave[i + 1] > 0) return i;
  return 0;
}

function graticule(g: CanvasRenderingContext2D, v: View): void {
  const { width: w, height: h, dpr, palette: p } = v;
  g.strokeStyle = rgba(p.b, 0.08);
  g.lineWidth = dpr;
  g.beginPath();
  for (let i = 1; i < 10; i++) {
    const x = Math.round((w * i) / 10) + 0.5;
    g.moveTo(x, 0);
    g.lineTo(x, h);
  }
  for (let i = 1; i < 8; i++) {
    const y = Math.round((h * i) / 8) + 0.5;
    g.moveTo(0, y);
    g.lineTo(w, y);
  }
  g.stroke();
}

function tracePath(g: CanvasRenderingContext2D, a: AudioFrame, v: View): void {
  const { width: w, height: h } = v;
  const cx = w / 2;
  const cy = h / 2;
  g.beginPath();

  if (v.variant === 0) {
    const start = triggerIndex(a.wave);
    const amp = h * 0.42;
    for (let i = 0; i < SPAN; i++) {
      const x = (i / (SPAN - 1)) * w;
      const y = cy - a.wave[start + i] * amp;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
  } else if (v.variant === 1) {
    // Goniometer: mono content draws a vertical line, stereo width opens it up
    const r = Math.min(w, h) * 0.45;
    for (let i = 0; i < a.waveL.length; i++) {
      const x = cx + ((a.waveL[i] - a.waveR[i]) * Math.SQRT1_2) * r;
      const y = cy - ((a.waveL[i] + a.waveR[i]) * Math.SQRT1_2) * r;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
  } else {
    const base = Math.min(w, h) * (0.26 + a.bands.bass * 0.08);
    const n = SPAN;
    for (let i = 0; i <= n; i++) {
      const ang = (i / n) * Math.PI * 2 - Math.PI / 2;
      const r = base * (1 + a.wave[i % n] * 0.6);
      const x = cx + Math.cos(ang) * r;
      const y = cy + Math.sin(ang) * r;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
  }
}

export const oscilloscope: Mode2D = {
  kind: '2d',
  id: 'oscilloscope',
  name: 'Oscilloscope',
  icon: 'Activity',
  variants: ['Wave', 'Stereo XY', 'Circle'],
  glow: 1,

  reset(g, v) {
    g.fillStyle = v.palette.bg;
    g.fillRect(0, 0, v.width, v.height);
  },

  render(g, a, v) {
    const { dpr, palette: p } = v;
    // Phosphor persistence: fade the previous frame instead of clearing it
    g.fillStyle = rgba(p.bg, 0.3);
    g.fillRect(0, 0, v.width, v.height);
    graticule(g, v);

    // Only crisp strokes here; the glow is added on the GPU (see Mode2D.glow)
    tracePath(g, a, v);
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.strokeStyle = rgba(p.a, 0.7);
    g.lineWidth = (3 + a.level * 5) * dpr;
    g.stroke();
    g.strokeStyle = p.c;
    g.lineWidth = 1.5 * dpr;
    g.stroke();
  },
};
