import type { ModeGL } from './types';

/** Glowing blobs that melt into each other and swell on the beat. */
export const lava: ModeGL = {
  kind: 'gl',
  id: 'lava',
  name: 'Lava lamp',
  icon: 'Droplets',
  variants: ['Lamp', 'Drops'],
  params: [
    { id: 'uSpeed', label: 'Speed', default: 1, min: 0.25, max: 3, step: 0.05 },
    { id: 'uDensity', label: 'Amount', default: 1, min: 0.5, max: 2, step: 0.05 },
    { id: 'uSwell', label: 'Swell on beat', default: 0.6, min: 0, max: 1, step: 0.05 },
    { id: 'uGlow', label: 'Glow', default: 0.6, min: 0, max: 1, step: 0.05 },
  ],
  // uSpeed is applied by the renderer to uTime and uPhase
  fragment: /* glsl */ `
uniform float uDensity;
uniform float uSwell;
uniform float uGlow;

float h1(float n) { return fract(sin(n * 127.1) * 43758.5453); }

// Metaball field: sum of r^2 / d^2 over the blobs
float field(vec2 p, int variant) {
  float aspect = uRes.x / uRes.y;
  int count = int(4.0 + 6.0 * uDensity);
  float f = 0.0;
  for (int i = 0; i < 16; i++) {
    if (i >= count) break;
    float fi = float(i);
    float sp = 0.4 + h1(fi) * 0.8;
    vec2 c;
    if (variant == 0) {
      // Rise and sink like wax in a lamp, slight sideways sway
      float y = sin(uTime * 0.12 * sp + fi * 2.1) * 0.42;
      float x = (h1(fi + 3.0) - 0.5) * aspect * 0.7 + 0.08 * sin(uTime * 0.2 * sp + fi);
      c = vec2(x, y);
    } else {
      // Drops orbiting the center at different radii
      float a = uPhase * 0.15 * sp * (h1(fi + 5.0) > 0.5 ? 1.0 : -1.0) + fi * 2.4;
      float r = 0.1 + 0.32 * h1(fi + 9.0);
      c = vec2(cos(a) * r * aspect * 0.8, sin(a * 1.3) * r);
    }
    float size = (0.05 + 0.06 * h1(fi + 7.0)) * (1.0 + uSwell * (0.5 * uPulse + 0.4 * uBass));
    vec2 d = p - c;
    f += size * size / max(dot(d, d), 1e-5);
  }
  return f;
}

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float f = field(p, uVariant);
  float body = smoothstep(0.9, 1.1, f);
  // Darker rim inside the wax, bright core
  vec3 wax = mix(uB, uA, smoothstep(1.0, 2.5, f));
  wax = mix(wax, uC, smoothstep(4.0, 9.0, f) * (0.4 + 0.6 * uPulse));
  vec3 col = uBg + uA * uGlow * 0.35 * smoothstep(0.2, 0.9, f) * (0.6 + uLevel);
  col = mix(col, wax, body);
  // Faint glass vignette
  col *= 1.0 - 0.5 * dot(p, p);
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`,
};
