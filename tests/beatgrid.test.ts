import { describe, expect, it } from 'vitest';
import { gridFromEnvelope, onsetEnvelope, snapTime } from '../src/audio/beatgrid';

/** Click track: a short low thump on every beat, the first of each bar twice as strong. */
function clicks(bpm: number, seconds: number, firstAt: number, sampleRate = 8000): Float32Array {
  const out = new Float32Array(seconds * sampleRate);
  const period = 60 / bpm;
  let beat = 0;
  for (let t = firstAt; t < seconds - 0.1; t += period, beat++) {
    const amp = beat % 4 === 0 ? 1 : 0.5;
    for (let i = 0; i < 0.06 * sampleRate; i++) out[Math.round(t * sampleRate) + i] += amp * Math.sin((2 * Math.PI * 60 * i) / sampleRate) * (1 - i / (0.06 * sampleRate));
  }
  return out;
}

describe('beat grid', () => {
  it('finds tempo, phase and the bar start of a click track', () => {
    const g = gridFromEnvelope(onsetEnvelope(clicks(124, 40, 0.37), 8000))!;
    expect(g.bpm).toBeGreaterThan(122.5);
    expect(g.bpm).toBeLessThan(125.5);
    const phase = (g.offset - 0.37 + 10 * g.period) % g.period;
    expect(Math.min(phase, g.period - phase)).toBeLessThan(0.06);
  });

  it('snaps to beats and to bars', () => {
    const g = { bpm: 120, period: 0.5, offset: 0.1, downbeat: 1, beatsPerBar: 4 };
    expect(snapTime(g, 1.23, 'beat')).toBeCloseTo(1.1, 5);
    expect(snapTime(g, 3.0, 'bar')).toBeCloseTo(2.6, 5);
  });

  it('gives up on silence', () => {
    expect(gridFromEnvelope(onsetEnvelope(new Float32Array(8000 * 20), 8000))).toBeNull();
  });
});
