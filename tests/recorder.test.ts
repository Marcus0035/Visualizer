import { describe, expect, it } from 'vitest';
import { exportFileName, pickType } from '../src/export/recorder';

describe('pickType', () => {
  it('prefers MP4 and falls back to WebM', () => {
    expect(pickType(() => true)).toMatch(/^video\/mp4/);
    expect(pickType((t) => t.startsWith('video/webm'))).toMatch(/^video\/webm/);
    expect(pickType(() => false)).toBeNull();
  });

  it('takes VP8 WebM in WebKitGTK, whose MP4 recordings do not decode', () => {
    expect(pickType(() => true, true)).toBe('video/webm;codecs=vp8,opus');
    expect(pickType((t) => t.startsWith('video/mp4'), true)).toBeNull();
  });
});

describe('exportFileName', () => {
  it('names the file by format, time and container', () => {
    const d = new Date(2026, 9, 5, 7, 3);
    expect(exportFileName('video/mp4;codecs=avc1', 'phone', d)).toBe('visualizer-phone-2026-10-05-0703.mp4');
    expect(exportFileName('video/webm', 'pc', d)).toBe('visualizer-pc-2026-10-05-0703.webm');
  });
});
