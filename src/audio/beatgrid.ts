// Beat grid of a whole decoded track: tempo, where the beats fall and which of them start a bar.
// Used by the timeline editor to draw bars and snap clips.

export interface BeatGrid {
  bpm: number;
  /** Seconds per beat */
  period: number;
  /** Time of a beat on the grid (any beat; use `beatTime`) */
  offset: number;
  /** Beat index (0..3) of the first bar line, counted from the first beat after `offset` */
  downbeat: number;
  beatsPerBar: number;
}

const HOP = 0.01;
const MIN_BPM = 75;
const MAX_BPM = 190;

/** Onset strength per HOP: rises of the kick band, plus a little of the full signal. */
export function onsetEnvelope(mono: Float32Array, sampleRate: number): Float32Array {
  const hop = Math.max(1, Math.round(HOP * sampleRate));
  const frames = Math.floor(mono.length / hop);
  const lowEnv = new Float32Array(frames);
  const fullEnv = new Float32Array(frames);
  const k = 1 - Math.exp((-2 * Math.PI * 150) / sampleRate); // one-pole lowpass at ~150 Hz
  let lp = 0;
  for (let f = 0; f < frames; f++) {
    let lo = 0;
    let all = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) {
      const x = mono[i];
      lp += k * (x - lp);
      lo += lp * lp;
      all += x * x;
    }
    lowEnv[f] = Math.sqrt(lo / hop);
    fullEnv[f] = Math.sqrt(all / hop);
  }
  const out = new Float32Array(frames);
  for (let f = 1; f < frames; f++) {
    out[f] = Math.max(0, lowEnv[f] - lowEnv[f - 1]) + 0.3 * Math.max(0, fullEnv[f] - fullEnv[f - 1]);
  }
  // Remove the slow-moving level so loud parts do not dominate the tempo
  const w = Math.round(1 / HOP);
  const clean = new Float32Array(frames);
  let sum = 0;
  for (let f = 0; f < frames; f++) {
    sum += out[f];
    if (f >= 2 * w) sum -= out[f - 2 * w];
    const mean = sum / Math.min(f + 1, 2 * w);
    clean[f] = Math.max(0, out[f] - mean * 0.8);
  }
  return clean;
}

/** Comb score: onset energy found on a grid of the given period and phase. */
function comb(env: Float32Array, period: number, phase: number): number {
  let s = 0;
  for (let t = phase; t < env.length * HOP; t += period) {
    const i = Math.round(t / HOP);
    if (i >= env.length) break;
    s += env[i] + 0.5 * (env[i - 1] ?? 0) + 0.5 * (env[i + 1] ?? 0);
  }
  return s;
}

export function gridFromEnvelope(env: Float32Array, beatsPerBar = 4): BeatGrid | null {
  const n = env.length;
  if (n < 6 / HOP) return null;
  let energy = 0;
  for (let i = 0; i < n; i++) energy += env[i] * env[i];
  if (energy < 1e-9) return null;

  // Coarse tempo from the autocorrelation of the onset envelope
  const lagMin = Math.floor(60 / MAX_BPM / HOP);
  const lagMax = Math.ceil(60 / MIN_BPM / HOP);
  const ac = new Float32Array(lagMax + 2);
  for (let lag = lagMin - 1; lag <= lagMax + 1; lag++) {
    let s = 0;
    for (let i = lag; i < n; i++) s += env[i] * env[i - lag];
    ac[lag] = s / energy;
  }
  let best = lagMin;
  let bestScore = -1;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    const oct = Math.log2(60 / (lag * HOP) / 130);
    const score = ac[lag] * Math.exp(-(oct * oct) / 0.9);
    if (score > bestScore && ac[lag] >= ac[lag - 1] && ac[lag] >= ac[lag + 1]) {
      bestScore = score;
      best = lag;
    }
  }
  if (bestScore <= 0.02) return null;

  // Fine tempo and phase: slide a comb over the whole track
  let bestPeriod = best * HOP;
  let bestPhase = 0;
  let bestSum = -1;
  for (let k = -15; k <= 15; k++) {
    const period = best * HOP * (1 + k * 0.001);
    for (let ph = 0; ph < period; ph += HOP) {
      const s = comb(env, period, ph);
      if (s > bestSum) {
        bestSum = s;
        bestPeriod = period;
        bestPhase = ph;
      }
    }
  }

  // Which beat opens the bar: the one with the strongest onsets
  const strength = new Array<number>(beatsPerBar).fill(0);
  let beat = 0;
  for (let t = bestPhase; t < n * HOP; t += bestPeriod, beat++) {
    const i = Math.round(t / HOP);
    if (i < n) strength[beat % beatsPerBar] += env[i];
  }
  const downbeat = strength.indexOf(Math.max(...strength));
  return { bpm: 60 / bestPeriod, period: bestPeriod, offset: bestPhase, downbeat, beatsPerBar };
}

export function analyzeBeats(buffer: AudioBuffer): BeatGrid | null {
  const n = buffer.length;
  const mono = new Float32Array(n);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < n; i++) mono[i] += data[i] / buffer.numberOfChannels;
  }
  return gridFromEnvelope(onsetEnvelope(mono, buffer.sampleRate));
}

/** Time of beat number `k` (0 = the first beat of the grid). */
export function beatTime(g: BeatGrid, k: number): number {
  return g.offset + k * g.period;
}

/** Time of the first bar line. */
export function firstBar(g: BeatGrid): number {
  return beatTime(g, g.downbeat);
}

/** Nearest grid line to `t`: beats, or only bar lines. */
export function snapTime(g: BeatGrid, t: number, unit: 'beat' | 'bar'): number {
  const step = unit === 'bar' ? g.period * g.beatsPerBar : g.period;
  const origin = unit === 'bar' ? firstBar(g) : g.offset;
  const k = Math.round((t - origin) / step);
  return Math.max(0, origin + k * step);
}
