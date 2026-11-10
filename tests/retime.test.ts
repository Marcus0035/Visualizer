import { describe, expect, it } from 'vitest';
import { planRetime } from '../src/export/retime';

describe('planRetime', () => {
  it('drops the packets before a clock jump and starts every track at zero', () => {
    const video = [4130.2, 4130.23, 4130.27];
    const audio = [0.13, 0.144, 4147.5, 4147.52];
    expect(planRetime([video, audio])).toEqual({ skip: [0, 2], base: [4130.2, 4147.5] });
  });

  it('leaves a recording that starts at zero alone', () => {
    expect(planRetime([[0, 0.033], [0, 0.02]])).toEqual({ skip: [0, 0], base: [0, 0] });
  });
});
