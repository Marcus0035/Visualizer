import type { ModeGL } from './types';

/** Retro 8-bit look: everything is drawn on a coarse pixel grid. */
export const arcade: ModeGL = {
  kind: 'gl',
  id: 'arcade',
  name: '8-bit',
  icon: 'Gamepad2',
  variants: ['Hvězdy', 'Mřížka', 'Vetřelci'],
  params: [
    { id: 'uSpeed', label: 'Rychlost', default: 1, min: 0.25, max: 3, step: 0.05 },
    { id: 'uPixel', label: 'Velikost pixelu', default: 6, min: 2, max: 16, step: 1 },
    { id: 'uFlash', label: 'Záblesk na kick', default: 0.5, min: 0, max: 1, step: 0.05 },
  ],
  // uSpeed is applied by the renderer to uTime and uPhase
  fragment: /* glsl */ `
uniform float uPixel;
uniform float uFlash;

float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float h1(float n) { return fract(sin(n * 127.1) * 43758.5453); }

// Colors snapped to a few levels like an old console
vec3 crush(vec3 c) { return floor(c * 6.0) / 5.0; } // rounds down, so dark stays dark

// Starfield rushing at you, faster with the bass
vec3 stars(vec2 p) {
  vec3 col = uBg;
  for (int l = 0; l < 3; l++) {
    float fl = float(l);
    float z = fract(uPhase * 0.25 * (1.0 + fl * 0.4) + fl / 3.0);
    vec2 q = p / (0.1 + z * 2.0) * 40.0;
    vec2 cell = floor(q);
    float star = step(0.8, h2(cell + fl * 31.0));
    float near = z * z;
    col += star * mix(uB, uC, near) * (0.3 + near * 2.5) * step(length(fract(q) - 0.5), 0.12 + 0.2 * near);
  }
  return col;
}

// Outrun grid to the horizon under a striped sun
vec3 grid(vec2 p, float px) {
  vec3 col = uBg;
  if (p.y > -0.05) {
    vec2 s = p - vec2(0.0, 0.12);
    float sun = step(length(s), 0.22 + 0.02 * uBass);
    float stripes = step(0.35, fract(s.y * 18.0 - uTime * 0.5)) + step(0.06, s.y);
    col = mix(col, mix(uA, uC, smoothstep(-0.2, 0.2, s.y)), sun * min(stripes, 1.0));
    col += uB * 0.15 * (1.0 - smoothstep(0.0, 0.5, p.y));
  } else {
    float depth = 0.25 / (-p.y);
    vec2 g = vec2(p.x * depth * 6.0, depth * 1.5 + uPhase * 0.8);
    // Distance to the nearest grid line in screen pixel blocks, so lines stay thin near the camera
    // (analytic size of one block in grid units: fwidth is zero inside a snapped block)
    vec2 block = vec2(depth * 6.0, depth * depth * 6.0) * px / uRes.y;
    vec2 f = abs(fract(g + 0.5) - 0.5) / block;
    float line = 1.0 - smoothstep(0.5, 1.5, min(f.x, f.y));
    col += uA * line * (0.4 + 0.6 * uPulse) * clamp(1.0 / depth, 0.0, 1.0) * 1.5;
  }
  return col;
}

// 11x8 alien sprite, two animation frames, packed per row (bit 1 = pixel)
float alien(vec2 c, float frame) {
  if (c.x < 0.0 || c.x > 10.0 || c.y < 0.0 || c.y > 7.0) return 0.0;
  int row = int(7.0 - c.y);
  int rows0[8] = int[8](0x104, 0x088, 0x1FC, 0x376, 0x7FF, 0x5FD, 0x505, 0x0D8);
  int rows1[8] = int[8](0x104, 0x489, 0x5FD, 0x777, 0x7FF, 0x1FC, 0x104, 0x202);
  int bits = frame < 0.5 ? rows0[row] : rows1[row];
  return float((bits >> int(10.0 - c.x)) & 1);
}

// Rows of invaders stepping sideways on every kick
// Sprite pixels are their own grid (110 per screen height), so this one skips the pixel snapping
vec3 invaders(vec2 p) {
  vec3 col = uBg;
  float k = floor(uKick);
  float stepX = mod(k, 16.0);
  stepX = stepX < 8.0 ? stepX : 16.0 - stepX;
  // 11 columns x 5 rows, marching sideways and slowly down
  vec2 q = p * 110.0 + vec2(88.0 - (stepX - 4.0) * 2.0, 22.0 + 2.0 * floor(mod(k / 16.0, 4.0)));
  vec2 slot = floor(q / vec2(16.0, 12.0));
  vec2 in_ = mod(q, vec2(16.0, 12.0)) - vec2(2.5, 2.0);
  if (slot.y >= 0.0 && slot.y < 5.0 && slot.x >= 0.0 && slot.x < 11.0) {
    float on = alien(floor(in_), mod(k, 2.0));
    vec3 c = slot.y < 1.0 ? uC : slot.y < 3.0 ? uA : uB;
    float hit = step(0.85, h2(slot + k)) * uPulse;
    col = mix(col, c * (1.0 + hit * 2.0), on);
  }
  // Ground line and spectrum "bunkers"
  if (p.y < -0.42) {
    float x = clamp(p.x / (uRes.x / uRes.y) + 0.5, 0.0, 1.0);
    float level = texture(uSpectrum, vec2(x * 0.5, 0.5)).r;
    col += uA * step(p.y + 0.5, level * 0.08) * 0.8;
  }
  return col;
}

void main() {
  float px = uPixel * max(1.0, uRes.y / 720.0);
  vec2 frag = (floor(gl_FragCoord.xy / px) + 0.5) * px;
  vec2 p = (frag - 0.5 * uRes) / uRes.y;
  vec3 col = uVariant == 0 ? stars(p) : uVariant == 1 ? grid(p, px) : invaders((gl_FragCoord.xy - 0.5 * uRes) / uRes.y);
  col += uC * uPulse * uPulse * uPulse * uFlash * 0.25;
  outColor = vec4(clamp(crush(col), 0.0, 1.0), 1.0);
}
`,
};
