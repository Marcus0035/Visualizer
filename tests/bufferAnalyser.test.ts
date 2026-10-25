import { describe, expect, it } from 'vitest';
import { BufferAnalyser } from '../src/audio/bufferAnalyser';

describe('BufferAnalyser', () => {
  const sr = 48000;
  const freq = 1000;
  const tone = new Float32Array(sr).map((_, i) => Math.sin((2 * Math.PI * freq * i) / sr));

  it('peaks at the tone frequency, near the level AnalyserNode reports', () => {
    const a = new BufferAnalyser([tone], 1, 2048, 0);
    a.position = 10000;
    const db = new Float32Array(1024);
    a.getFloatFrequencyData(db);
    const peak = db.indexOf(Math.max(...db));
    expect(Math.abs(peak - Math.round((freq * 2048) / sr))).toBeLessThanOrEqual(1);
    // Full-scale sine through Blackman: 0.5 * 0.42 -> about -13.6 dB
    expect(db[peak]).toBeGreaterThan(-16);
    expect(db[peak]).toBeLessThan(-11);
  });

  it('returns the last samples before the position, scaled by the gain, zeros before the start', () => {
    const a = new BufferAnalyser([tone, tone], 2, 8, 0);
    a.position = 4;
    const out = new Float32Array(8);
    a.getFloatTimeDomainData(out);
    expect(Array.from(out.slice(0, 4))).toEqual([0, 0, 0, 0]);
    expect(out[5]).toBeCloseTo(2 * tone[1], 5);
  });
});
