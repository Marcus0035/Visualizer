// Song structure from the decoded file: where the kick drum carries the track (drive) and
// where it drops out (intro, break, outro), so beat effects can rest in the quiet parts.

export type SectionKind = 'intro' | 'drive' | 'break' | 'outro';

export interface Section {
  kind: SectionKind;
  /** Seconds */
  start: number;
  end: number;
}

/** Analysis step in seconds */
const STEP = 0.5;
/** Calm parts shorter than this are just fills, not breaks */
const MIN_CALM = 6;
/** Drive parts shorter than this inside a break do not end it */
const MIN_DRIVE = 4;
/** Fade between calm and drive, seconds */
const FADE = 0.4;

/** Two one-pole lowpasses at about 120 Hz: what is left is mostly kick and sub bass. */
function lowBand(x: Float32Array, sampleRate: number): Float32Array {
  const k = 1 - Math.exp((-2 * Math.PI * 120) / sampleRate);
  const out = new Float32Array(x.length);
  let a = 0;
  let b = 0;
  for (let i = 0; i < x.length; i++) {
    a += k * (x[i] - a);
    b += k * (a - b);
    out[i] = b;
  }
  return out;
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
}

/**
 * Per STEP: how strongly the low band pulses. A kick gives a low band that is both loud
 * and jumpy (peak well above its mean); a pad or a held bass note is smooth.
 */
export function kickStrength(mono: Float32Array, sampleRate: number): number[] {
  const low = lowBand(mono, sampleRate);
  const block = Math.max(1, Math.round(STEP * sampleRate));
  const sub = Math.max(1, Math.round(0.02 * sampleRate)); // 20 ms envelope slices
  const out: number[] = [];
  for (let start = 0; start < low.length; start += block) {
    const end = Math.min(low.length, start + block);
    let sum = 0;
    let peak = 0;
    let n = 0;
    for (let s = start; s < end; s += sub) {
      let e = 0;
      const stop = Math.min(end, s + sub);
      for (let i = s; i < stop; i++) e += low[i] * low[i];
      e = Math.sqrt(e / Math.max(1, stop - s));
      sum += e;
      peak = Math.max(peak, e);
      n++;
    }
    const mean = sum / Math.max(1, n);
    out.push(Math.max(0, peak - mean));
  }
  return out;
}

/** Calm (true) / drive (false) per step, with short runs merged into their neighbours. */
function calmSteps(strength: number[]): boolean[] {
  const ref = percentile(strength, 0.75);
  if (ref <= 1e-6) return strength.map(() => false);
  // Median over 3 s against single missing kicks
  const half = 3;
  const smooth = strength.map((_, i) => {
    const win = strength.slice(Math.max(0, i - half), i + half + 1);
    return percentile(win, 0.5);
  });
  const calm = smooth.map((v) => v < ref * 0.35);
  const merge = (value: boolean, minSteps: number) => {
    let i = 0;
    while (i < calm.length) {
      let j = i;
      while (j < calm.length && calm[j] === calm[i]) j++;
      // A short run between two runs of the other kind takes their value
      if (calm[i] === value && j - i < minSteps && i > 0 && j < calm.length) calm.fill(!value, i, j);
      i = j;
    }
  };
  merge(true, Math.round(MIN_CALM / STEP));
  merge(false, Math.round(MIN_DRIVE / STEP));
  return calm;
}

export function sectionsFrom(strength: number[], duration: number): Section[] {
  const calm = calmSteps(strength);
  const sections: Section[] = [];
  let i = 0;
  while (i < calm.length) {
    let j = i;
    while (j < calm.length && calm[j] === calm[i]) j++;
    sections.push({ kind: calm[i] ? 'break' : 'drive', start: i * STEP, end: Math.min(duration, j * STEP) });
    i = j;
  }
  const hasDrive = sections.some((s) => s.kind === 'drive');
  if (hasDrive) {
    if (sections[0].kind === 'break') sections[0].kind = 'intro';
    const last = sections[sections.length - 1];
    if (last.kind === 'break') last.kind = 'outro';
  }
  return sections;
}

export class SongStructure {
  constructor(readonly sections: Section[]) {}

  static analyze(buffer: AudioBuffer): SongStructure {
    const n = buffer.length;
    const mono = new Float32Array(n);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < n; i++) mono[i] += data[i] / buffer.numberOfChannels;
    }
    return new SongStructure(sectionsFrom(kickStrength(mono, buffer.sampleRate), buffer.duration));
  }

  sectionAt(t: number): Section | null {
    return this.sections.find((s) => t >= s.start && t < s.end) ?? null;
  }

  /** 0 in drive parts, 1 in calm parts, with short fades at the edges. */
  calmAt(t: number): number {
    const raw = (x: number) => {
      const s = this.sectionAt(x);
      return s && s.kind !== 'drive' ? 1 : 0;
    };
    let sum = 0;
    for (let k = -2; k <= 2; k++) sum += raw(t + (k / 2) * FADE);
    return sum / 5;
  }

  /** True when a drive part (a drop) starts between t - dt and t */
  dropAt(t: number, dt: number): boolean {
    return this.sections.some((s, i) => i > 0 && s.kind === 'drive' && s.start <= t && s.start > t - dt);
  }
}
