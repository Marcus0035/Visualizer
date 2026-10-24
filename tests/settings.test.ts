import { describe, expect, it } from 'vitest';
import { DEFAULTS, paramValue, parseSettings, variantOf } from '../src/settings';
import type { Mode } from '../src/modes/types';

describe('parseSettings', () => {
  it('falls back to defaults for garbage', () => {
    expect(parseSettings(null)).toEqual(DEFAULTS);
    expect(parseSettings('x')).toEqual(DEFAULTS);
  });

  it('drops values of the wrong type and keeps valid ones', () => {
    const s = parseSettings({ mode: 'plasma', crt: 'yes', sensitivity: NaN, volume: 0.3, variants: null });
    expect(s.mode).toBe('plasma');
    expect(s.crt).toBe(false);
    expect(s.sensitivity).toBe(DEFAULTS.sensitivity);
    expect(s.volume).toBe(0.3);
    expect(s.variants).toEqual({});
  });

  it('keeps only non-negative integer variants', () => {
    expect(parseSettings({ variants: { a: 1, b: -1, c: 1.5, d: '2' } }).variants).toEqual({ a: 1 });
  });
});

describe('variantOf', () => {
  it('clamps a stored variant to the mode', () => {
    const mode = { id: 'm', variants: ['x', 'y'] } as Mode;
    expect(variantOf(mode, { ...DEFAULTS, variants: { m: 5 } })).toBe(1);
    expect(variantOf(mode, { ...DEFAULTS, variants: {} })).toBe(0);
  });
});

describe('paramValue', () => {
  const mode = {
    id: 'm',
    variants: ['x'],
    params: [
      { id: 'uSpeed', label: 'Speed', default: 1, min: 0.25, max: 3 },
      { id: 'uEvery', label: 'Every', default: 1, options: [{ label: '1', value: 1 }, { label: '4', value: 4 }] },
    ],
  } as Mode;
  const [speed, every] = mode.params!;

  it('uses defaults, clamps ranges and rejects unknown options', () => {
    expect(paramValue(mode, speed, { ...DEFAULTS })).toBe(1);
    expect(paramValue(mode, speed, { ...DEFAULTS, params: { m: { uSpeed: 9 } } })).toBe(3);
    expect(paramValue(mode, every, { ...DEFAULTS, params: { m: { uEvery: 4 } } })).toBe(4);
    expect(paramValue(mode, every, { ...DEFAULTS, params: { m: { uEvery: 3 } } })).toBe(1);
  });

  it('parses nested params and drops junk', () => {
    expect(parseSettings({ params: { m: { uSpeed: 2, bad: 'x' }, n: null } }).params).toEqual({ m: { uSpeed: 2 } });
  });
});
