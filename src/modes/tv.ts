import type { ModeGL } from './types';

/** Detuned TV: snow, rolling bars and signal dropouts on the kick. */
export const tv: ModeGL = {
  kind: 'gl',
  id: 'tv',
  name: 'TV static',
  icon: 'Tv',
  variants: ['Static', 'Test card', 'Signal loss'],
  params: [
    { id: 'uSpeed', label: 'Speed', default: 1, min: 0.25, max: 3, step: 0.05 },
    { id: 'uNoise', label: 'Noise', default: 0.7, min: 0.1, max: 1, step: 0.05 },
    { id: 'uFlash', label: 'Dropout on kick', default: 0.6, min: 0, max: 1, step: 0.05 },
    { id: 'uTint', label: 'Color', default: 0.5, min: 0, max: 1, step: 0.05 },
  ],
  // uSpeed is applied by the renderer to uTime and uPhase
  fragment: /* glsl */ `
uniform float uNoise;
uniform float uFlash;
uniform float uTint;

float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float h1(float n) { return fract(sin(n * 127.1) * 43758.5453); }

// Snow at a coarse pixel size, new every frame-ish
float snow(vec2 frag, float t) {
  vec2 cell = floor(frag / 2.0);
  return h2(cell + floor(t * 60.0) * vec2(17.0, 31.0));
}

vec3 tint(float v) {
  return mix(vec3(v), v < 0.5 ? mix(uBg, uA, v * 2.0) : mix(uA, uC, v * 2.0 - 1.0), uTint);
}

// Palette test card: vertical bars, a strip of grey steps and a center circle
vec3 testCard(vec2 uv) {
  float bar = floor(uv.x * 7.0);
  vec3 cols[7] = vec3[7](uC, uA, uB, mix(uA, uC, 0.5), mix(uB, uBg, 0.5), uA * 0.6, uBg);
  vec3 col = cols[int(clamp(bar, 0.0, 6.0))];
  if (uv.y < 0.22) col = vec3(floor(uv.x * 8.0) / 7.0) * mix(vec3(1.0), uA, 0.4);
  vec2 c = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float ring = abs(length(c) - 0.3);
  col = mix(col, uC, smoothstep(0.008, 0.0, ring));
  return col * 0.75;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = frag / uRes;
  float t = uTime;
  float k = floor(uKick);
  float hit = uPulse * uPulse * uFlash;

  // Horizontal tearing: lines shift, harder on the kick
  float line = floor(frag.y / 3.0);
  float tear = (h2(vec2(line, floor(t * 20.0))) - 0.5) * 0.01 + step(0.9, h1(floor(frag.y / 40.0) + k)) * hit * 0.15;
  uv.x = fract(uv.x + tear);

  // Rolling bar that drifts up the screen
  float roll = smoothstep(0.0, 0.12, abs(fract(uv.y - t * 0.15) - 0.5) - 0.38);
  float s = snow(frag + vec2(tear * uRes.x, 0.0), t);

  vec3 col;
  if (uVariant == 0) {
    float v = s * uNoise * (0.55 + 0.6 * uLevel) * (0.7 + 0.3 * roll);
    col = tint(v);
  } else if (uVariant == 1) {
    // Test card that breaks into snow on the kick
    vec3 card = testCard(uv);
    float broken = clamp(0.1 * uNoise + hit * 0.8, 0.0, 1.0);
    col = mix(card, tint(s), broken) * (0.8 + 0.2 * roll);
  } else {
    // Black screen, signal flickers in as noisy bands with the music
    float band = floor(uv.y * 24.0);
    float on = step(1.0 - (0.15 + 0.7 * uLevel) * uNoise, h1(band + floor(t * 8.0) + k * 3.0));
    col = tint(s * on * (0.6 + 0.6 * uBass));
    col += uA * hit * 0.4 * step(0.6, h1(band + k));
  }
  // Scanlines and a flash of white noise on strong kicks
  col *= 0.85 + 0.15 * sin(frag.y * 3.14159);
  col = mix(col, tint(s), hit * 0.3);
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`,
};
