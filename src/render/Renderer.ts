import type { AudioFrame } from '../audio/AudioEngine';
import { hexToRgb } from '../modes/palettes';
import type { Mode, Palette, View } from '../modes/types';
import type { OverlayImage } from '../overlay/image';
import type { Settings } from '../settings';
import { FULLSCREEN_VERT, POST_FRAG, SHARED_UNIFORMS } from './shaders';

/** What to draw this frame. */
export interface Scene {
  mode: Mode;
  variant: number;
  palette: Palette;
  settings: Settings;
  /** Resolved mode settings by uniform name (see ModeParam) */
  params: Record<string, number>;
}

interface Overlay {
  tex: WebGLTexture;
  width: number;
  height: number;
  hasAlpha: boolean;
  present: boolean;
}

const SPECTRUM_SIZE = 512;
/** Cap the render size (about 1440p) so 4K at 2x DPR does not upload huge canvases every frame. */
const MAX_PIXELS = 2560 * 1440;

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
  private srcMipsOn = false;
  /** Finished frames, ping-ponged so the post pass can read the previous one */
  private readonly outTex: WebGLTexture[];
  private readonly outFbo: WebGLFramebuffer[];
  private out = 0;
  private readonly modePrograms = new Map<string, Program>();
  private readonly srcTex: WebGLTexture;
  private readonly fbo: WebGLFramebuffer;
  private readonly specTex: WebGLTexture;
  private readonly specBytes = new Uint8Array(SPECTRUM_SIZE);
  private readonly image: Overlay;
  private readonly text: Overlay;

  private width = 0;
  private height = 0;
  private dpr = 1;
  private lastMode = '';
  private phase = 0;
  private kicks = 0;
  /** Mode time scaled by the mode's uSpeed setting, so changing speed never jumps */
  private clock = 0;
  /** Export size; the canvas is then letterboxed on screen by CSS */
  private fixed: { width: number; height: number } | null = null;

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
    this.image = this.emptyOverlay();
    this.text = this.emptyOverlay();
    this.outTex = [this.texture(gl.LINEAR), this.texture(gl.LINEAR)];
    this.outFbo = [gl.createFramebuffer()!, gl.createFramebuffer()!];
  }

  private emptyOverlay(): Overlay {
    const gl = this.gl;
    const tex = this.texture(gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    gl.generateMipmap(gl.TEXTURE_2D);
    return { tex, width: 1, height: 1, hasAlpha: false, present: false };
  }

  private upload(o: Overlay, source: HTMLCanvasElement | null, hasAlpha: boolean): void {
    o.present = source !== null;
    if (!source) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, o.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    o.width = source.width;
    o.height = source.height;
    o.hasAlpha = hasAlpha;
  }

  setImage(img: OverlayImage | null): void {
    this.upload(this.image, img?.canvas ?? null, img?.hasAlpha ?? false);
  }

  /** White-on-transparent text canvas, or null to hide the text. */
  setText(canvas: HTMLCanvasElement | null): void {
    this.upload(this.text, canvas, true);
  }

  /** Mip level matching how much the overlay is shrunk on screen. */
  private lod(texWidth: number, rect: number[]): number {
    const shownPx = rect[2] * 2 * this.width;
    return Math.max(0, Math.log2(texWidth / Math.max(1, shownPx)));
  }

  /**
   * Overlay boxes as [centerX, centerY, halfW, halfH] in 0..1 screen units (y up), plus the
   * image angle. Contain-fit, so the image keeps its aspect ratio (a square crop for shapes);
   * image above the text when both are shown, text moves up when the image sits at the bottom.
   */
  private overlayRects(fx: Settings, a: AudioFrame, time: number): { image: number[]; text: number[]; angle: number } {
    const W = this.width;
    const H = this.height;
    const size = fx.overlaySize;
    const img = this.image;
    const side = Math.min(img.width, img.height);
    const iw = fx.imageShape > 0 ? side : img.width;
    const ih = fx.imageShape > 0 ? side : img.height;
    const fit = (w: number, h: number, cx: number, cy: number, bw: number, bh: number, boost = 1) => {
      const k = Math.min(bw / w, bh / h);
      return [cx, cy, ((w * k) / 2 / W) * boost, ((h * k) / 2 / H) * boost];
    };

    // Motion on the beat: offset, scale and angle
    const p2 = a.pulse * a.pulse;
    const rnd = (n: number) => {
      const x = Math.sin(this.kicks * 12.9898 + n * 78.233) * 43758.5453;
      return x - Math.floor(x) - 0.5;
    };
    let boost = 1;
    let dx = 0;
    let dy = 0;
    let angle = 0;
    if (fx.imageMotion === 1) boost = 1 + a.bands.bass * 0.06 + a.pulse * 0.04;
    else if (fx.imageMotion === 2) {
      dy = p2 * 0.05;
      boost = 1 + a.pulse * 0.03;
    } else if (fx.imageMotion === 3) {
      angle = time * 0.4 + p2 * 0.3;
      boost = 1 + a.bands.bass * 0.04;
    } else if (fx.imageMotion === 4) {
      dx = rnd(1) * 0.04 * a.pulse;
      dy = rnd(2) * 0.04 * a.pulse;
      angle = rnd(3) * 0.2 * a.pulse;
    }

    const both = img.present && this.text.present;
    let image: number[];
    let textY = both ? 0.17 : 0.5;
    if (fx.imagePos === 3) {
      // Small logo in the bottom-right corner
      const r = fit(iw, ih, 0, 0, W * size * 0.3, H * size * 0.3, boost);
      const m = 0.03;
      image = [1 - r[2] - m * (H / W), r[3] + m, r[2], r[3]];
      if (both) textY = 0.5;
    } else if (fx.imagePos === 1) {
      image = fit(iw, ih, 0.5, both ? 0.68 : 0.7, W * size, H * size * 0.5, boost);
    } else if (fx.imagePos === 2) {
      image = fit(iw, ih, 0.5, 0.3, W * size, H * size * 0.5, boost);
      if (both) textY = 0.8;
    } else {
      image = both ? fit(iw, ih, 0.5, 0.6, W * size, H * size * 0.6, boost) : fit(iw, ih, 0.5, 0.5, W * size, H * size * 0.9, boost);
    }
    image[0] += dx * (H / W);
    image[1] += dy;
    const textH = both && fx.imagePos !== 3 ? 0.2 : 0.4;
    const text = fit(this.text.width, this.text.height, 0.5, textY, W * size * (both ? 0.9 : 0.95), H * size * textH);
    return { image, text, angle };
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

  /** Render at a fixed size (video export) instead of the window size; null goes back. */
  setFixedSize(size: { width: number; height: number } | null): void {
    this.fixed = size;
  }

  /** Match the canvas to its CSS size (or the fixed export size). Returns true when the size changed. */
  resize(): boolean {
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssPixels = this.canvas.clientWidth * this.canvas.clientHeight;
    if (cssPixels * dpr * dpr > MAX_PIXELS) dpr = Math.sqrt(MAX_PIXELS / Math.max(1, cssPixels));
    let w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    let h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.fixed) {
      w = this.fixed.width;
      h = this.fixed.height;
      // 2D modes scale line widths by dpr: keep them as thick as on a 1080p screen
      dpr = Math.max(1, Math.min(w, h) / 1080);
    }
    if (w === this.width && h === this.height && dpr === this.dpr) return false;
    this.width = this.canvas.width = this.g2d.canvas.width = w;
    this.height = this.canvas.height = this.g2d.canvas.height = h;
    this.dpr = dpr;

    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.srcTex, 0);
    for (let i = 0; i < 2; i++) {
      gl.bindTexture(gl.TEXTURE_2D, this.outTex[i]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.outFbo[i]);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.outTex[i], 0);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.lastMode = ''; // forces mode reset
    return true;
  }

  /**
   * Sample srcTex through its mipmaps (for the 2D glow) or only level 0. GL modes draw
   * into level 0 without updating the mips, so they must not sample them.
   */
  private srcMips(on: boolean): void {
    if (on === this.srcMipsOn) return;
    this.srcMipsOn = on;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, on ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  }

  /** Compile a GL mode ahead of time so switching to it does not stutter. */
  prepare(mode: Mode): void {
    if (mode.kind === 'gl' && !this.modePrograms.has(mode.id)) {
      this.modePrograms.set(mode.id, link(this.gl, SHARED_UNIFORMS + mode.fragment));
    }
  }

  render(scene: Scene, audio: AudioFrame, time: number, dt: number): void {
    this.resize();
    const gl = this.gl;
    const { mode, variant, palette, settings: fx } = scene;
    const view: View = { width: this.width, height: this.height, dpr: this.dpr, time, dt, palette, variant };
    const speed = scene.params.uSpeed ?? 1;
    this.phase += dt * speed * (0.25 + audio.bands.bass * 1.6 + audio.pulse * 0.6);
    this.clock += dt * speed;
    if (audio.beat) this.kicks++;

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
      if (mode.glow) gl.generateMipmap(gl.TEXTURE_2D);
      this.srcMips(!!mode.glow);
    } else {
      this.srcMips(false);
      this.renderShader(mode.id, audio, view, scene.params);
    }

    // Post pass into one output texture while reading the other (previous frame)
    const prev = this.out;
    this.out = 1 - this.out;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.outFbo[this.out]);
    gl.viewport(0, 0, this.width, this.height);
    const p = this.post;
    gl.useProgram(p.handle);
    const bind = (unit: number, tex: WebGLTexture, name: string) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(p.loc(name), unit);
    };
    bind(2, this.image.tex, 'uImage');
    bind(3, this.text.tex, 'uText');
    bind(4, this.outTex[prev], 'uPrev');
    bind(0, this.srcTex, 'uSrc'); // last, so unit 0 stays active
    gl.uniform2f(p.loc('uRes'), this.width, this.height);
    gl.uniform1f(p.loc('uTime'), time);
    gl.uniform1f(p.loc('uKick'), this.kicks);
    gl.uniform1f(p.loc('uPulse'), audio.pulse);
    gl.uniform1f(p.loc('uBass'), audio.bands.bass);
    gl.uniform1f(p.loc('uSrcGlow'), mode.kind === '2d' ? (mode.glow ?? 0) : 0);
    gl.uniform3fv(p.loc('uBg'), hexToRgb(palette.bg));
    gl.uniform3fv(p.loc('uA'), hexToRgb(palette.a));
    gl.uniform3fv(p.loc('uB'), hexToRgb(palette.b));
    gl.uniform3fv(p.loc('uC'), hexToRgb(palette.c));
    gl.uniform1f(p.loc('uStrict'), fx.strictPalette ? 1 : 0);
    gl.uniform1f(p.loc('uCrt'), fx.crt ? 1 : 0);
    gl.uniform1f(p.loc('uGrain'), fx.grain ? 1 : 0);
    // Short flash / glitch only on the peak of the beat pulse
    gl.uniform1f(p.loc('uStrobe'), fx.strobe ? Math.max(0, (audio.pulse - 0.6) / 0.4) : 0);
    gl.uniform1f(p.loc('uGlitch'), fx.glitch ? Math.max(0, (audio.pulse - 0.35) / 0.65) : 0);
    gl.uniform1i(p.loc('uFilter'), fx.filter);
    gl.uniform1f(p.loc('uFilterAmt'), Math.min(1, Math.max(0, fx.filterAmount)) * (fx.filterBeat ? 0.7 + 0.6 * audio.pulse : 1));

    const rects = this.overlayRects(fx, audio, time);
    // A mode that builds its motif from the image does not also show the picture itself
    const showImage = this.image.present && !(mode.kind === 'gl' && mode.usesImage);
    gl.uniform1f(p.loc('uHasImage'), showImage ? 1 : 0);
    gl.uniform1f(p.loc('uImageAlpha'), this.image.hasAlpha ? 1 : 0);
    gl.uniform1i(p.loc('uImageStyle'), fx.imageStyle);
    gl.uniform1i(p.loc('uImageShape'), fx.imageShape);
    const side = Math.min(this.image.width, this.image.height);
    gl.uniform2f(p.loc('uImageCrop'), fx.imageShape > 0 ? side / this.image.width : 1, fx.imageShape > 0 ? side / this.image.height : 1);
    gl.uniform1f(p.loc('uImageAngle'), rects.angle);
    gl.uniform1f(p.loc('uImageOpacity'), fx.imageOpacity);
    gl.uniform1f(p.loc('uImageGlow'), fx.imageGlow);
    gl.uniform4fv(p.loc('uImageRect'), rects.image);
    gl.uniform2f(p.loc('uImageTexel'), 1 / this.image.width, 1 / this.image.height);
    gl.uniform1f(p.loc('uImageLod'), this.lod(fx.imageShape > 0 ? side : this.image.width, rects.image));
    gl.uniform1f(p.loc('uTextLod'), this.lod(this.text.width, rects.text));
    gl.uniform1f(p.loc('uHasText'), this.text.present ? 1 : 0);
    gl.uniform4fv(p.loc('uTextRect'), rects.text);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // To the screen; the frame stays in outTex as next frame's uPrev
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.outFbo[this.out]);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    // The browser may give a smaller drawing buffer than asked for; then scale down
    const dw = gl.drawingBufferWidth;
    const dh = gl.drawingBufferHeight;
    const filter = dw === this.width && dh === this.height ? gl.NEAREST : gl.LINEAR;
    gl.blitFramebuffer(0, 0, this.width, this.height, 0, 0, dw, dh, gl.COLOR_BUFFER_BIT, filter);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private renderShader(id: string, a: AudioFrame, v: View, params: Record<string, number>): void {
    const gl = this.gl;
    const p = this.modePrograms.get(id);
    if (!p) throw new Error(`Mode ${id} was not prepared`);

    const step = Math.max(1, Math.floor(a.spectrum.length / SPECTRUM_SIZE));
    for (let i = 0; i < SPECTRUM_SIZE; i++) this.specBytes[i] = (a.spectrum[i * step] ?? 0) * 255;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.specTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SPECTRUM_SIZE, 1, gl.RED, gl.UNSIGNED_BYTE, this.specBytes);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.image.tex);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, v.width, v.height);
    gl.useProgram(p.handle);
    gl.uniform1i(p.loc('uSpectrum'), 1);
    gl.uniform1i(p.loc('uImage'), 2);
    gl.uniform1f(p.loc('uHasImage'), this.image.present ? 1 : 0);
    gl.uniform1f(p.loc('uImageAspect'), this.image.width / this.image.height);
    gl.uniform2f(p.loc('uRes'), v.width, v.height);
    gl.uniform1f(p.loc('uTime'), this.clock);
    gl.uniform1f(p.loc('uPhase'), this.phase);
    for (const [name, value] of Object.entries(params)) gl.uniform1f(p.loc(name), value);
    gl.uniform1f(p.loc('uBass'), a.bands.bass);
    gl.uniform1f(p.loc('uMid'), a.bands.mid);
    gl.uniform1f(p.loc('uTreble'), a.bands.treble);
    gl.uniform1f(p.loc('uLevel'), a.level);
    gl.uniform1f(p.loc('uPulse'), a.pulse);
    gl.uniform1f(p.loc('uKick'), this.kicks);
    gl.uniform1i(p.loc('uVariant'), v.variant);
    gl.uniform3fv(p.loc('uBg'), hexToRgb(v.palette.bg));
    gl.uniform3fv(p.loc('uA'), hexToRgb(v.palette.a));
    gl.uniform3fv(p.loc('uB'), hexToRgb(v.palette.b));
    gl.uniform3fv(p.loc('uC'), hexToRgb(v.palette.c));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
