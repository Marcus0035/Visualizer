import { describe, expect, it } from 'vitest';
import { DEFAULTS } from '../src/settings';
import { type Clip, clipAt, freeRange, parseClips, placeClip, unlockedParts, withTimeline } from '../src/timeline';

const clip = (id: string, track: Clip['track'], start: number, end: number, value: string): Clip => ({ id, track, start, end, value });

describe('timeline', () => {
  const clips = [clip('a', 'mode', 10, 20, 'lsd:3'), clip('b', 'filter', 0, 5, '2'), clip('c', 'mode', 30, 40, 'techno')];

  it('finds the clip under the playhead', () => {
    expect(clipAt(clips, 'mode', 15)?.id).toBe('a');
    expect(clipAt(clips, 'mode', 25)).toBeUndefined();
    expect(clipAt(clips, 'mode', 20)).toBeUndefined();
  });

  it('pins mode, variant and filter while a clip is active', () => {
    const at = withTimeline(DEFAULTS, clips, 12);
    expect(at.mode).toBe('lsd');
    expect(at.variants.lsd).toBe(3);
    expect(withTimeline(DEFAULTS, clips, 3).filter).toBe(2);
    expect(withTimeline(DEFAULTS, clips, 25)).toBe(DEFAULTS);
  });

  it('locks what a clip pins in the autopilot', () => {
    const all = { ...DEFAULTS, autoMode: true, autoVariant: true, autoParams: true, autoPalette: true, autoFilter: true, autoImage: true, autoSkip: [] };
    const during = unlockedParts(all, clips, 12);
    expect(during.autoMode || during.autoVariant || during.autoParams).toBe(false);
    expect(during.autoFilter).toBe(true);
    expect(unlockedParts(all, clips, 3).autoFilter).toBe(false);
    expect(unlockedParts(all, clips, 25).autoMode).toBe(true);
  });

  it('keeps clips from overlapping', () => {
    expect(freeRange(clips, 'mode', 25)).toEqual({ min: 20, max: 30 });
    expect(placeClip(clips, 'mode', 18, 8, 100)).toBeNull();
    expect(placeClip(clips, 'mode', 22, 8, 100)).toEqual({ start: 22, end: 30 });
    expect(placeClip(clips, 'mode', 45, 8, 100)).toEqual({ start: 45, end: 53 });
  });

  it('drops malformed stored clips', () => {
    expect(parseClips([{ id: 'x', track: 'nope', start: 0, end: 5, value: 'a' }, { id: 'y', track: 'mode', start: 0, end: 5, value: 'techno' }, 3, null])).toHaveLength(1);
    expect(parseClips('x')).toEqual([]);
  });
});
