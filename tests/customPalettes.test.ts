import { describe, expect, it } from 'vitest';
import { newCustomPalette } from '../src/customPalettes';

const colors = { bg: '#000000', a: '#ff0000', b: '#880000', c: '#ffaaaa' };

describe('newCustomPalette', () => {
  it('gives fresh ids and a fallback name', () => {
    const first = newCustomPalette([], '  ', colors);
    expect(first.name).toBe('Custom 1');
    const second = newCustomPalette([first], 'Sunset', colors);
    expect(second.id).not.toBe(first.id);
    expect(second.name).toBe('Sunset');
  });
});
