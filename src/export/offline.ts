// Background video export of a loaded track: the decoded audio is analysed frame by frame,
// each frame is drawn by a second renderer on its own canvas and encoded with WebCodecs,
// faster than real time (depending on the GPU).
import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
} from 'mediabunny';
import { FrameAnalyzer, type AudioFrame } from '../audio/AudioEngine';
import { BufferAnalyser } from '../audio/bufferAnalyser';
import { Renderer, type Scene } from '../render/Renderer';
import { EXPORT_SIZES, type ExportFormat } from './recorder';

export const OFFLINE_FPS = 30;

export interface OfflineOptions {
  buffer: AudioBuffer;
  format: ExportFormat;
  sensitivity: number;
  /** Prepares the second renderer (modes, image, text) */
  setup(renderer: Renderer): void;
  /** Scene for one frame; may change its own copy of the settings (autopilot) */
  scene(frame: AudioFrame, time: number, dt: number): Scene;
  onProgress(fraction: number): void;
  signal: AbortSignal;
}

export function offlineSupported(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined';
}

/** Resolves with the MP4, or null when cancelled. */
export async function renderOffline(o: OfflineOptions): Promise<Blob | null> {
  const { buffer, format } = o;
  const size = EXPORT_SIZES[format];
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const renderer = new Renderer(canvas);
  renderer.setFixedSize(size);
  o.setup(renderer);
  try {
    const videoCodec = await getFirstEncodableVideoCodec(['avc', 'hevc', 'vp9', 'av1'], { ...size, quality: QUALITY_HIGH });
    const audioCodec = await getFirstEncodableAudioCodec(['aac', 'opus'], {
      numberOfChannels: buffer.numberOfChannels,
      sampleRate: buffer.sampleRate,
      quality: QUALITY_HIGH,
    });
    if (!videoCodec || !audioCodec) throw new Error('this browser cannot encode video');

    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
    const video = new CanvasSource(canvas, { codec: videoCodec, quality: QUALITY_HIGH });
    const audio = new AudioBufferSource({ codec: audioCodec, quality: QUALITY_HIGH });
    output.addVideoTrack(video, { frameRate: OFFLINE_FPS });
    output.addAudioTrack(audio);
    await output.start();
    // Whole audio first: it encodes quickly and the muxer then never waits for it
    await audio.add(buffer);

    // Analysis straight from the decoded samples, same settings as the live analysers
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
    const mono = new BufferAnalyser(channels, o.sensitivity);
    const left = new BufferAnalyser([channels[0]], o.sensitivity);
    const right = new BufferAnalyser([channels[1] ?? channels[0]], o.sensitivity);
    const analyzer = new FrameAnalyzer(buffer.sampleRate);
    const dt = 1 / OFFLINE_FPS;
    const frames = Math.floor(buffer.duration * OFFLINE_FPS);

    try {
      for (let i = 0; i < frames && !o.signal.aborted; i++) {
        // Audio up to the end of this frame, like the analysers see it live
        const end = Math.min(buffer.length, Math.round((i + 1) * dt * buffer.sampleRate));
        mono.position = left.position = right.position = end;
        const frame = analyzer.update(mono, left, right, dt, (i + 1) * dt * 1000);
        renderer.render(o.scene(frame, i * dt, dt), frame, i * dt, dt);
        await video.add(i * dt, dt);
        if (i % 15 === 0) {
          o.onProgress(i / frames);
          // Let the page breathe: the live view keeps running meanwhile
          await new Promise((r) => setTimeout(r, 0));
        }
      }
    } catch (err) {
      await output.cancel();
      throw err;
    }

    if (o.signal.aborted) {
      await output.cancel();
      return null;
    }
    await output.finalize();
    o.onProgress(1);
    return new Blob([target.buffer!], { type: 'video/mp4' });
  } finally {
    renderer.dispose();
  }
}
