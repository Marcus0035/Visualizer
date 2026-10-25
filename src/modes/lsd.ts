import type { ModeGL } from './types';

/**
 * Acid-rave motifs: warped checkerboards, spirals, melting smileys, wireframe shapes,
 * an eye, striped orbs, starbursts, a vinyl, joy-division ridges and a warped mesh.
 */
export const lsd: ModeGL = {
  kind: 'gl',
  id: 'lsd',
  name: 'LSD',
  icon: 'Eye',
  variants: ['Checker tunnel', 'Spiral', 'Smileys', 'Wire sphere', 'Wire torus', 'Eye', 'Striped orbs', 'Starburst', 'Vinyl', 'Ridges', 'Warp mesh'],
  params: [
    { id: 'uSpeed', label: 'Speed', default: 1, min: 0.25, max: 3, step: 0.05 },
    { id: 'uDensity', label: 'Density', default: 1, min: 0.5, max: 2, step: 0.05 },
    { id: 'uFlash', label: 'Flash on kick', default: 0.6, min: 0, max: 1, step: 0.05 },
    { id: 'uWarp', label: 'Warp', default: 0.6, min: 0, max: 1, step: 0.05 },
  ],
  // uSpeed is applied by the renderer to uTime and uPhase
  fragment: /* glsl */ `
uniform float uDensity;
uniform float uFlash;
uniform float uWarp;

const float PI = 3.14159265;

float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y);
}
float fill(float d) { float w = 1.5 / uRes.y; return 1.0 - smoothstep(-w, w, d); }
float spec(float x) { return texture(uSpectrum, vec2(pow(clamp(x, 0.0, 1.0), 2.0) * 0.6 + 0.01, 0.5)).r; }
float hit() { return uPulse * uPulse * uFlash; }
// Colors cycle through the three palette colors
vec3 cyc(float t) {
  t = fract(t) * 3.0;
  return t < 1.0 ? mix(uA, uB, t) : t < 2.0 ? mix(uB, uC, t - 1.0) : mix(uC, uA, t - 2.0);
}
float line(float v, float w) { float d = abs(fract(v + 0.5) - 0.5); float aw = fwidth(v) * 1.2; return 1.0 - smoothstep(w, w + aw + 0.0001, d); }

// Warped checkerboard tunnel
vec3 checkerTunnel(vec2 p) {
  p += uWarp * 0.1 * vec2(sin(p.y * 6.0 + uTime), cos(p.x * 6.0 + uTime * 1.3)) * (1.0 + uBass);
  float r = length(p) + 0.001;
  float a = atan(p.y, p.x);
  float u = a / (2.0 * PI) * 12.0 * uDensity;
  float v = 0.35 / r + uPhase * 0.5;
  float chk = mod(floor(u) + floor(v), 2.0);
  vec3 col = mix(uBg, cyc(v * 0.08 + hit()), chk);
  col = mix(col, uC, hit() * chk * 0.5);
  return col * smoothstep(0.0, 0.35, r);
}

// Hypnotic spiral arms
vec3 spiral(vec2 p) {
  p += uWarp * 0.05 * vec2(sin(uTime * 0.7), cos(uTime * 0.9));
  float r = length(p) + 0.001;
  float a = atan(p.y, p.x);
  float arms = 5.0 * uDensity;
  float v = fract(a / (2.0 * PI) * arms + log(r) * 2.2 * (1.0 + uWarp) - uPhase * 0.3);
  float s = smoothstep(0.42, 0.48, v) - smoothstep(0.92, 0.98, v);
  vec3 col = mix(uBg, cyc(r * 1.5 - uTime * 0.05), s);
  col += uC * hit() * s * 0.5;
  return col;
}

// Melting smileys on a checkerboard
vec3 smileys(vec2 p) {
  float n = 3.0 * uDensity;
  vec2 g = p * n;
  vec2 cell = floor(g);
  vec2 l = fract(g) - 0.5;
  float chk = mod(cell.x + cell.y, 2.0);
  vec3 col = mix(uBg, uBg + uB * 0.3, chk);
  float seed = h2(cell);
  float t = uTime * 2.0 + seed * 6.0;
  float bounce = 1.0 + 0.12 * uPulse * uFlash;
  l /= bounce;
  l += uWarp * 0.04 * vec2(sin(l.y * 12.0 + t), cos(l.x * 12.0 + t));
  // Melt: the lower half sags
  l.y += step(l.y, 0.0) * 0.1 * uWarp * (0.5 + 0.5 * sin(t + l.x * 8.0)) * -l.y;
  float face = fill(length(l) - 0.4);
  vec3 skin = cyc(seed + uTime * 0.03 + hit());
  col = mix(col, skin, face);
  vec2 e = vec2(abs(l.x) - 0.15, (l.y - 0.1) * 0.6);
  float eyes = fill(length(e) - 0.06);
  float arc = abs(length(l - vec2(0.0, 0.04)) - 0.25) - 0.025;
  float mouth = fill(max(arc, l.y - 0.0));
  col = mix(col, uBg, max(eyes, mouth) * face);
  return col;
}

// Wireframe sphere, turning, with a rim glow
vec3 wireSphere(vec2 p) {
  float R = 0.4 + 0.04 * uBass + 0.03 * hit();
  float d = length(p);
  float z = sqrt(max(R * R - d * d, 0.0));
  vec3 n = vec3(p, z) / R;
  n.yz = rot(0.5) * n.yz;
  n.xz = rot(uTime * 0.4) * n.xz;
  float lon = atan(n.z, n.x) / (2.0 * PI) * 16.0 * uDensity;
  float lat = asin(clamp(n.y, -1.0, 1.0)) / PI * 12.0 * uDensity;
  float g = max(line(lon, 0.04), line(lat, 0.04));
  float inside = step(d, R);
  float rim = pow(1.0 - clamp(z / R, 0.0, 1.0), 3.0);
  vec3 col = uBg * 0.5;
  col += (uA * g * (0.5 + 0.5 * z / R) + uC * rim * 0.8 + uB * 0.12) * inside;
  col += uA * 0.12 * exp(-max(d - R, 0.0) * 14.0) * (1.0 + uBass);
  return col;
}

// Wireframe torus (ray-marched)
float sdTorus(vec3 q, vec2 t) { vec2 k = vec2(length(q.xz) - t.x, q.y); return length(k) - t.y; }
vec3 wireTorus(vec2 p) {
  vec3 ro = vec3(0.0, 0.0, -2.4);
  vec3 rd = normalize(vec3(p, 1.5));
  mat2 ry = rot(uTime * 0.35);
  mat2 rx = rot(0.9 + 0.2 * sin(uTime * 0.3));
  vec2 tr = vec2(0.46 + 0.04 * uBass, 0.19);
  float t = 0.0;
  bool hitSurface = false;
  vec3 pos = ro;
  for (int i = 0; i < 56; i++) {
    pos = ro + rd * t;
    vec3 q = pos;
    q.xz = ry * q.xz;
    q.yz = rx * q.yz;
    float d = sdTorus(q, tr);
    if (d < 0.002) { hitSurface = true; break; }
    t += d;
    if (t > 5.0) break;
  }
  vec3 col = uBg * 0.5;
  if (hitSurface) {
    vec3 q = pos;
    q.xz = ry * q.xz;
    q.yz = rx * q.yz;
    float u = atan(q.z, q.x) / (2.0 * PI) * 28.0 * uDensity;
    float v = atan(q.y, length(q.xz) - tr.x) / (2.0 * PI) * 12.0 * uDensity;
    float g = max(line(u, 0.06), line(v, 0.06));
    float fres = clamp(1.0 + dot(normalize(vec3(q.x, q.y, q.z)), rd) * 0.0, 0.0, 1.0);
    col = uBg + uB * 0.2 + uA * g * (1.0 + hit() * 2.0) + uC * 0.0 * fres;
  }
  return col;
}

// A big eye whose pupil opens on the bass
vec3 eye(vec2 p) {
  vec3 col = uBg;
  float r0 = length(p);
  col += cyc(r0 * 2.0 - uPhase * 0.1) * 0.25 * step(0.5, fract(r0 * 9.0 * uDensity - uPhase * 0.2));
  vec2 q = p + 0.03 * vec2(sin(uTime * 0.8), cos(uTime * 0.6)) * uWarp;
  float w = max(1.0 - (q.x * q.x) / 0.5, 0.0);
  float almond = abs(q.y) - 0.3 * pow(w, 0.75);
  float lid = fill(almond);
  float iris = length(q);
  float a = atan(q.y, q.x);
  vec3 irisCol = cyc(0.1 + 0.5 * sin(a * 18.0 + uTime) * 0.1 + iris * 1.5 + hit());
  irisCol *= 0.7 + 0.3 * sin(a * 40.0);
  vec3 eyeCol = uC * 0.9;
  eyeCol = mix(eyeCol, irisCol, fill(iris - 0.22 - 0.02 * uBass));
  float pupil = fill(iris - (0.05 + 0.1 * uBass + 0.04 * hit()));
  eyeCol = mix(eyeCol, uBg * 0.2, pupil);
  col = mix(col, eyeCol, lid);
  col = mix(col, uA, smoothstep(0.02, 0.0, abs(almond)) * 1.0);
  return col;
}

// Concentric striped balls, bobbing
vec3 stripedOrbs(vec2 p) {
  vec3 col = uBg;
  for (int i = 0; i < 3; i++) {
    float f = float(i);
    vec2 c = vec2((f - 1.0) * 0.55 * uDensity, 0.12 * sin(uTime * 0.9 + f * 2.1) * (1.0 + uWarp));
    float R = 0.22 + 0.03 * sin(f * 3.0) + 0.04 * hit();
    vec2 l = p - c;
    float d = length(l);
    float body = fill(d - R);
    float z = sqrt(max(R * R - d * d, 0.0)) / R;
    float stripes = step(0.5, fract(length(l - vec2(0.05, 0.05) * R) * 9.0 / R * 0.3 - uPhase * 0.4 + f * 0.3));
    vec3 c1 = cyc(f * 0.33 + uTime * 0.03);
    vec3 orb = mix(uBg, c1, stripes) * (0.35 + 0.8 * z);
    col = mix(col, orb, body);
    col += uC * 0.15 * exp(-max(d - R, 0.0) * 12.0);
  }
  return col;
}

// Rows of spiky stars, spinning
vec3 starburst(vec2 p) {
  float n = 3.0 * uDensity;
  vec2 g = p * n;
  vec2 cell = floor(g);
  vec2 l = fract(g) - 0.5;
  float seed = h2(cell);
  float spikes = 6.0 + floor(seed * 8.0);
  float a = atan(l.y, l.x) + (seed - 0.5) * uPhase * 0.8;
  float spike = pow(abs(cos(spikes * 0.5 * a)), 2.5);
  float R = (0.18 + 0.28 * spike) * (1.0 + 0.2 * uPulse * uFlash);
  float body = fill(length(l) - R);
  vec3 col = mix(uBg, uBg + uB * 0.2, mod(cell.x + cell.y, 2.0));
  col = mix(col, cyc(seed + uTime * 0.05 + hit()), body);
  col = mix(col, uBg, fill(length(l) - 0.07) * body);
  return col;
}

// Spinning vinyl with a label
vec3 vinyl(vec2 p) {
  vec3 col = uBg;
  float a0 = atan(p.y, p.x);
  col += uB * 0.12 * step(0.5, fract(a0 / (2.0 * PI) * 18.0 + uPhase * 0.05));
  float R = 0.42 + 0.02 * hit();
  float d = length(p);
  float disc = fill(d - R);
  float a = atan(p.y, p.x) - uPhase * 0.6;
  float groove = 0.5 + 0.5 * sin(d * 260.0 * uDensity + noise(vec2(a * 2.0, d * 30.0)) * 2.0);
  float sheen = pow(max(cos(a * 2.0), 0.0), 8.0) * 0.6;
  vec3 rec = uBg * 0.5 + uB * 0.25 * groove + uC * sheen;
  col = mix(col, rec, disc);
  float label = fill(d - 0.15);
  vec3 lab = mix(uA, uC, 0.5 + 0.5 * sin(a * 3.0));
  col = mix(col, lab, label);
  col = mix(col, uBg, fill(d - 0.018));
  return col;
}

// Joy-division style ridges: stacked spectrum lines, front ones hide the back
vec3 ridges(vec2 p) {
  float aspect = uRes.x / uRes.y;
  float x = p.x / aspect + 0.5;
  vec3 col = uBg;
  float rowsN = 22.0 * uDensity;
  for (int j = 0; j < 44; j++) {
    float f = float(j);
    if (f >= rowsN) break;
    float base = 0.42 - f / rowsN * 0.84;
    float bump = exp(-pow((x - 0.5) * 3.2, 2.0));
    float h = (spec(x * 0.9 + f * 0.004) * 0.35 + noise(vec2(x * 40.0, f * 3.7 + uTime * 0.5)) * 0.04) * bump * (0.6 + 0.8 * uBass + uWarp * 0.3);
    float y = base + h;
    if (p.y < y) col = uBg;
    float l = smoothstep(0.0035 + 1.0 / uRes.y, 0.0, abs(p.y - y));
    col = mix(col, cyc(f / rowsN * 0.6 + hit()), l);
  }
  return col;
}

// Warped mesh with a checker shimmer
vec3 warpMesh(vec2 p) {
  vec2 q = p + uWarp * 0.16 * vec2(sin(p.y * 5.0 + uTime), cos(p.x * 5.0 + uTime * 1.2)) * (1.0 + uBass * 1.2);
  q += 0.05 * uWarp * uPulse * normalize(p + 0.001);
  vec2 g = q * 9.0 * uDensity;
  float l = max(line(g.x, 0.05), line(g.y, 0.05));
  float chk = mod(floor(g.x) + floor(g.y), 2.0);
  vec3 col = uBg + uB * 0.12 * chk;
  col = mix(col, cyc(length(p) * 0.8 - uTime * 0.05 + hit()), l);
  return col;
}

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec3 col = uVariant == 0 ? checkerTunnel(p)
    : uVariant == 1 ? spiral(p)
    : uVariant == 2 ? smileys(p)
    : uVariant == 3 ? wireSphere(p)
    : uVariant == 4 ? wireTorus(p)
    : uVariant == 5 ? eye(p)
    : uVariant == 6 ? stripedOrbs(p)
    : uVariant == 7 ? starburst(p)
    : uVariant == 8 ? vinyl(p)
    : uVariant == 9 ? ridges(p)
    : warpMesh(p);
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`,
};
