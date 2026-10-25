import type { AnalyserLike } from './bufferAnalyser';
import { BeatDetector, TempoTracker, spectralFlux, KICK_RANGE, bandEnergy, type Bands, computeBands, envelope, normalizeDb, rms } from './analysis';
import { renderDemoLoop } from './demo';

export type SourceKind = 'demo' | 'input' | 'file' | 'tab';

/** Everything a mode needs from the audio for one frame. Arrays are reused between frames. */
export interface AudioFrame {
  /** Mono waveform, -1..1 */
  wave: Float32Array<ArrayBuffer>;
  waveL: Float32Array<ArrayBuffer>;
  waveR: Float32Array<ArrayBuffer>;
  /** Linear-frequency spectrum, 0..1 per bin (0..Nyquist) */
  spectrum: Float32Array<ArrayBuffer>;
  sampleRate: number;
  /** Smoothed band energies, 0..1 */
  bands: Bands;
  /** Smoothed RMS level, roughly 0..1 */
  level: number;
  /** True only on the frame a beat was detected */
  beat: boolean;
  /** 1 on a beat, decays to 0 */
  pulse: number;
}

interface Attachment {
  stream?: MediaStream;
  media?: HTMLAudioElement;
}

const FFT_SIZE = 2048;
const MIN_DB = -90;
const MAX_DB = -10;

/** Analyser setup shared by the live engine and the offline export */
export function setupAnalysers(...analysers: AnalyserNode[]): void {
  for (const a of analysers) {
    a.fftSize = FFT_SIZE;
    a.smoothingTimeConstant = 0.3;
    a.minDecibels = MIN_DB;
    a.maxDecibels = MAX_DB;
  }
}

/** Turns analyser readings into AudioFrames: bands, level, beats (tempo grid with kick fallback). */
export class FrameAnalyzer {
  readonly frame: AudioFrame;
  private readonly beats = new BeatDetector();
  private readonly tempo = new TempoTracker();
  private readonly prevSpec = new Float32Array(FFT_SIZE / 2);
  private readonly dbBuf = new Float32Array(FFT_SIZE / 2);

  constructor(sampleRate: number) {
    this.frame = {
      wave: new Float32Array(FFT_SIZE),
      waveL: new Float32Array(FFT_SIZE),
      waveR: new Float32Array(FFT_SIZE),
      spectrum: new Float32Array(FFT_SIZE / 2),
      sampleRate,
      bands: { bass: 0, mid: 0, treble: 0 },
      level: 0,
      beat: false,
      pulse: 0,
    };
  }

  reset(): void {
    this.beats.reset();
    this.tempo.reset();
    this.prevSpec.fill(0);
  }

  update(mono: AnalyserLike, left: AnalyserLike, right: AnalyserLike, dt: number, nowMs: number): AudioFrame {
    const f = this.frame;
    mono.getFloatTimeDomainData(f.wave);
    left.getFloatTimeDomainData(f.waveL);
    right.getFloatTimeDomainData(f.waveR);
    mono.getFloatFrequencyData(this.dbBuf);
    for (let i = 0; i < this.dbBuf.length; i++) f.spectrum[i] = normalizeDb(this.dbBuf[i], MIN_DB, MAX_DB);

    const raw = computeBands(f.spectrum, f.sampleRate);
    f.bands.bass = envelope(f.bands.bass, raw.bass, dt);
    f.bands.mid = envelope(f.bands.mid, raw.mid, dt);
    f.bands.treble = envelope(f.bands.treble, raw.treble, dt);
    f.level = envelope(f.level, Math.min(1, rms(f.wave) * 2.5), dt);

    const onset = this.beats.update(bandEnergy(f.spectrum, f.sampleRate, ...KICK_RANGE), nowMs);
    const gridBeat = this.tempo.update(spectralFlux(f.spectrum, this.prevSpec, f.sampleRate), nowMs / 1000);
    f.beat = this.tempo.confident ? gridBeat : onset;
    f.pulse = f.beat ? 1 : f.pulse * Math.exp(-dt * 6);
    return f;
  }
}

export class AudioEngine {
  readonly ctx = new AudioContext();
  readonly frame: AudioFrame;
  /** Called when the source changes on its own (track ended, media paused/resumed). */
  onchange: () => void = () => {};

  private readonly input = this.ctx.createGain(); // sensitivity, feeds analysis only
  private readonly monitor = this.ctx.createGain(); // what reaches the speakers
  private readonly tap = this.ctx.createGain(); // full-volume mix for video export
  private recordDest: MediaStreamAudioDestinationNode | null = null;
  private readonly mono = this.ctx.createAnalyser();
  private readonly left = this.ctx.createAnalyser();
  private readonly right = this.ctx.createAnalyser();
  private readonly analyzer = new FrameAnalyzer(this.ctx.sampleRate);

  private source: AudioNode | null = null;
  private stream: MediaStream | null = null;
  private media: HTMLAudioElement | null = null;
  private demoBuffer: AudioBuffer | null = null;
  /** Bumped by every source request; a request that finishes after a newer one gives up. */
  private generation = 0;

  kind: SourceKind | null = null;
  /** Name shown in the UI (file name, device label) */
  label = '';

  constructor() {
    setupAnalysers(this.mono, this.left, this.right);
    const splitter = this.ctx.createChannelSplitter(2);
    this.input.connect(this.mono);
    this.input.connect(splitter);
    splitter.connect(this.left, 0);
    splitter.connect(this.right, 1);
    this.monitor.connect(this.ctx.destination);

    this.frame = this.analyzer.frame;
  }

  set sensitivity(value: number) {
    this.input.gain.value = value;
  }

  set volume(value: number) {
    this.monitor.gain.value = value;
  }

  async resume(): Promise<void> {
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  async useDemo(): Promise<void> {
    const gen = ++this.generation;
    await this.resume();
    if (gen !== this.generation) return;
    this.demoBuffer ??= renderDemoLoop(this.ctx);
    const node = this.ctx.createBufferSource();
    node.buffer = this.demoBuffer;
    node.loop = true;
    this.attach(node, 'demo', 'Demo loop', true);
    node.start();
  }

  /**
   * Microphone, line-in or a PipeWire/Pulse monitor source (system output).
   * Falls back to the default input when the saved device is gone.
   * Returns the id of the device actually used ('' when superseded).
   */
  async useInput(deviceId?: string): Promise<string> {
    const gen = ++this.generation;
    await this.resume();
    const open = (id?: string) =>
      navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: id ? { exact: id } : undefined,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    let stream: MediaStream;
    try {
      stream = await open(deviceId);
    } catch (err) {
      const name = (err as DOMException).name;
      if (!deviceId || (name !== 'OverconstrainedError' && name !== 'NotFoundError')) throw err;
      stream = await open();
    }
    if (gen !== this.generation) {
      stream.getTracks().forEach((t) => t.stop());
      return '';
    }
    const track = stream.getAudioTracks()[0];
    this.attach(this.ctx.createMediaStreamSource(stream), 'input', track?.label || 'Input', false, { stream });
    return track?.getSettings().deviceId ?? '';
  }

  /** Audio shared from a browser tab or screen (Chromium: tab audio). */
  async useTab(): Promise<void> {
    const gen = ++this.generation;
    await this.resume();
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    if (gen !== this.generation || stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach((t) => t.stop());
      if (gen !== this.generation) return;
      throw new Error('The share has no audio. Turn on audio sharing when picking.');
    }
    // Only the audio is needed
    stream.getVideoTracks().forEach((t) => t.stop());
    this.attach(this.ctx.createMediaStreamSource(stream), 'tab', 'Shared audio', false, { stream });
  }

  async useFile(file: File): Promise<void> {
    const gen = ++this.generation;
    await this.resume();
    const el = new Audio();
    el.src = URL.createObjectURL(file);
    el.loop = true;
    const discard = () => {
      URL.revokeObjectURL(el.src);
      el.removeAttribute('src');
    };
    // Make sure it decodes before tearing down the current source
    const ok = await new Promise<boolean>((resolve) => {
      el.addEventListener('canplay', () => resolve(true), { once: true });
      el.addEventListener('error', () => resolve(false), { once: true });
    });
    if (gen !== this.generation) return discard();
    if (!ok) {
      discard();
      throw new Error('unsupported format');
    }
    this.attach(this.ctx.createMediaElementSource(el), 'file', file.name, true, { media: el });
    el.addEventListener('play', () => this.onchange());
    el.addEventListener('pause', () => this.onchange());
    try {
      await el.play();
    } catch (err) {
      // Switched to another source while starting playback
      if ((err as DOMException).name !== 'AbortError') throw err;
    }
  }

  /** Position in the file source, seconds (0 for other sources) */
  get currentTime(): number {
    return this.media?.currentTime ?? 0;
  }

  get playing(): boolean {
    return this.media ? !this.media.paused : this.kind !== null;
  }

  /** Play/pause for file sources. */
  togglePlay(): void {
    if (!this.media) return;
    if (this.media.paused) this.media.play().catch(() => this.onchange());
    else this.media.pause();
  }

  /** Audio of the current source at full volume (independent of the speaker volume), for video export. */
  recordStream(): MediaStream {
    if (!this.recordDest) {
      this.recordDest = this.ctx.createMediaStreamDestination();
      this.tap.connect(this.recordDest);
    }
    return this.recordDest.stream;
  }

  /** File source: play once from the start, without looping. Returns the element, or null for other sources. */
  playFromStart(): HTMLAudioElement | null {
    const m = this.media;
    if (!m) return null;
    m.loop = false;
    m.currentTime = 0;
    m.play().catch(() => this.onchange());
    return m;
  }

  /** Back to looping after playFromStart; a track that already ended starts again. */
  restoreLoop(): void {
    const m = this.media;
    if (!m) return;
    m.loop = true;
    if (m.ended) m.play().catch(() => this.onchange());
  }

  /** Labelled audio inputs; labels are empty until the user grants mic permission once. */
  async listInputs(): Promise<MediaDeviceInfo[]> {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'audioinput');
  }

  /** Read the analysers and update `frame`. Call once per animation frame. */
  update(dt: number, nowMs: number): AudioFrame {
    return this.analyzer.update(this.mono, this.left, this.right, dt, nowMs);
  }

  private attach(node: AudioNode, kind: SourceKind, label: string, audible: boolean, extra: Attachment = {}): void {
    this.detach();
    node.connect(this.input);
    node.connect(this.tap);
    if (audible) node.connect(this.monitor);
    this.source = node;
    this.kind = kind;
    this.label = label;
    this.stream = extra.stream ?? null;
    this.media = extra.media ?? null;
    this.analyzer.reset();

    // Stopped sharing or unplugged device: drop the dead source
    const stream = this.stream;
    stream?.getAudioTracks().forEach((t) =>
      t.addEventListener('ended', () => {
        if (this.stream !== stream) return;
        this.detach();
        this.onchange();
      }),
    );
  }

  private detach(): void {
    if (this.source instanceof AudioBufferSourceNode) this.source.stop();
    this.source?.disconnect();
    this.source = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.media) {
      const media = this.media;
      this.media = null; // before pause(), so its 'pause' event sees the new state
      media.pause();
      URL.revokeObjectURL(media.src);
      media.removeAttribute('src');
      media.load();
    }
    this.kind = null;
    this.label = '';
  }
}
