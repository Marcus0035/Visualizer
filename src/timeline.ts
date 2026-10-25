// Timeline of a loaded track: clips pin a mode, filter, palette or color flip to a stretch of time.
// While a clip covers the playhead the autopilot leaves that thing alone and the clip's value is shown.
import type { AutoParts } from './autopilot';
import type { Settings } from './settings';

export type TrackId = 'mode' | 'filter' | 'palette' | 'invert';

export const TRACKS: { id: TrackId; label: string }[] = [
  { id: 'mode', label: 'Mode' },
  { id: 'filter', label: 'Filter' },
  { id: 'palette', label: 'Colors' },
  { id: 'invert', label: 'Invert' },
];

export interface Clip {
  id: string;
  track: TrackId;
  /** Seconds from the start of the track */
  start: number;
  end: number;
  /** Mode: "id" or "id:variant"; filter: index; palette: palette id; invert: "on" */
  value: string;
}

export const MIN_CLIP = 0.5;

const TRACK_IDS = new Set<string>(TRACKS.map((t) => t.id));

/** Keep only well-formed clips (stored data may be anything). */
export function parseClips(raw: unknown): Clip[] {
  if (!Array.isArray(raw)) return [];
  const out: Clip[] = [];
  for (const c of raw) {
    if (!c || typeof c !== 'object') continue;
    const r = c as Record<string, unknown>;
    if (typeof r.id !== 'string' || typeof r.track !== 'string' || !TRACK_IDS.has(r.track) || typeof r.value !== 'string') continue;
    if (typeof r.start !== 'number' || typeof r.end !== 'number' || !Number.isFinite(r.start) || !Number.isFinite(r.end)) continue;
    if (r.start < 0 || r.end - r.start < MIN_CLIP) continue;
    out.push({ id: r.id, track: r.track as TrackId, start: r.start, end: r.end, value: r.value });
  }
  return out.slice(0, 500);
}

export function clipAt(clips: readonly Clip[], track: TrackId, t: number): Clip | undefined {
  return clips.find((c) => c.track === track && t >= c.start && t < c.end);
}

export function trackClips(clips: readonly Clip[], track: TrackId): Clip[] {
  return clips.filter((c) => c.track === track).sort((a, b) => a.start - b.start);
}

/** Room around a clip on its track: it may not overlap its neighbours. */
export function freeRange(clips: readonly Clip[], track: TrackId, at: number, ignoreId?: string): { min: number; max: number } {
  let min = 0;
  let max = Infinity;
  for (const c of trackClips(clips, track)) {
    if (c.id === ignoreId) continue;
    if (c.end <= at) min = Math.max(min, c.end);
    else if (c.start > at) max = Math.min(max, c.start);
    else return { min: at, max: at }; // `at` is inside another clip
  }
  return { min, max };
}

/** Start and end for a new clip of `length` seconds wanted at `at`, or null when there is no room. */
export function placeClip(clips: readonly Clip[], track: TrackId, at: number, length: number, limit: number): { start: number; end: number } | null {
  const { min, max } = freeRange(clips, track, at);
  if (max - min < MIN_CLIP) return null;
  const start = Math.min(Math.max(at, min), Math.max(min, Math.min(max, limit) - MIN_CLIP));
  const end = Math.min(start + length, max, Math.max(limit, start + MIN_CLIP));
  return end - start >= MIN_CLIP ? { start, end } : null;
}

export function describeValue(track: TrackId, value: string): { id: string; variant: number | null } {
  if (track !== 'mode') return { id: value, variant: null };
  const [id, v] = value.split(':');
  const variant = v === undefined ? null : Number(v);
  return { id, variant: variant !== null && Number.isInteger(variant) && variant >= 0 ? variant : null };
}

/** Settings as they look at time `t`: pinned things replaced by their clip's value. */
export function withTimeline(s: Settings, clips: readonly Clip[], t: number): Settings {
  if (!clips.length) return s;
  const mode = clipAt(clips, 'mode', t);
  const filter = clipAt(clips, 'filter', t);
  const palette = clipAt(clips, 'palette', t);
  const invert = clipAt(clips, 'invert', t);
  if (!mode && !filter && !palette && !invert) return s;
  const out: Settings = { ...s };
  if (mode) {
    const { id, variant } = describeValue('mode', mode.value);
    out.mode = id;
    if (variant !== null) out.variants = { ...s.variants, [id]: variant };
  }
  if (filter && Number.isInteger(Number(filter.value))) out.filter = Number(filter.value);
  if (palette) out.palette = palette.value;
  if (invert) out.invert = true;
  return out;
}

/** What the autopilot may still change at time `t`: pinned things stay as the clips set them. */
export function unlockedParts(parts: AutoParts, clips: readonly Clip[], t: number): AutoParts {
  if (!clips.length) return parts;
  const mode = !!clipAt(clips, 'mode', t);
  const colors = !!clipAt(clips, 'palette', t) || !!clipAt(clips, 'invert', t);
  return {
    ...parts,
    autoMode: parts.autoMode && !mode,
    autoVariant: parts.autoVariant && !mode,
    autoParams: parts.autoParams && !mode,
    autoPalette: parts.autoPalette && !colors,
    autoFilter: parts.autoFilter && !clipAt(clips, 'filter', t),
  };
}
