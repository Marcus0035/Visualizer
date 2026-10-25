import type { ModeGL } from './types';

/**
 * Motifs built from the user image: its colors and shapes drive contour lines,
 * a kaleidoscope and dots, without showing the picture itself. Without an image a
 * noise field in palette colors stands in for it.
 */
export const motif: ModeGL = {
  kind: 'gl',
  id: 'motif',
  name: 'Image motif',
  icon: 'Sparkles',
  variants: ['Contours', 'Kaleidoscope', 'Dots'],
  usesImage: true,
  params: [
    { id: 'uSpeed', label: 'Speed', default: 1, min: 0.25, max: 3, step: 0.05 },
    { id: 'uDensity', label: 'Density', default: 1, min: 0.5, max: 2, step: 0.05 },
    { id: 'uImageMix', label: 'Image colors', default: 1, min: 0, max: 1, step: 0.05 },
    { id: 'uFlash', label: 'Flash on beat', default: 0.5, min: 0, max: 1, step: 0.05 },
  ],
  // uSpeed is applied by the renderer to uTime and uPhase
  fragment: /* glsl */ `
uniform float uDensity;
uniform float uImageMix;
uniform float uFlash;

float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 h22(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 7.1; a *= 0.5; }
  return v;
}

vec3 pal(float t) {
  t = clamp(t, 0.0, 1.0);
  return t < 0.5 ? mix(uBg, uA, t * 2.0) : mix(uA, uC, t * 2.0 - 1.0);
}

// Screen point (y in -0.5..0.5) -> image uv, cover fit so the image fills the screen
vec2 toImage(vec2 p) {
  float height = max(1.0, uRes.x / uRes.y / uImageAspect);
  return p / (height * vec2(uImageAspect, 1.0)) + 0.5;
}

// Image color at a screen point; blur via mip level. Transparent parts turn into background.
vec3 source(vec2 p, float lod) {
  if (uHasImage < 0.5) return pal(fbm(p * 2.5 + uTime * 0.05) * 1.2);
  // Slow drift and breathing, so the motif never sits still like a photo
  p = rot(0.15 * sin(uTime * 0.03)) * p * (0.9 + 0.08 * sin(uTime * 0.05)) + 0.04 * vec2(sin(uTime * 0.04), cos(uTime * 0.035));
  vec4 s = textureLod(uImage, clamp(toImage(p), 0.0, 1.0), lod);
  vec3 rgb = s.rgb / max(s.a, 1e-4);
  return mix(uBg, rgb, s.a);
}

// Image color pushed towards the palette by brightness (uImageMix = 1 keeps the image colors)
vec3 tone(vec3 c) {
  float l = luma(c);
  vec3 vivid = mix(vec3(l), c, 1.35);
  return mix(pal(l * 1.1), clamp(vivid, 0.0, 1.0), uImageMix);
}

float beatFlash() { return uPulse * uPulse * uFlash * 2.0; }

// Contour lines over the blurred image brightness, flowing outward with the music
vec3 contours(vec2 p) {
  float hgt = luma(source(p, 4.5)) + 0.15 * fbm(p * 3.0 + uTime * 0.1);
  float levels = 14.0 * uDensity;
  float f = fract(hgt * levels - uPhase * 0.35);
  float w = 0.06 + 0.12 * uBass;
  float line = smoothstep(w, 0.0, min(f, 1.0 - f));
  vec3 c = tone(source(p, 2.0));
  vec3 col = uBg + c * 0.06;
  col += c * line * (0.8 + beatFlash());
  float band = floor(hgt * levels - uPhase * 0.35);
  col += uC * line * step(0.9, h2(vec2(band, floor(uKick)))) * uPulse;
  return col;
}

// Kaleidoscope folding of the image, turning and zooming with the beat
vec3 kaleido(vec2 p) {
  float seg = floor(4.0 + 4.0 * uDensity);
  float r = length(p);
  float a = atan(p.y, p.x) + uPhase * 0.15;
  float s = 6.2831 / seg;
  a = mod(a, s);
  a = abs(a - s * 0.5);
  float zoom = 1.4 - 0.15 * uPulse * uFlash;
  vec2 q = vec2(cos(a), sin(a)) * r * zoom;
  // Wander over the whole image so all its colors come through
  q = rot(uTime * 0.05) * q + vec2(0.35 * sin(uTime * 0.07), 0.25 * cos(uTime * 0.05));
  vec3 col = tone(source(q, 1.0));
  float ring = sin(r * 30.0 * uDensity - uPhase * 3.0);
  col *= 0.85 + 0.15 * ring + beatFlash() * smoothstep(0.6, 1.0, ring);
  return col * smoothstep(1.1, 0.2, r);
}

// Halftone dots: size by image brightness, columns bounce with their part of the spectrum
vec3 dots(vec2 p) {
  float n = 34.0 * uDensity;
  vec2 g = p * n;
  vec2 cell = floor(g) + 0.5;
  vec2 c = cell / n;
  vec3 img = source(c, 3.0);
  float x = clamp(c.x / (uRes.x / uRes.y) + 0.5, 0.0, 1.0);
  float spec = texture(uSpectrum, vec2(pow(x, 2.0) * 0.6 + 0.01, 0.5)).r;
  float r = 0.12 + 0.36 * luma(img) + 0.18 * spec + 0.1 * beatFlash() * h2(cell);
  float d = length(g - cell);
  float dotMask = smoothstep(r, r - 0.08, d);
  vec3 col = tone(img) * (0.7 + 0.6 * spec);
  return mix(uBg, col, dotMask);
}

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec3 col = uVariant == 0 ? contours(p) : uVariant == 1 ? kaleido(p) : dots(p);
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`,
};
