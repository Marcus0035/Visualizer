import { describe, expect, it } from 'vitest';
import { BeatDetector, bandEnergy, computeBands, envelope, logBars, normalizeDb, rms } from '../src/audio/analysis';

const SR = 48000;
const BINS = 1024; // fftSize 2048 -> 23.4 Hz per bin

function spectrumWithPeak(hz: number, value = 1): Float32Array {
  const s = new Float32Array(BINS);
  s[Math.round(hz / (SR / 2 / BINS))] = value;
  return s;
}

describe('bandEnergy / computeBands', () => {
  it('puts a 100 Hz peak into bass only', () => {
    const b = computeBands(spectrumWithPeak(100), SR);
    expect(b.bass).toBeGreaterThan(0);
    expect(b.mid).toBe(0);
    expect(b.treble).toBe(0);
  });

  it('puts an 8 kHz peak into treble only', () => {
    const b = computeBands(spectrumWithPeak(8000), SR);
    expect(b.bass).toBe(0);
    expect(b.mid).toBe(0);
    expect(b.treble).toBeGreaterThan(0);
  });

  it('averages a flat spectrum to its level', () => {
    const s = new Float32Array(BINS).fill(0.5);
    expect(bandEnergy(s, SR, 250, 4000)).toBeCloseTo(0.5);
  });

  it('returns 0 for an empty range', () => {
    expect(bandEnergy(new Float32Array(BINS).fill(1), SR, 30000, 40000)).toBe(0);
  });
});

describe('rms', () => {
  it('is 1/sqrt(2) for a full-scale sine', () => {
    const w = new Float32Array(4800).map((_, i) => Math.sin((2 * Math.PI * 100 * i) / SR));
    expect(rms(w)).toBeCloseTo(Math.SQRT1_2, 2);
  });

  it('is 0 for silence and empty input', () => {
    expect(rms(new Float32Array(10))).toBe(0);
    expect(rms([])).toBe(0);
  });
});

describe('normalizeDb', () => {
  it('maps and clamps to 0..1', () => {
    expect(normalizeDb(-90, -90, -10)).toBe(0);
    expect(normalizeDb(-50, -90, -10)).toBeCloseTo(0.5);
    expect(normalizeDb(0, -90, -10)).toBe(1);
    expect(normalizeDb(-Infinity, -90, -10)).toBe(0);
  });
});

describe('logBars', () => {
  it('returns the requested count and finds a peak in the right bar', () => {
    const bars = logBars(spectrumWithPeak(1000), SR, 32);
    expect(bars).toHaveLength(32);
    const peakBar = bars.indexOf(1);
    // 1 kHz sits roughly in the middle of 30 Hz..16 kHz on a log scale
    expect(peakBar).toBeGreaterThan(14);
    expect(peakBar).toBeLessThan(22);
  });

  it('never leaves low bars empty when bins are wider than bars', () => {
    const s = new Float32Array(BINS).fill(0.3);
    const bars = logBars(s, SR, 64);
    expect(Array.from(bars).every((v) => v === Math.fround(0.3))).toBe(true);
  });
});

describe('envelope', () => {
  it('rises faster than it falls', () => {
    const up = envelope(0, 1, 1 / 60);
    const down = 1 - envelope(1, 0, 1 / 60);
    expect(up).toBeGreaterThan(down);
  });
});

describe('BeatDetector', () => {
  it('detects periodic kicks and ignores steady energy', () => {
    const d = new BeatDetector();
    let beats = 0;
    for (let f = 0; f < 600; f++) {
      const t = f * (1000 / 60);
      const kick = f % 30 === 0 ? 0.9 : 0.2; // 120 BPM at 60 fps
      if (d.update(kick, t)) beats++;
    }
    expect(beats).toBeGreaterThanOrEqual(18);
    expect(beats).toBeLessThanOrEqual(20);

    const steady = new BeatDetector();
    let falsePositives = 0;
    for (let f = 0; f < 600; f++) if (steady.update(0.5, f * 16)) falsePositives++;
    expect(falsePositives).toBe(0);
  });

  it('respects the minimum gap', () => {
    const d = new BeatDetector(10, 1.2, 500);
    for (let f = 0; f < 10; f++) d.update(0.1, f * 16);
    expect(d.update(1, 200)).toBe(true);
    expect(d.update(1, 300)).toBe(false);
  });
});

describe('TempoTracker', () => {
  it('locks onto the beat grid of a steady 140 bpm pattern', async () => {
    const { TempoTracker } = await import('../src/audio/analysis');
    const tr = new TempoTracker();
    const period = 60 / 140;
    const beats: number[] = [];
    for (let t = 0; t < 30; t += 1 / 60) {
      const sinceKick = t % period;
      const sinceHat = (t + period / 2) % period;
      const onset = (sinceKick < 0.05 ? 1 : 0) + (sinceHat < 0.03 ? 0.4 : 0);
      if (tr.update(onset, t)) beats.push(t);
    }
    expect(tr.confident).toBe(true);
    expect(60 / tr.period).toBeGreaterThan(136);
    expect(60 / tr.period).toBeLessThan(144);
    const late = beats.filter((t) => t > 15);
    expect(late.length).toBeGreaterThan(25);
    for (const t of late) {
      const off = t % period;
      expect(Math.min(off, period - off)).toBeLessThan(0.07);
    }
  });
});
