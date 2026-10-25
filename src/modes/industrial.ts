import type { ModeGL } from './types';

/**
 * Heavy machinery: gears, pistons driven by the spectrum, conveyors, a furnace, hazard
 * shutters and pressure gauges, all in palette colors with a layer of grit on top.
 */
export const industrial: ModeGL = {
  kind: 'gl',
  id: 'industrial',
  name: 'Industrial',
  icon: 'Factory',
  variants: ['Gears', 'Pistons', 'Conveyor', 'Furnace', 'Hazard', 'Gauges'],
  params: [
    { id: 'uSpeed', label: 'Speed', default: 1, min: 0.25, max: 3, step: 0.05 },
    { id: 'uDensity', label: 'Density', default: 1, min: 0.5, max: 2, step: 0.05 },
    { id: 'uFlash', label: 'Flash on kick', default: 0.7, min: 0, max: 1, step: 0.05 },
    { id: 'uGrit', label: 'Grit', default: 0.6, min: 0, max: 1, step: 0.05 },
  ],
  // uSpeed is applied by the renderer to uTime and uPhase
  fragment: /* glsl */ `
uniform float uDensity;
uniform float uFlash;
uniform float uGrit;

float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y);
}
float fill(float d) { float w = 1.5 / uRes.y; return 1.0 - smoothstep(-w, w, d); }
float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
float spec(float x) { return texture(uSpectrum, vec2(pow(clamp(x, 0.0, 1.0), 2.0) * 0.6 + 0.01, 0.5)).r; }
float hit() { return uPulse * uPulse * uFlash; }

// Gear outline: r = outer radius, n teeth, a = turn
float sdGear(vec2 p, float r, float n, float a) {
  float ang = atan(p.y, p.x) + a;
  float tooth = smoothstep(-0.3, 0.3, sin(ang * n));
  float d = length(p) - r * (0.8 + 0.2 * tooth);
  return max(d, -(length(p) - r * 0.3));
}

// A wall of meshing gears; one of them lights up on each kick
vec3 gears(vec2 p) {
  float n = 2.6 * uDensity;
  vec2 g = p * n + vec2(0.0, 0.0);
  vec2 cell = floor(g);
  vec2 l = fract(g) - 0.5;
  float dir = mod(cell.x + cell.y, 2.0) < 0.5 ? 1.0 : -1.0;
  float teeth = 12.0;
  float a = dir * uPhase * 0.5 + (dir < 0.0 ? 3.14159 / teeth : 0.0);
  float d = sdGear(l, 0.5, teeth, a);
  float body = fill(d);
  float ring = smoothstep(0.03, 0.0, abs(d + 0.02));
  vec3 col = uBg * 0.6;
  vec3 metal = mix(uB * 0.45, uB, 0.5 + 0.5 * l.y + 0.2 * sin(atan(l.y, l.x) * 3.0 + a * 3.0));
  col = mix(col, metal, body);
  col += uC * 0.35 * ring * body;
  // Hub bolts
  float hub = fill(length(l) - 0.1) * (1.0 - fill(length(l) - 0.05));
  col = mix(col, uC * 0.7, hub);
  float lit = step(0.82, h2(cell + floor(uKick) * 0.37));
  col += uA * lit * hit() * 2.0 * (body * 0.7 + 0.3 * smoothstep(0.5, 0.0, length(l)));
  return col;
}

// Pistons whose stroke follows the spectrum
vec3 pistons(vec2 p) {
  float aspect = uRes.x / uRes.y;
  float cols = 10.0 * uDensity;
  float x = (p.x / aspect + 0.5) * cols;
  float ci = floor(x);
  float lx = fract(x) - 0.5;
  float y = p.y + 0.5;
  float s = spec(ci / cols);
  float h = 0.12 + 0.62 * s + 0.1 * uBass;
  vec3 col = uBg * 0.5 + uB * 0.12 * step(0.45, abs(lx));
  // Housing at the bottom with hazard stripes
  float housing = fill(sdBox(vec2(lx, y - 0.07), vec2(0.46, 0.07)));
  float stripe = step(0.5, fract((lx + y) * 6.0));
  col = mix(col, mix(uB * 0.5, uA * 0.8, stripe), housing);
  // Shaft
  float shaft = fill(sdBox(vec2(lx, y - 0.14 - (h - 0.14) * 0.5), vec2(0.1, max(h - 0.14, 0.001) * 0.5)));
  col = mix(col, uB * (0.5 + 0.7 * smoothstep(0.1, -0.1, lx)), shaft);
  // Head
  float head = fill(sdBox(vec2(lx, y - h - 0.03), vec2(0.34, 0.035)));
  col = mix(col, mix(uA, uC, uPulse * 0.5) * (0.7 + 0.3 * s), head);
  col += uA * head * hit() * s;
  return col;
}

// Rows of belts carrying crates in alternating directions
vec3 conveyor(vec2 p) {
  float rows = 4.0 * uDensity;
  float ry = (p.y + 0.5) * rows;
  float ri = floor(ry);
  float ly = fract(ry) - 0.5;
  float dir = mod(ri, 2.0) < 0.5 ? 1.0 : -1.0;
  vec3 col = uBg * 0.5;
  // Belt with moving ticks
  float belt = fill(sdBox(vec2(0.0, ly + 0.28), vec2(10.0, 0.06)));
  float ticks = step(0.5, fract(p.x * 14.0 + dir * uPhase * 1.2));
  col = mix(col, uB * (0.35 + 0.25 * ticks), belt);
  // Crates
  float cx = p.x * 2.2 * uDensity + dir * uPhase * 0.35 + h2(vec2(ri, 3.0)) * 10.0;
  float ci = floor(cx);
  vec2 l = vec2(fract(cx) - 0.5, ly + 0.0);
  float exists = step(0.45, h2(vec2(ci, ri)));
  float box = fill(sdBox(l - vec2(0.0, -0.05), vec2(0.34, 0.2))) * exists;
  vec2 q = abs(l - vec2(0.0, -0.05));
  float brace = smoothstep(0.02, 0.0, abs(q.x - q.y * 1.7)) * step(q.x, 0.34) * step(q.y, 0.2);
  float edge = smoothstep(0.035, 0.0, abs(sdBox(l - vec2(0.0, -0.05), vec2(0.34, 0.2)) + 0.02));
  float lit = step(0.8, h2(vec2(ci, ri) + floor(uKick) * 0.31));
  vec3 crate = mix(uB * 0.7, uA * 0.8, lit * hit() * 1.5) + uC * (brace * 0.25 + edge * 0.3);
  col = mix(col, crate, box);
  return col;
}

// Furnace: rising heat behind a steel grating, with sparks
vec3 furnace(vec2 p) {
  float t = uTime;
  float n = noise(vec2(p.x * 3.0, p.y * 2.0 - t * 1.2)) * 0.6 + noise(vec2(p.x * 7.0, p.y * 5.0 - t * 2.1)) * 0.4;
  float heat = clamp(0.55 - (p.y + 0.5) * 0.9 + (n - 0.5) * 1.0 + uBass * 0.35 + hit() * 0.25, 0.0, 1.0);
  vec3 col = mix(uBg, uA, smoothstep(0.0, 0.55, heat));
  col = mix(col, uC, smoothstep(0.6, 1.0, heat));
  // Sparks
  for (int i = 0; i < 3; i++) {
    float f = float(i);
    vec2 g = vec2(p.x * (16.0 + f * 7.0), p.y * (5.0 + f * 2.0) - t * (1.4 + f * 0.7));
    vec2 c = floor(g);
    vec2 jitter = (vec2(h2(c.yx + f), h2(c + f * 3.0)) - 0.5) * 0.6;
    float d = length(fract(g) - 0.5 - jitter);
    col += uC * step(0.72, h2(c + f * 9.1)) * smoothstep(0.1, 0.0, d) * (1.0 + hit() * 2.0);
  }
  // Grating: dark bars with slots
  float bar = smoothstep(0.55, 0.6, abs(fract(p.x * 9.0 * uDensity) - 0.5) * 2.0);
  float rung = smoothstep(0.9, 0.95, abs(fract(p.y * 4.0) - 0.5) * 2.0);
  col = mix(col, uBg * 0.4, max(bar, rung) * 0.85);
  return col;
}

// Warning-striped shutters sliding in opposite directions, random ones flash on the kick
vec3 hazard(vec2 p) {
  float rows = 5.0 * uDensity;
  float ry = (p.y + 0.5) * rows;
  float ri = floor(ry);
  float ly = fract(ry);
  float dir = mod(ri, 2.0) < 0.5 ? 1.0 : -1.0;
  float s = step(0.5, fract((p.x + ly / rows * 1.0 * dir) * 4.0 * uDensity - dir * uPhase * 0.25));
  vec3 col = mix(uBg * 0.5, uA * 0.85, s);
  float lit = step(0.72, h2(vec2(ri, floor(uKick))));
  col = mix(col, uC, lit * hit() * 1.4 * s);
  col *= 1.0 - smoothstep(0.06, 0.0, min(ly, 1.0 - ly)) * 0.85;
  return col;
}

// Round pressure gauges, needles on bass, mids and highs
vec3 gauges(vec2 p) {
  float n = 2.2 * uDensity;
  vec2 g = p * n;
  vec2 cell = floor(g);
  vec2 l = fract(g) - 0.5;
  float id = mod(cell.x + cell.y * 2.0, 3.0);
  float val = id < 0.5 ? uBass : id < 1.5 ? uMid : uTreble;
  val = clamp(val * 1.6 + 0.05 * sin(uTime * 3.0 + h2(cell) * 6.0), 0.0, 1.0);
  float r = length(l);
  float ang = atan(l.x, l.y);
  vec3 col = uBg * 0.5;
  float face = fill(r - 0.42);
  col = mix(col, uBg * 0.9 + uB * 0.12, face);
  col += uC * 0.5 * smoothstep(0.03, 0.0, abs(r - 0.43));
  // Ticks along a 270 degree sweep
  float sweep = (ang + 2.356) / 4.712;
  float inSweep = step(0.0, sweep) * step(sweep, 1.0);
  float tick = step(0.82, fract(sweep * 20.0)) * inSweep * step(0.3, r) * step(r, 0.38);
  col = mix(col, mix(uB, uA, step(0.8, sweep)), tick * face);
  // Needle
  float na = -2.356 + val * 4.712;
  vec2 nd = rot(na) * vec2(l.x, l.y);
  float needle = fill(sdBox(vec2(nd.x, nd.y + 0.0), vec2(0.012, 0.0)) - 0.0);
  vec2 q = vec2(sin(na), cos(na));
  float along = dot(l, q);
  float perp = abs(dot(l, vec2(q.y, -q.x)));
  float line = smoothstep(0.012, 0.0, perp) * step(0.0, along) * step(along, 0.34);
  col = mix(col, uA + uC * hit(), line);
  col = mix(col, uC, fill(r - 0.03));
  return col + needle * 0.0;
}

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec3 col = uVariant == 0 ? gears(p)
    : uVariant == 1 ? pistons(p)
    : uVariant == 2 ? conveyor(p)
    : uVariant == 3 ? furnace(p)
    : uVariant == 4 ? hazard(p)
    : gauges(p);
  // Grit: grain, rust blotches, scanlines and a heavy vignette
  float grain = h2(gl_FragCoord.xy + floor(uTime * 24.0));
  float rust = noise(p * 6.0 + 3.0) * noise(p * 17.0);
  col *= 1.0 - uGrit * (0.28 * grain + 0.35 * rust);
  col *= 1.0 - 0.1 * uGrit * step(0.5, fract(gl_FragCoord.y * 0.5));
  col *= 1.0 - 0.9 * smoothstep(0.35, 1.0, length(p * vec2(0.8, 1.1)));
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`,
};
