import type { ModeGL } from './types';

/**
 * Thousands of points in depth layers. Each layer scales out with the beat pulse at its
 * own rate, so a kick blows the cloud apart and it pulls back together as the pulse fades.
 */
export const particles: ModeGL = {
  kind: 'gl',
  id: 'particles',
  name: 'Particles',
  icon: 'Orbit',
  variants: ['Blast', 'Swirl'],
  params: [
    { id: 'uSpeed', label: 'Speed', default: 1, min: 0.25, max: 3, step: 0.05 },
    { id: 'uDensity', label: 'Density', default: 1, min: 0.5, max: 2, step: 0.05 },
    { id: 'uBlast', label: 'Blast strength', default: 0.7, min: 0, max: 1, step: 0.05 },
    { id: 'uSize', label: 'Dot size', default: 1, min: 0.5, max: 2, step: 0.05 },
  ],
  // uSpeed is applied by the renderer to uTime and uPhase
  fragment: /* glsl */ `
uniform float uDensity;
uniform float uBlast;
uniform float uSize;

vec2 h22(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

const int LAYERS = 5;

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float n = 7.0 * uDensity;
  float blast = uPulse * uPulse * uBlast;
  vec3 col = uBg;
  for (int l = 0; l < LAYERS; l++) {
    float fl = float(l);
    float depth = (fl + 1.0) / float(LAYERS);
    vec2 q = p;
    if (uVariant == 0) {
      // Outer layers fly further on the kick
      q /= 1.0 + blast * (0.6 + 2.2 * depth) + 0.15 * uBass * depth;
      q = rot(fl * 1.3 + uTime * 0.03 * (fl - 2.0)) * q;
    } else {
      // Galaxy swirl: inner parts turn faster, bass widens the disk
      float r = length(q);
      q = rot(uPhase * (0.25 + 0.2 * fl) / (0.3 + r) + fl) * q;
      q /= 1.0 + blast * depth * 1.2 + 0.2 * uBass;
    }
    vec2 g = q * n * (0.8 + 0.25 * fl);
    vec2 cell = floor(g);
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 c = cell + vec2(x, y);
      vec2 rnd = h22(c + fl * 17.0);
      vec2 pos = c + 0.5 + 0.4 * sin(uTime * 0.5 + 6.2831 * rnd);
      float d = length(g - pos);
      float size = (0.025 + 0.04 * rnd.x) * uSize * (1.0 + blast);
      // Sharp core with a short glow, dark space between the points
      float glow = pow(size / max(d, 0.01), 2.5);
      vec3 tone = rnd.y < 0.6 ? uA : rnd.y < 0.9 ? uB : uC;
      col += tone * min(glow, 4.0) * (0.25 + 0.75 * depth) * (0.5 + 0.8 * uLevel + blast);
    }
  }
  col = uBg + (1.0 - exp(-(col - uBg) * 1.2));
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`,
};
