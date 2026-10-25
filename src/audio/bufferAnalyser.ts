// AnalyserNode stand-in that reads a decoded AudioBuffer at a chosen position, so the
// background export can analyse a track without OfflineAudioContext.suspend (Firefox has none).
// Follows the Web Audio spec: last fftSize samples, Blackman window, magnitude / N,
// time smoothing, then decibels.

export interface AnalyserLike {
  getFloatTimeDomainData(out: Float32Array<ArrayBuffer>): void;
  getFloatFrequencyData(out: Float32Array<ArrayBuffer>): void;
}

export class BufferAnalyser implements AnalyserLike {
  /** End of the analysed window, in samples */
  position = 0;
  private readonly re: Float32Array;
  private readonly im: Float32Array;
  private readonly window: Float32Array;
  private readonly smoothed: Float32Array;
  private readonly samples: Float32Array<ArrayBuffer>;

  constructor(
    /** Mixed with equal weight (one channel for left/right, all for mono) */
    private readonly channels: Float32Array[],
    private readonly gain: number,
    readonly fftSize = 2048,
    private readonly smoothing = 0.3,
  ) {
    const n = fftSize;
    this.re = new Float32Array(n);
    this.im = new Float32Array(n);
    this.samples = new Float32Array(n);
    this.smoothed = new Float32Array(n / 2);
    // Blackman, alpha 0.16
    this.window = new Float32Array(n).map((_, i) => 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / n) + 0.08 * Math.cos((4 * Math.PI * i) / n));
  }

  private read(): Float32Array<ArrayBuffer> {
    const n = this.fftSize;
    const k = this.gain / this.channels.length;
    for (let i = 0; i < n; i++) {
      const j = this.position - n + i;
      let v = 0;
      if (j >= 0) for (const c of this.channels) v += c[j] ?? 0;
      this.samples[i] = v * k;
    }
    return this.samples;
  }

  getFloatTimeDomainData(out: Float32Array<ArrayBuffer>): void {
    out.set(this.read().subarray(0, out.length));
  }

  getFloatFrequencyData(out: Float32Array<ArrayBuffer>): void {
    const n = this.fftSize;
    const x = this.read();
    for (let i = 0; i < n; i++) {
      this.re[i] = x[i] * this.window[i];
      this.im[i] = 0;
    }
    fft(this.re, this.im);
    for (let i = 0; i < n / 2 && i < out.length; i++) {
      const mag = Math.hypot(this.re[i], this.im[i]) / n;
      this.smoothed[i] = this.smoothing * this.smoothed[i] + (1 - this.smoothing) * mag;
      out[i] = 20 * Math.log10(this.smoothed[i] || 1e-12);
    }
  }
}

/** In-place iterative radix-2 FFT; length must be a power of two. */
export function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}
