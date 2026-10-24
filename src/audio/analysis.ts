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
