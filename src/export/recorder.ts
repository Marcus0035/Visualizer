// Video export: the stage canvas plus the source audio through MediaRecorder.

export type ExportFormat = 'pc' | 'phone';

export const EXPORT_SIZES: Record<ExportFormat, { width: number; height: number }> = {
  pc: { width: 1920, height: 1080 },
  phone: { width: 1080, height: 1920 },
};

const BITRATES: Record<ExportFormat, number> = { pc: 16_000_000, phone: 12_000_000 };

/** MP4 first (plays everywhere, phones and social apps take it), WebM where MP4 recording is missing. */
const TYPES = [
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

export function pickType(isSupported: (type: string) => boolean): string | null {
  return TYPES.find(isSupported) ?? null;
}

/** visualizer-pc-2026-10-25-0945.mp4 */
export function exportFileName(type: string, format: ExportFormat, date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  return `visualizer-${format}-${stamp}.${type.startsWith('video/mp4') ? 'mp4' : 'webm'}`;
}

export class VideoRecorder {
  private readonly rec: MediaRecorder;
  private readonly chunks: Blob[] = [];
  private readonly video: MediaStream;
  readonly startedAt = performance.now();

  constructor(
    canvas: HTMLCanvasElement,
    audio: MediaStream,
    readonly type: string,
    readonly format: ExportFormat,
  ) {
    this.video = canvas.captureStream(60);
    const stream = new MediaStream([...this.video.getVideoTracks(), ...audio.getAudioTracks()]);
    this.rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: BITRATES[format], audioBitsPerSecond: 256_000 });
    this.rec.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    // Chunks every second, so a long recording does not sit in one huge buffer
    this.rec.start(1000);
  }

  get seconds(): number {
    return (performance.now() - this.startedAt) / 1000;
  }

  stop(): Promise<Blob> {
    return new Promise((resolve) => {
      this.rec.onstop = () => {
        // Only the canvas track is ours; the audio track belongs to the engine and stays alive
        this.video.getTracks().forEach((t) => t.stop());
        resolve(new Blob(this.chunks, { type: this.type.split(';')[0] }));
      };
      this.rec.stop();
    });
  }
}

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
