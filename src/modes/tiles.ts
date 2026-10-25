import type { ModeGL } from './types';

/**
 * The user image repeated over the whole background: a scrolling grid, a wall of rows
 * sliding against each other, a tunnel and an endless zoom. Without an image a simple
 * palette shape stands in. The image overlay stays on top, so it reads as a backdrop.
 */
export const tiles: ModeGL = {
  kind: 'gl',
  id: 'tiles',
  name: 'Image tiles',
  icon: 'LayoutGrid',
  variants: ['Grid', 'Wall', 'Tunnel', 'Zoom'],
  params: [
    { id: 'uSpeed', label: 'Speed', default: 1, min: 0.25, max: 3, step: 0.05 },
    { id: 'uRows', label: 'Tiles', default: 4, min: 2, max: 10, step: 1 },
    { id: 'uImageMix', label: 'Image colors', default: 1, min: 0, max: 1, step: 0.05 },
    { id: 'uDim', label: 'Brightness', default: 0.6, min: 0.1, max: 1, step: 0.05 },
    { id: 'uFlash', label: 'Flash on beat', default: 0.5, min: 0, max: 1, step: 0.05 },
  ],
  // uSpeed is applied by the renderer to uTime and uPhase
  fragment: /* glsl */ `
uniform float uRows;
uniform float uImageMix;
uniform float uDim;
uniform float uFlash;

float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

vec3 pal(float t) {
  t = clamp(t, 0.0, 1.0);
  return t < 0.5 ? mix(uBg, uA, t * 2.0) : mix(uA, uC, t * 2.0 - 1.0);
}

// Image color pushed towards the palette by brightness (uImageMix = 1 keeps the image colors)
vec3 tone(vec3 c) {
  return mix(pal(luma(c) * 1.1), c, uImageMix);
}

// One tile: f is 0..1 inside the cell, lod the mip level for the tile size. Returns color + coverage.
vec4 tile(vec2 f, float lod) {
  vec2 t = (f - 0.5) / 0.86 + 0.5; // small gap between tiles
  if (t.x < 0.0 || t.x > 1.0 || t.y < 0.0 || t.y > 1.0) return vec4(0.0);
  if (uHasImage < 0.5) {
    // Stand-in: a palette diamond
    float d = abs(t.x - 0.5) + abs(t.y - 0.5);
    float a = smoothstep(0.42, 0.38, d);
    return vec4(pal(0.75 - d), a);
  }
  vec4 s = textureLod(uImage, t, lod);
  vec3 rgb = s.rgb / max(s.a, 1e-4);
  return vec4(tone(rgb), s.a);
}

// Mip level so a tile of cellPx screen pixels is not aliased
float tileLod(float cellPx) {
  float texH = float(textureSize(uImage, 0).y);
  return max(0.0, log2(texH / max(cellPx, 1.0)));
}

vec3 shade(vec4 c, vec2 id, float k) {
  // A few tiles light up on every beat
  float lit = step(0.75, h2(id + k * 0.173)) * uPulse * uPulse * uFlash * 2.0;
  vec3 col = mix(uBg, c.rgb * uDim * (1.0 + lit), c.a);
  return col;
}

// Cells as wide as the image, so tiles keep its aspect ratio
vec2 cells(vec2 p, float rows) {
  return p * rows / vec2(max(uImageAspect, 0.2), 1.0);
}

vec3 grid(vec2 p) {
  float rows = uRows;
  vec2 q = cells(p, rows) + vec2(uPhase * 0.35, uPhase * 0.2);
  vec2 id = floor(q);
  vec2 f = fract(q);
  // Every other tile mirrored, so the pattern looks woven
  if (mod(id.x + id.y, 2.0) > 0.5) f.x = 1.0 - f.x;
  float k = floor(uKick);
  // Tiles hit by the beat swell a little
  float hit = step(0.75, h2(id + k * 0.173)) * uPulse * uFlash;
  f = (f - 0.5) / (1.0 + hit * 0.25) + 0.5;
  return shade(tile(f, tileLod(uRes.y / rows)), id, k);
}

vec3 wall(vec2 p) {
  float rows = uRows;
  vec2 q = cells(p, rows);
  float row = floor(q.y);
  // Rows slide in opposite directions, bricks offset by half a tile
  float dir = mod(row, 2.0) < 0.5 ? 1.0 : -1.0;
  q.x += dir * uPhase * 0.5 + 0.5 * mod(row, 2.0);
  vec2 id = floor(q);
  return shade(tile(fract(q), tileLod(uRes.y / rows)), id, floor(uKick));
}

vec3 tunnel(vec2 p) {
  float r = max(length(p), 1e-3);
  float a = atan(p.y, p.x) / 6.2831853 + 0.5;
  float around = floor(uRows * 1.5 + 2.0);
  vec2 q = vec2(a * around + uTime * 0.05, 0.35 / r + uPhase * 0.6);
  vec2 id = floor(q);
  vec2 f = fract(q);
  float cellPx = r * 6.2831853 / around * uRes.y;
  vec3 col = shade(tile(f, tileLod(cellPx)), id, floor(uKick));
  // Fade into the dark centre
  return mix(uBg, col, smoothstep(0.02, 0.25, r));
}

vec3 zoom(vec2 p) {
  p = rot(uTime * 0.05) * p;
  // Two layers a factor of 2 apart, cross-faded, give an endless zoom
  float z = fract(uPhase * 0.12);
  vec3 col = vec3(0.0);
  for (int i = 0; i < 2; i++) {
    // The finer layer takes over seamlessly when z wraps (its scale then equals the coarser one's)
    float rows = uRows * exp2(z + float(i)) * 0.5;
    vec2 q = cells(p, rows);
    float w = i == 0 ? z : 1.0 - z;
    col += w * shade(tile(fract(q), tileLod(uRes.y / rows)), floor(q), floor(uKick));
  }
  return col;
}

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec3 col = uVariant == 0 ? grid(p) : uVariant == 1 ? wall(p) : uVariant == 2 ? tunnel(p) : zoom(p);
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`,
};
