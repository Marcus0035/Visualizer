import { describe, expect, it } from 'vitest';
import { SongStructure, kickStrength, sectionsFrom } from '../src/audio/structure';

const SR = 8000;

/** Kicks at 128 BPM in [from, to), a quiet pad everywhere */
function song(seconds: number, kickParts: [number, number][]): Float32Array {
  const x = new Float32Array(seconds * SR);
  for (let i = 0; i < x.length; i++) x[i] = 0.05 * Math.sin((2 * Math.PI * 440 * i) / SR);
  const beat = 60 / 128;
  for (const [from, to] of kickParts) {
    for (let t = from; t < to; t += beat) {
      const start = Math.floor(t * SR);
      for (let i = 0; i < 0.15 * SR && start + i < x.length; i++) {
        const env = Math.exp(-i / (0.04 * SR));
        x[start + i] += 0.9 * env * Math.sin((2 * Math.PI * 55 * i) / SR);
      }
    }
  }
  return x;
}

describe('song structure', () => {
  const x = song(80, [[16, 40], [56, 72]]);
  const sections = sectionsFrom(kickStrength(x, SR), 80);

  it('finds intro, drive, break, drive, outro', () => {
    expect(sections.map((s) => s.kind)).toEqual(['intro', 'drive', 'break', 'drive', 'outro']);
  });

  it('puts the edges near the real ones', () => {
    const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(2.5);
    near(sections[1].start, 16);
    near(sections[2].start, 40);
    near(sections[3].start, 56);
    near(sections[4].start, 72);
  });

  it('calmAt is 1 in breaks, 0 in drives and finds the drop', () => {
    const st = new SongStructure(sections);
    expect(st.calmAt(5)).toBe(1);
    expect(st.calmAt(28)).toBe(0);
    expect(st.calmAt(48)).toBe(1);
    expect(st.dropAt(sections[3].start + 0.01, 0.05)).toBe(true);
    expect(st.dropAt(30, 0.05)).toBe(false);
  });

  it('a track with kicks all the way has no calm part', () => {
    const all = sectionsFrom(kickStrength(song(40, [[0, 40]]), SR), 40);
    expect(all.map((s) => s.kind)).toEqual(['drive']);
  });
});
