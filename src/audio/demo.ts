// Procedural demo loop so the visualizer has something to react to without a mic or file.
// 4 bars at 120 BPM: kick, off-beat hats, a bass line and a slow stereo pad.

const BPM = 120;
const BARS = 4;

const midiHz = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

// One root per bar (A minor - F - C - G), bass notes as MIDI numbers
const ROOTS = [45, 41, 48, 43];
const CHORDS = [
  [57, 60, 64],
  [53, 57, 60],
  [55, 60, 64],
  [55, 59, 62],
];

export function renderDemoLoop(ctx: BaseAudioContext): AudioBuffer {
  const sr = ctx.sampleRate;
  const beat = 60 / BPM;
  const seconds = beat * 4 * BARS;
  const length = Math.round(seconds * sr);
  const buffer = ctx.createBuffer(2, length, sr);
  const L = buffer.getChannelData(0);
  const R = buffer.getChannelData(1);

  let seed = 1;
  const noise = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed / 2147483647) * 2 - 1;
  };

  let bassLp = 0;
  let prevNoise = 0;

  for (let i = 0; i < length; i++) {
    const t = i / sr;
    const beatPos = t / beat;
    const inBeat = (beatPos % 1) * beat; // seconds since last beat
    const bar = Math.floor(beatPos / 4) % BARS;

    // Kick: pitch sweep 150 -> 45 Hz with fast decay
    const kickPhase = 2 * Math.PI * (45 * inBeat + (105 / 30) * (1 - Math.exp(-inBeat * 30)));
    const kick = Math.sin(kickPhase) * Math.exp(-inBeat * 7) * 0.9;

    // Hats on the off-beat: differentiated noise ~ high-passed
    const offset = ((beatPos + 0.5) % 1) * beat;
    const n = noise();
    const hat = (n - prevNoise) * 0.5 * Math.exp(-offset * 40) * 0.2;
    prevNoise = n;

    // Bass: eighth-note saw on the bar root, one-pole low-passed
    const eighth = (beatPos * 2) % 1;
    const bf = midiHz(ROOTS[bar] + (Math.floor(beatPos * 2) % 4 === 3 ? 12 : 0));
    const saw = ((t * bf) % 1) * 2 - 1;
    bassLp += (saw - bassLp) * 0.05;
    const bass = bassLp * Math.exp(-eighth * 3) * 0.5;

    // Pad: detuned sines per ear, slow swell
    const swell = 0.5 + 0.5 * Math.sin(2 * Math.PI * t * 0.25);
    let padL = 0;
    let padR = 0;
    for (const note of CHORDS[bar]) {
      const f = midiHz(note);
      padL += Math.sin(2 * Math.PI * f * 0.997 * t);
      padR += Math.sin(2 * Math.PI * f * 1.003 * t);
    }
    const pad = 0.06 * (0.4 + 0.6 * swell);

    L[i] = Math.tanh(kick + hat * 0.8 + bass + padL * pad);
    R[i] = Math.tanh(kick + hat * 1.2 + bass + padR * pad);
  }

  return buffer;
}
