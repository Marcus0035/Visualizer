import { describe, expect, it } from 'vitest';
import { AutoClock, EVERYTHING, autoStep, pickOther, randomParam } from '../src/autopilot';
import { PALETTES } from '../src/modes/palettes';
import type { Mode, ModeParam } from '../src/modes/types';
import { parseSettings } from '../src/settings';

/** Deterministic pseudo-random sequence */
function seq(seed = 1): () => number {
  let x = seed;
  return () => {
    x = (x * 16807) % 2147483647;
    return x / 2147483647;
  };
}

const mode = (id: string, params: ModeParam[] = []): Mode =>
  ({ kind: 'gl', id, name: id, icon: 'Zap', variants: ['a', 'b', 'c'], params, fragment: '' }) as Mode;

const MODES = [
  mode('techno', [
    { id: 'uSpeed', label: '', default: 1, min: 0.25, max: 3, step: 0.05 },
    { id: 'uEvery', label: '', default: 1, options: [1, 2, 4, 8].map((n) => ({ label: '', value: n })) },
  ]),
  mode('plasma'),
  mode('matrix'),
];
const ctx = { modes: MODES, palettes: PALETTES, filterCount: 10 };

describe('pickOther', () => {
  it('never returns the current item when there is another', () => {
    const rnd = seq();
    for (let i = 0; i < 50; i++) expect(pickOther([1, 2, 3], 2, rnd)).not.toBe(2);
  });
  it('keeps the only item', () => {
    expect(pickOther(['x'], 'x', seq())).toBe('x');
  });
});

describe('randomParam', () => {
  it('stays in range and on the step', () => {
    const rnd = seq(7);
    const p = MODES[0].params![0];
    for (let i = 0; i < 200; i++) {
      const v = randomParam(p, rnd);
      expect(v).toBeGreaterThanOrEqual(0.25);
      expect(v).toBeLessThanOrEqual(3);
      expect(Math.abs((v - 0.25) / 0.05 - Math.round((v - 0.25) / 0.05))).toBeLessThan(1e-6);
    }
  });
  it('picks one of the options', () => {
    const rnd = seq(3);
    for (let i = 0; i < 50; i++) expect([1, 2, 4, 8]).toContain(randomParam(MODES[0].params![1], rnd));
  });
});

describe('autoStep', () => {
  it('changes only the allowed parts', () => {
    const s = parseSettings({ autoMode: false, autoVariant: true, autoParams: true, autoPalette: false, autoFilter: false });
    autoStep(s, ctx, seq(5));
    expect(s.mode).toBe('techno');
    expect(s.palette).toBe('blood');
    expect(s.filter).toBe(0);
    expect(s.variants.techno).not.toBe(0);
    expect(Object.keys(s.params.techno)).toEqual(['uSpeed', 'uEvery']);
  });
  it('skips left-out modes and picks only dark palettes', () => {
    const s = parseSettings({ autoSkip: ['plasma'], autoPalette: true });
    const rnd = seq(11);
    for (let i = 0; i < 30; i++) {
      autoStep(s, ctx, rnd);
      expect(s.mode).not.toBe('plasma');
      expect(PALETTES.find((p) => p.id === s.palette)?.dark).toBe(true);
    }
  });
  it('keeps the mode when every mode is left out', () => {
    const s = parseSettings({ autoSkip: ['techno', 'plasma', 'matrix'] });
    autoStep(s, ctx, seq());
    expect(s.mode).toBe('techno');
  });
  it('switches filters within range', () => {
    const s = parseSettings({ autoFilter: true });
    const rnd = seq(13);
    for (let i = 0; i < 30; i++) {
      autoStep(s, ctx, rnd);
      expect(s.filter).toBeGreaterThanOrEqual(0);
      expect(s.filter).toBeLessThan(10);
    }
  });
});

describe('AutoClock', () => {
  it('jumps after the given number of kicks', () => {
    const c = new AutoClock();
    const hits = Array.from({ length: 16 }, () => c.tick(true, 0.5, 0.01, 8));
    expect(hits.filter(Boolean).length).toBe(2);
    expect(hits[7]).toBe(true);
  });
  it('falls back to time without a beat, but not in silence', () => {
    const c = new AutoClock();
    let jumped = false;
    for (let i = 0; i < 1000 && !jumped; i++) jumped = c.tick(false, 0, 0.1, 8);
    expect(jumped).toBe(false);
    for (let i = 0; i < 200 && !jumped; i++) jumped = c.tick(false, 0.3, 0.1, 8);
    expect(jumped).toBe(true);
  });
});

describe('random button', () => {
  it('changes everything even with the autopilot parts off', () => {
    const s = parseSettings({ autoMode: false, autoVariant: false, autoParams: false, autoPalette: false, autoSkip: ['plasma', 'matrix'] });
    const seen = new Set<string>();
    const rnd = seq(17);
    for (let i = 0; i < 20; i++) {
      autoStep(s, ctx, rnd, EVERYTHING);
      seen.add(s.mode);
    }
    expect(seen.size).toBe(3);
    expect(s.palette).not.toBe('blood');
  });
});
