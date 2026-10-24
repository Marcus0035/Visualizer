import type { AudioFrame } from '../audio/AudioEngine';
import { hexToRgb } from '../modes/palettes';
import type { Mode, View } from '../modes/types';
import { FULLSCREEN_VERT, POST_FRAG, SHARED_UNIFORMS } from './shaders';

export interface Effects {
  crt: boolean;
  grain: boolean;
  strobe: boolean;
}

const SPECTRUM_SIZE = 512;

class Program {
  private readonly locations = new Map<string, WebGLUniformLocation | null>();

  constructor(
    private readonly gl: WebGL2RenderingContext,
    readonly handle: WebGLProgram,
  ) {}

  loc(name: string): WebGLUniformLocation | null {
    let l = this.locations.get(name);
    if (l === undefined) {
      l = this.gl.getUniformLocation(this.handle, name);
      this.locations.set(name, l);
    }
    return l;
  }
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${log}`);
  }
  return shader;
}

function link(gl: WebGL2RenderingContext, fragment: string): Program {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, FULLSCREEN_VERT));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Program link failed: ${gl.getProgramInfoLog(p)}`);
  return new Program(gl, p);
}

/**
 * Draws the active mode into an offscreen texture (Canvas 2D upload or shader into an FBO),
 * then runs the post pass to the screen.
 */
export class Renderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly g2d: CanvasRenderingContext2D;
  private readonly post: Program;
  private readonly modePrograms = new Map<string, Program>();
  private readonly srcTex: WebGLTexture;
  private readonly fbo: WebGLFramebuffer;
  private readonly specTex: WebGLTexture;
  private readonly specBytes = new Uint8Array(SPECTRUM_SIZE);

  private width = 0;
  private height = 0;
  private dpr = 1;
  private lastMode = '';
  private phase = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 není k dispozici');
    this.gl = gl;
    this.g2d = document.createElement('canvas').getContext('2d', { alpha: false })!;
    this.post = link(gl, POST_FRAG);

    gl.bindVertexArray(gl.createVertexArray());
    this.srcTex = this.texture(gl.LINEAR);
    this.fbo = gl.createFramebuffer()!;
    this.specTex = this.texture(gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, SPECTRUM_SIZE, 1, 0, gl.RED, gl.UNSIGNED_BYTE, this.specBytes);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  }

  private texture(filter: number): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  /** Match the canvas to its CSS size. Returns true when the size changed. */
  resize(): boolean {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (w === this.width && h === this.height && dpr === this.dpr) return false;
    this.width = this.canvas.width = this.g2d.canvas.width = w;
    this.height = this.canvas.height = this.g2d.canvas.height = h;
    this.dpr = dpr;

    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.srcTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.lastMode = ''; // forces mode reset
    return true;
  }

  /** Compile a GL mode ahead of time so switching to it does not stutter. */
  prepare(mode: Mode): void {
    if (mode.kind === 'gl' && !this.modePrograms.has(mode.id)) {
      this.modePrograms.set(mode.id, link(this.gl, SHARED_UNIFORMS + mode.fragment));
    }
  }

  render(mode: Mode, audio: AudioFrame, time: number, dt: number, palette: View['palette'], variant: number, fx: Effects): void {
    this.resize();
    const gl = this.gl;
    const view: View = { width: this.width, height: this.height, dpr: this.dpr, time, dt, palette, variant };
    this.phase += dt * (0.25 + audio.bands.bass * 1.6 + audio.pulse * 0.6);

    const modeKey = `${mode.id}:${variant}`;
    if (modeKey !== this.lastMode) {
      if (mode.kind === '2d') mode.reset?.(this.g2d, view);
      this.lastMode = modeKey;
    }

    if (mode.kind === '2d') {
      mode.render(this.g2d, audio, view);
      gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.g2d.canvas);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    } else {
      this.renderShader(mode.id, audio, view);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    const p = this.post;
    gl.useProgram(p.handle);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.uniform1i(p.loc('uSrc'), 0);
    gl.uniform2f(p.loc('uRes'), this.width, this.height);
    gl.uniform1f(p.loc('uTime'), time);
    gl.uniform1f(p.loc('uCrt'), fx.crt ? 1 : 0);
    gl.uniform1f(p.loc('uGrain'), fx.grain ? 1 : 0);
    // Short flash only on the peak of the beat pulse
    gl.uniform1f(p.loc('uStrobe'), fx.strobe ? Math.max(0, (audio.pulse - 0.6) / 0.4) : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private renderShader(id: string, a: AudioFrame, v: View): void {
    const gl = this.gl;
    const p = this.modePrograms.get(id);
    if (!p) throw new Error(`Mode ${id} was not prepared`);

    const step = Math.max(1, Math.floor(a.spectrum.length / SPECTRUM_SIZE));
    for (let i = 0; i < SPECTRUM_SIZE; i++) this.specBytes[i] = (a.spectrum[i * step] ?? 0) * 255;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.specTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SPECTRUM_SIZE, 1, gl.RED, gl.UNSIGNED_BYTE, this.specBytes);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, v.width, v.height);
    gl.useProgram(p.handle);
    gl.uniform1i(p.loc('uSpectrum'), 1);
    gl.uniform2f(p.loc('uRes'), v.width, v.height);
    gl.uniform1f(p.loc('uTime'), v.time);
    gl.uniform1f(p.loc('uPhase'), this.phase);
    gl.uniform1f(p.loc('uBass'), a.bands.bass);
    gl.uniform1f(p.loc('uMid'), a.bands.mid);
    gl.uniform1f(p.loc('uTreble'), a.bands.treble);
    gl.uniform1f(p.loc('uLevel'), a.level);
    gl.uniform1f(p.loc('uPulse'), a.pulse);
    gl.uniform1i(p.loc('uVariant'), v.variant);
    gl.uniform3fv(p.loc('uBg'), hexToRgb(v.palette.bg));
    gl.uniform3fv(p.loc('uA'), hexToRgb(v.palette.a));
    gl.uniform3fv(p.loc('uB'), hexToRgb(v.palette.b));
    gl.uniform3fv(p.loc('uC'), hexToRgb(v.palette.c));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
