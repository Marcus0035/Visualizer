import type { ModeGL } from './types';

/** Hard, kick-locked visuals: every detected beat (uKick) snaps to a new pattern. */
export const techno: ModeGL = {
  kind: 'gl',
  id: 'techno',
  name: 'Techno',
  icon: 'Zap',
  variants: ['Tunel', 'Lasery', 'Bloky', 'Industrial'],
  params: [
    { id: 'uSpeed', label: 'Rychlost', default: 1, min: 0.25, max: 3, step: 0.05 },
    { id: 'uDensity', label: 'Hustota', default: 1, min: 0.5, max: 2, step: 0.05 },
    { id: 'uFlash', label: 'Záblesk na kick', default: 0.5, min: 0, max: 1, step: 0.05 },
    { id: 'uGain', label: 'Jas', default: 1, min: 0.3, max: 1.5, step: 0.05 },
    {
      id: 'uEvery',
      label: 'Změna vzoru po kicích',
      default: 1,
      options: [1, 2, 4, 8].map((n) => ({ label: String(n), value: n })),
    },
  ],
  // uSpeed is applied by the renderer to uTime and uPhase
  fragment: /* glsl */ `
uniform float uDensity;
uniform float uFlash;
uniform float uGain;
uniform float uEvery;

mat2 rot(float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c);
}
float h1(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float kick() { return floor(uKick / max(uEvery, 1.0)); }
float flash() { return uPulse * uPulse * uPulse * uFlash * 2.0; }

// Square tunnel rushing at you, rotation snaps 22.5 deg per kick
vec3 tunnel(vec2 p) {
  float k = kick();
  p = rot(k * 0.3927) * p;
  float r = max(abs(p.x), abs(p.y));
  float zz = 0.9 * uDensity / max(r, 0.002) + uPhase * 3.0;
  float ring = fract(zz);
  float line = smoothstep(0.8, 0.86, ring) * (1.0 - smoothstep(0.96, 1.0, ring));
  vec3 lc = mod(floor(zz), 4.0) < 1.0 ? uC : uA;
  float fog = smoothstep(0.0, 0.45, r);
  vec3 col = uBg + lc * line * fog * (0.6 + uBass);
  float diag = abs(abs(p.x) - abs(p.y));
  col += uB * (1.0 - smoothstep(0.0, 0.01, diag)) * fog * 0.6;
  return mix(col, uC, flash() * 0.3 * (1.0 - fog));
}

// Two laser fans from the bottom corners; beams are chopped on/off per kick
vec3 lasers(vec2 p) {
  float k = kick();
  float aspect = uRes.x / uRes.y;
  vec3 col = uBg;
  for (int s = 0; s < 2; s++) {
    float side = s == 0 ? -1.0 : 1.0;
    vec2 o = vec2(side * aspect * 0.5, -0.5);
    vec3 lc = mod(k + float(s), 2.0) < 1.0 ? uA : mix(uA, uC, 0.5);
    vec2 v = p - o;
    int beams = int(clamp(7.0 * uDensity, 3.0, 14.0));
    for (int i = 0; i < 14; i++) {
      if (i >= beams) break;
      float fi = float(i);
      if (h1(fi + k * 7.0 + float(s) * 31.0) < 0.3) continue;
      float sweep = sin(uTime * (0.6 + 0.15 * fi) + fi + mod(k, 3.0)) * 0.3;
      float ang = 1.5708 + side * (0.35 + fi * 0.84 / float(beams) + sweep);
      vec2 d = vec2(cos(ang), sin(ang));
      float along = dot(v, d);
      if (along < 0.0) continue;
      float perp = abs(v.x * d.y - v.y * d.x);
      float w = 0.0015 + 0.003 * uTreble;
      float core = w / (perp + w);
      col += lc * core * 1.4 * exp(-along * 0.4) * (0.7 + uBass);
      col += lc * 0.08 * exp(-perp * 25.0) * exp(-along * 0.7);
    }
    col += lc * 0.12 / (length(v) * 8.0 + 0.2);
  }
  return col + uC * flash() * 0.15;
}

// Grid of tiles, a random set lights up on every kick; hats sparkle
vec3 blocks(vec2 uv) {
  float k = kick();
  vec2 grid = max(vec2(2.0), floor(vec2(8.0, 4.0) * uDensity + 0.5));
  vec2 cell = floor(uv * grid);
  vec2 f = fract(uv * grid);
  float on = step(0.62, h2(cell + k * 13.1));
  float gap = step(0.04, f.x) * step(0.04, f.y) * step(f.x, 0.96) * step(f.y, 0.96);
  vec3 lc = h2(cell + k) > 0.8 ? uC : uA;
  vec3 col = uBg + uB * 0.06 * gap;
  col += lc * on * gap * (0.2 + 0.8 * uPulse);
  float sparkle = step(0.997 - uTreble * 0.01, h2(floor(gl_FragCoord.xy / 4.0) + floor(uTime * 20.0)));
  return col + uC * sparkle * uTreble;
}

// Moving hazard stripes, inverted every kick, slices torn sideways on the hit
vec3 industrial(vec2 p, vec2 uv) {
  float k = kick();
  float band = floor(uv.y * 18.0 * uDensity);
  float tear = step(0.6, h2(vec2(band + 5.0, k)));
  vec2 q = p + vec2((h2(vec2(band, k)) - 0.5) * 0.4 * uPulse * tear, 0.0);
  float stripe = step(0.5, fract((q.x + q.y) * 6.0 * uDensity - uPhase * 1.5));
  stripe = abs(stripe - mod(k, 2.0));
  vec3 ink = mix(uB, uA, step(0.5, h2(vec2(band, k + 1.0))));
  vec3 col = mix(uBg, ink, stripe * (0.35 + 0.65 * uBass));
  float scan = 1.0 - smoothstep(0.0, 0.01, abs(uv.y - fract(uTime * 0.35)));
  col += uC * scan * 0.5;
  return mix(col, uC, flash() * 0.2);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec3 col;
  if (uVariant == 0) col = tunnel(p);
  else if (uVariant == 1) col = lasers(p);
  else if (uVariant == 2) col = blocks(uv);
  else col = industrial(p, uv);
  outColor = vec4(clamp(col * uGain, 0.0, 1.0), 1.0);
}
`,
};
