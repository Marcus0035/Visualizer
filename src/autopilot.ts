import type { Mode, ModeParam, Palette } from './modes/types';
import type { Settings } from './settings';

type Rnd = () => number;

/** Choices for the number of kicks between jumps */
export const AUTO_EVERY = [1, 2, 4, 8, 16, 32];

/** Random item other than `current` (or `current` itself when there is nothing else). */
export function pickOther<T>(items: readonly T[], current: T, rnd: Rnd): T {
  const others = items.filter((x) => x !== current);
  return others.length ? others[Math.floor(rnd() * others.length)] : current;
}

/**
 * Random value for one mode setting. Sliders stay near the default (within 70 % of
 * the range on each side, clamped) so a jump never lands on an unusable extreme.
 */
export function randomParam(p: ModeParam, rnd: Rnd): number {
  if (p.options) return p.options[Math.floor(rnd() * p.options.length)].value;
  const min = p.min ?? 0;
  const max = p.max ?? 1;
  const step = p.step ?? 0.01;
  const v = p.default + (rnd() * 2 - 1) * (max - min) * 0.35;
  const snapped = min + Math.round((v - min) / step) * step;
  return Math.min(max, Math.max(min, Number(snapped.toFixed(6))));
}

export interface AutoContext {
  modes: readonly Mode[];
  palettes: readonly Palette[];
  filterCount: number;
}

/** One autopilot jump: changes the parts of `s` the user allowed. */
export function autoStep(s: Settings, ctx: AutoContext, rnd: Rnd = Math.random): void {
  if (s.autoMode) {
    const pool = ctx.modes.filter((m) => !s.autoSkip.includes(m.id)).map((m) => m.id);
    if (pool.length) s.mode = pickOther(pool, s.mode, rnd);
  }
  const mode = ctx.modes.find((m) => m.id === s.mode);
  if (mode && s.autoVariant) {
    const indices = mode.variants.map((_, i) => i);
    s.variants[mode.id] = pickOther(indices, s.variants[mode.id] ?? 0, rnd);
  }
  if (mode?.params && s.autoParams) {
    s.params[mode.id] = Object.fromEntries(mode.params.map((p) => [p.id, randomParam(p, rnd)]));
  }
  if (s.autoPalette) {
    const ids = ctx.palettes.filter((p) => p.dark).map((p) => p.id);
    s.palette = pickOther(ids, s.palette, rnd);
  }
  if (s.autoFilter) {
    // Every other jump on average goes back to a clean picture
    const filters = Array.from({ length: ctx.filterCount - 1 }, (_, i) => i + 1);
    s.filter = s.filter !== 0 && rnd() < 0.5 ? 0 : pickOther(filters, s.filter, rnd);
  }
}

/** Counts kicks (and, without a beat, seconds of sound) until the next jump. */
export class AutoClock {
  private kicks = 0;
  private seconds = 0;

  reset(): void {
    this.kicks = 0;
    this.seconds = 0;
  }

  /** True when it is time to jump; `every` is the number of kicks between jumps. */
  tick(beat: boolean, level: number, dt: number, every: number): boolean {
    if (level > 0.02) this.seconds += dt;
    if (beat) this.kicks++;
    // Jump on a kick; if the beat detector misses kicks, the time (about 0.75 s per
    // kick) takes over: first waiting for any kick, then without one
    const due = this.kicks >= every || (beat && this.seconds >= every * 0.75) || this.seconds >= every * 1.2;
    if (due) this.reset();
    return due;
  }
}
