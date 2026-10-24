import type { ModeGL } from './types';

export const plasma: ModeGL = {
  kind: 'gl',
  id: 'plasma',
  name: 'Plasma',
  icon: 'Waves',
  variants: ['Tekutá', 'Světelné tyče'],
  fragment: /* glsl */ `
vec3 pal(float t) {
  t = fract(t);
  if (t < 1.0 / 3.0) return mix(uA, uB, t * 3.0);
  if (t < 2.0 / 3.0) return mix(uB, uC, (t - 1.0 / 3.0) * 3.0);
  return mix(uC, uA, (t - 2.0 / 3.0) * 3.0);
}

vec3 liquid(vec2 p, float t) {
  float v = sin(p.x * 3.0 + t)
          + sin((p.y * 4.0 - t) * 0.8)
          + sin((p.x + p.y) * 3.0 + t * 1.3)
          + sin(length(p * vec2(3.0, 2.0) + vec2(sin(t * 0.7), cos(t * 0.5))) * 5.0 - t);
  v += uMid * 1.5 * sin(length(p) * 12.0 - t * 3.0);
  vec3 col = pal(v * 0.2 + 0.5 + uTime * 0.02);
  float shade = 0.55 + 0.45 * sin(v * 3.14159 + t);
  col *= 0.3 + 0.7 * shade + uPulse * 0.35;
  col += uTreble * 0.2 * shade;
  return mix(uBg, col, 0.8 + uLevel * 0.2);
}

vec3 bars(vec2 p, float t) {
  vec3 col = vec3(0.0);
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float y = 0.38 * sin(t * (0.5 + fi * 0.17) + fi * 1.7);
    float wave = 0.06 * sin(p.x * (2.0 + fi * 0.5) + t * 1.4 + fi);
    float d = abs(p.y - y - wave);
    float w = 0.006 + 0.03 * uBass + 0.006 * fi * uMid;
    col += pal(fi / 6.0 + uTime * 0.03) * (w / (d + 0.004)) * exp(-d * 10.0);
  }
  col *= 0.35 + uPulse * 0.4 + uTreble * 0.4;
  return uBg + (1.0 - exp(-col * 1.4));
}

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec3 col = uVariant == 0 ? liquid(p, uPhase) : bars(p, uPhase);
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`,
};
