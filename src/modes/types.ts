import type { AudioFrame } from '../audio/AudioEngine';

export interface Palette {
  id: string;
  name: string;
  /** Background */
  bg: string;
  /** Primary, secondary and accent colors */
  a: string;
  b: string;
  c: string;
}

export interface View {
  width: number;
  height: number;
  /** Device pixel ratio the canvas is rendered at */
  dpr: number;
  /** Seconds since start */
  time: number;
  /** Seconds since the previous frame */
  dt: number;
  palette: Palette;
  variant: number;
}

interface ModeBase {
  id: string;
  name: string;
  /** Lucide icon name */
  icon: string;
  variants: string[];
}

/** Draws with Canvas 2D; the result is uploaded to the GPU for post effects. */
export interface Mode2D extends ModeBase {
  kind: '2d';
  render(g: CanvasRenderingContext2D, audio: AudioFrame, view: View): void;
  /** Called when the mode becomes active or the canvas is resized */
  reset?(g: CanvasRenderingContext2D, view: View): void;
}

/**
 * Full-screen fragment shader. The renderer prepends `#version 300 es`, precision and the
 * shared uniforms (see SHARED_UNIFORMS in render/shaders.ts); the source must define `main`.
 */
export interface ModeGL extends ModeBase {
  kind: 'gl';
  fragment: string;
}

export type Mode = Mode2D | ModeGL;
