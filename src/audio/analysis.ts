// Pure audio-analysis helpers. No Web Audio dependencies so they can be unit-tested.

export interface Bands {
  bass: number;
  mid: number;
  treble: number;
}

export const BAND_RANGES: Record<keyof Bands, [number, number]> = {
  bass: [20, 250],
  mid: [250, 4000],
  treble: [4000, 16000],
};

/** Narrow band around the kick drum; the wider bass band is dominated by sustained basslines. */
export const KICK_RANGE: [number, number] = [45, 120];

/** Hz covered by one spectrum bin (spectrum spans 0..Nyquist). */
export function binWidth(binCount: number, sampleRate: number): number {
  return sampleRate / 2 / binCount;
}

/** Mean magnitude (0..1) of the bins between lo and hi Hz. */
export function bandEnergy(spectrum: ArrayLike<number>, sampleRate: number, lo: number, hi: number): number {
  const hz = binWidth(spectrum.length, sampleRate);
  const start = Math.max(0, Math.floor(lo / hz));
  const end = Math.min(spectrum.length, Math.ceil(hi / hz));
  if (end <= start) return 0;
  let sum = 0;
  for (let i = start; i < end; i++) sum += spectrum[i];
  return sum / (end - start);
}

export function computeBands(spectrum: ArrayLike<number>, sampleRate: number): Bands {
  return {
    bass: bandEnergy(spectrum, sampleRate, ...BAND_RANGES.bass),
    mid: bandEnergy(spectrum, sampleRate, ...BAND_RANGES.mid),
    treble: bandEnergy(spectrum, sampleRate, ...BAND_RANGES.treble),
  };
}

/** Root mean square of a waveform (-1..1 samples). */
export function rms(wave: ArrayLike<number>): number {
  if (wave.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < wave.length; i++) sum += wave[i] * wave[i];
  return Math.sqrt(sum / wave.length);
}

/** Map an analyser dB value to 0..1 within [minDb, maxDb]. */
export function normalizeDb(db: number, minDb: number, maxDb: number): number {
  if (!Number.isFinite(db)) return 0;
  return Math.min(1, Math.max(0, (db - minDb) / (maxDb - minDb)));
}

/**
 * Resample a linear spectrum into `count` logarithmically spaced bars between
 * minHz and maxHz. Each bar takes the peak of the bins it covers, so narrow
 * low-frequency bars still pick up the nearest bin.
 */
export function logBars(
  spectrum: ArrayLike<number>,
  sampleRate: number,
  count: number,
  minHz = 30,
  maxHz = 16000,
  out = new Float32Array(count),
): Float32Array {
  const hz = binWidth(spectrum.length, sampleRate);
  const ratio = Math.log(maxHz / minHz);
  for (let b = 0; b < count; b++) {
    const lo = minHz * Math.exp((ratio * b) / count);
    const hi = minHz * Math.exp((ratio * (b + 1)) / count);
    const start = Math.min(spectrum.length - 1, Math.floor(lo / hz));
    const end = Math.min(spectrum.length, Math.max(start + 1, Math.ceil(hi / hz)));
    let peak = 0;
    for (let i = start; i < end; i++) if (spectrum[i] > peak) peak = spectrum[i];
    out[b] = peak;
  }
  return out;
}

/** Asymmetric smoothing: fast attack, slower release. Coefficients are per second. */
export function envelope(prev: number, next: number, dt: number, attack = 30, release = 6): number {
  const rate = next > prev ? attack : release;
  const k = 1 - Math.exp(-rate * dt);
  return prev + (next - prev) * k;
}

/**
 * Energy beat detector: reports a beat when the current energy rises clearly
 * above its recent average, with a minimum gap between beats.
 */
export class BeatDetector {
  private history: number[] = [];
  private lastBeat = -Infinity;

  constructor(
    private readonly size = 43,
    private readonly threshold = 1.4,
    private readonly minGapMs = 250,
    private readonly floor = 0.08,
  ) {}

  update(energy: number, nowMs: number): boolean {
    const h = this.history;
    const avg = h.length ? h.reduce((a, b) => a + b, 0) / h.length : 0;
    h.push(energy);
    if (h.length > this.size) h.shift();

    const ready = h.length >= this.size / 2;
    const beat =
      ready && energy > this.floor && energy > avg * this.threshold && nowMs - this.lastBeat >= this.minGapMs;
    if (beat) this.lastBeat = nowMs;
    return beat;
  }

  reset(): void {
    this.history = [];
    this.lastBeat = -Infinity;
  }
}

/** Positive spectral change between two frames, over bins below maxHz (onset strength). */
export function spectralFlux(spec: ArrayLike<number>, prev: Float32Array, sampleRate: number, maxHz = 8000): number {
  const end = Math.min(spec.length, Math.ceil(maxHz / binWidth(spec.length, sampleRate)));
  let sum = 0;
  for (let i = 0; i < end; i++) {
    const d = spec[i] - prev[i];
    if (d > 0) sum += d;
    prev[i] = spec[i];
  }
  return sum;
}

/**
 * Tempo tracker: finds the periodic beat (autocorrelation of the onset strength)
 * and its phase, then fires beats on that grid instead of on every loud hit.
 * `confident` is false until a clear tempo is found.
 */
export class TempoTracker {
  confident = false;
  /** Beat period in seconds (0 until known). */
  period = 0;

  private readonly step = 0.01;
  private readonly span = 8;
  private readonly frames: { t: number; v: number }[] = [];
  private nextBeat = 0;
  private lastEstimate = -Infinity;

  constructor(
    private readonly minBpm = 75,
    private readonly maxBpm = 190,
    private readonly estimateEvery = 0.5,
  ) {}

  /** nowS in seconds; returns true on the frame a grid beat is crossed. */
  update(onset: number, nowS: number): boolean {
    this.frames.push({ t: nowS, v: onset });
    while (this.frames.length && this.frames[0].t < nowS - this.span) this.frames.shift();
    if (nowS - this.lastEstimate >= this.estimateEvery) {
      this.lastEstimate = nowS;
      this.estimate(nowS);
    }
    if (!this.confident || this.period <= 0) return false;
    if (nowS >= this.nextBeat) {
      while (this.nextBeat <= nowS) this.nextBeat += this.period;
      return true;
    }
    return false;
  }

  reset(): void {
    this.frames.length = 0;
    this.confident = false;
    this.period = 0;
    this.nextBeat = 0;
    this.lastEstimate = -Infinity;
  }

  private estimate(nowS: number): void {
    const first = this.frames[0]?.t ?? nowS;
    if (nowS - first < 3) return;
    const n = Math.floor(this.span / this.step);
    const raw = new Float32Array(n);
    for (const f of this.frames) {
      const i = n - 1 - Math.round((nowS - f.t) / this.step);
      if (i >= 0 && i < n && f.v > raw[i]) raw[i] = f.v;
    }
    // smooth (also bridges frame gaps), then remove the slow-moving mean
    const sm = new Float32Array(n);
    const R = 4;
    for (let i = 0; i < n; i++) {
      let s = 0;
      let w = 0;
      for (let j = -R; j <= R; j++) {
        const k = i + j;
        if (k < 0 || k >= n) continue;
        const g = Math.exp(-(j * j) / 8);
        s += raw[k] * g;
        w += g;
      }
      sm[i] = s / w;
    }
    const mean = sm.reduce((a, b) => a + b, 0) / n;
    for (let i = 0; i < n; i++) sm[i] = Math.max(0, sm[i] - mean);

    const startIdx = Math.max(0, n - Math.round((nowS - first) / this.step));
    const lagMin = Math.floor(60 / this.maxBpm / this.step);
    const lagMax = Math.ceil(60 / this.minBpm / this.step);
    const ac = new Float32Array(lagMax + 2);
    let zero = 0;
    for (let i = startIdx; i < n; i++) zero += sm[i] * sm[i];
    if (zero < 1e-6) {
      this.confident = false;
      return;
    }
    for (let lag = lagMin - 1; lag <= lagMax + 1; lag++) {
      let s = 0;
      for (let i = startIdx + lag; i < n; i++) s += sm[i] * sm[i - lag];
      ac[lag] = s / zero;
    }
    let best = lagMin;
    let bestScore = -1;
    for (let lag = lagMin; lag <= lagMax; lag++) {
      // mild preference for the typical dance tempo range, to avoid half/double tempo
      const oct = Math.log2(60 / (lag * this.step) / 135);
      const score = ac[lag] * Math.exp(-(oct * oct) / 0.8);
      if (score > bestScore && ac[lag] >= ac[lag - 1] && ac[lag] >= ac[lag + 1]) {
        bestScore = score;
        best = lag;
      }
    }
    if (bestScore < 0) {
      this.confident = false;
      return;
    }
    const a = ac[best - 1];
    const b = ac[best];
    const c = ac[best + 1];
    const denom = a - 2 * b + c;
    const frac = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
    const newPeriod = (best + frac) * this.step;
    this.confident = b > 0.12;
    if (!this.confident) return;
    this.period =
      this.period > 0 && Math.abs(newPeriod / this.period - 1) < 0.08 ? this.period * 0.7 + newPeriod * 0.3 : newPeriod;

    // phase: grid offset (back from now) that collects the most onset energy
    const P = this.period;
    let bestPhase = 0;
    let bestSum = -1;
    for (let ph = 0; ph < P; ph += this.step) {
      let s = 0;
      for (let t = ph; t < nowS - first && t < this.span - 0.05; t += P) {
        const i = n - 1 - Math.round(t / this.step);
        if (i >= 0) s += sm[i];
      }
      if (s > bestSum) {
        bestSum = s;
        bestPhase = ph;
      }
    }
    const lastBeat = nowS - bestPhase; // most recent grid beat
    let target = lastBeat + P;
    if (this.nextBeat > 0) {
      // keep continuity: ease towards the new phase along the shortest way round
      let diff = (target - this.nextBeat) % P;
      if (diff > P / 2) diff -= P;
      if (diff < -P / 2) diff += P;
      target = Math.abs(diff) > P * 0.35 ? this.nextBeat + diff : this.nextBeat + diff * 0.4;
    }
    this.nextBeat = target;
  }
}
