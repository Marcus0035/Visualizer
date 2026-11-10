// WebKitGTK's MediaRecorder stamps the WebM tracks from unrelated clocks: the canvas video
// from one that can be an hour in, the audio from another one (its first packets even from
// zero). Players then show a still picture for an hour, or the sound runs off. Both tracks
// begin when the recording does, so this copies the file packet by packet (no re-encoding)
// with every track starting at zero.
import {
  ALL_FORMATS,
  BufferSource,
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  Output,
  WebMOutputFormat,
  type InputAudioTrack,
  type InputVideoTrack,
} from 'mediabunny';

/** A step forward this big between two packets of one track is a clock change, not a gap. */
const CLOCK_JUMP = 10;

/**
 * Per track: how many leading packets to drop (those before a clock jump, a fraction of a
 * second) and the timestamp that becomes zero. Pure, for tests.
 */
export function planRetime(tracks: number[][]): { skip: number[]; base: number[] } {
  const skip = tracks.map((ts) => {
    let from = 0;
    for (let i = 1; i < ts.length; i++) if (ts[i] - ts[i - 1] > CLOCK_JUMP) from = i;
    return from;
  });
  return { skip, base: tracks.map((ts, t) => ts[skip[t]] ?? 0) };
}

type Track = InputVideoTrack | InputAudioTrack;

/** The recording starting at zero; the same bytes back when it already does. */
export async function retimeWebm(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const input = new Input({ source: new BufferSource(data), formats: ALL_FORMATS });
  const tracks = (await input.getTracks()).filter((t): t is Track => !!t.codec && (t.isVideoTrack() || t.isAudioTrack()));
  const stamps: number[][] = [];
  for (const track of tracks) {
    const ts: number[] = [];
    for await (const p of new EncodedPacketSink(track).packets(undefined, undefined, { metadataOnly: true })) ts.push(p.timestamp);
    stamps.push(ts);
  }
  const { skip, base } = planRetime(stamps);
  if (base.every((b) => b < 1) && skip.every((s) => s === 0)) return data;

  const target = new BufferTarget();
  const output = new Output({ format: new WebMOutputFormat(), target });
  const sources = tracks.map((track) => {
    if (track.isVideoTrack()) {
      const s = new EncodedVideoPacketSource(track.codec!);
      output.addVideoTrack(s);
      return s;
    }
    const s = new EncodedAudioPacketSource((track as InputAudioTrack).codec!);
    output.addAudioTrack(s);
    return s;
  });
  await output.start();
  await Promise.all(
    tracks.map(async (track, t) => {
      const source = sources[t];
      const decoderConfig = await track.getDecoderConfig();
      let i = 0;
      let first = true;
      for await (const packet of new EncodedPacketSink(track).packets()) {
        if (i++ < skip[t]) continue;
        const shifted = packet.clone({ timestamp: Math.max(0, packet.timestamp - base[t]) });
        const meta = first && decoderConfig ? { decoderConfig } : undefined;
        first = false;
        if (source instanceof EncodedVideoPacketSource) await source.add(shifted, meta as EncodedVideoChunkMetadata | undefined);
        else await source.add(shifted, meta as EncodedAudioChunkMetadata | undefined);
      }
      source.close();
    }),
  );
  await output.finalize();
  return new Uint8Array(target.buffer!);
}
