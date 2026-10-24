/** Full-screen triangle from gl_VertexID, no vertex buffer needed. */
export const FULLSCREEN_VERT = /* glsl */ `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

/** Uniforms available to every GL mode (see ModeGL). */
export const SHARED_UNIFORMS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform vec2 uRes;
uniform float uTime;
uniform float uPhase;   // advances faster with bass
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform float uLevel;
uniform float uPulse;
uniform float uKick;   // beat counter, floor() changes on every beat
uniform int uVariant;
uniform vec3 uBg;
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;
uniform sampler2D uSpectrum; // 512x1, red = 0..1 magnitude
`;

/** Final pass: user image and text overlays, then CRT, glitch, grain and strobe. */
export const POST_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSrc;
/** Glow from the blurred mip levels of uSrc (2D modes only, needs mipmaps) */
uniform float uSrcGlow;
uniform vec2 uRes;
uniform float uTime;
uniform float uCrt;
uniform float uGrain;
uniform float uStrobe;
uniform float uGlitch;
uniform float uKick;
uniform float uPulse;
uniform float uBass;
uniform vec3 uBg;
uniform vec3 uA;
uniform vec3 uC;
uniform sampler2D uImage;
uniform float uHasImage;
uniform float uImageAlpha;
uniform int uImageStyle;
uniform vec4 uImageRect;  // center xy, half size zw (uv units)
uniform vec2 uImageTexel;
uniform float uImageLod;  // explicit mip level: implicit derivatives break in branches and glitch slices
uniform sampler2D uText;
uniform float uHasText;
uniform vec4 uTextRect;
uniform float uTextLod;
uniform sampler2D uPrev;  // previous output frame (trails, freezes, datamosh)
uniform int uFilter;      // see FILTERS in render/filters.ts
uniform float uFilterAmt;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec2 local(vec2 uv, vec4 r) { return (uv - r.xy) / (2.0 * r.zw) + 0.5; }
bool inside(vec2 t) { return t.x >= 0.0 && t.x <= 1.0 && t.y >= 0.0 && t.y <= 1.0; }
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

// Overlay textures are uploaded premultiplied (no dark fringes on logos); undo it for color math
vec3 straight(vec4 s) { return s.rgb / max(s.a, 1e-4); }

float imageLuma(vec2 t) {
  vec4 s = textureLod(uImage, t, uImageLod);
  return uImageAlpha > 0.5 ? s.a * (0.5 + 0.5 * luma(straight(s))) : luma(s.rgb);
}

// Premultiplied color + alpha of the user image
vec4 imageLayer(vec2 uv) {
  vec2 t = local(uv, uImageRect);
  if (!inside(t)) return vec4(0.0);
  vec4 s = textureLod(uImage, t, uImageLod);
  float edge = min(min(t.x, 1.0 - t.x), min(t.y, 1.0 - t.y));
  // Photos fade out towards the edges (per axis, so the corners stay round instead of creased)
  vec2 fx = smoothstep(0.0, 0.12, t) * smoothstep(0.0, 0.12, 1.0 - t);
  float mask = uImageAlpha > 0.5 ? s.a : fx.x * fx.y;
  float boost = 0.85 + 0.35 * uPulse;

  if (uImageStyle == 1) {
    // Glowing outline (Sobel on brightness)
    vec2 d = uImageTexel * 1.5 * exp2(uImageLod);
    float tl = imageLuma(t + vec2(-d.x, d.y)), tc = imageLuma(t + vec2(0.0, d.y)), tr = imageLuma(t + d);
    float ml = imageLuma(t - vec2(d.x, 0.0)), mr = imageLuma(t + vec2(d.x, 0.0));
    float bl = imageLuma(t - d), bc = imageLuma(t - vec2(0.0, d.y)), br = imageLuma(t + vec2(d.x, -d.y));
    float gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
    float gy = (tl + 2.0 * tc + tr) - (bl + 2.0 * bc + br);
    float e = smoothstep(0.1, 0.5, length(vec2(gx, gy))) * smoothstep(0.0, 0.05, edge);
    vec3 col = (uA * (1.0 + uBass * 1.5) + uC * e * 0.6) * e * boost;
    return vec4(col, e * 0.6);
  }

  vec3 rgb = straight(s);
  float l = luma(rgb);
  vec3 col = uImageStyle == 0
    ? (l < 0.5 ? mix(uBg, uA, l * 2.0) : mix(uA, uC, l * 2.0 - 1.0))
    : rgb;
  return vec4(col * boost * mask, mask);
}

float textAlpha(vec2 uv) {
  vec2 t = local(uv, uTextRect);
  return inside(t) ? textureLod(uText, t, uTextLod).a : 0.0;
}

// Premultiplied text with palette glow; bands slip sideways on the beat
vec4 textLayer(vec2 uv) {
  float k = floor(uKick);
  float band = floor(uv.y * 40.0);
  float slip = step(0.75, hash(vec2(band, k))) * uPulse * uPulse;
  uv.x += (hash(vec2(band, k + 7.0)) - 0.5) * 0.06 * slip;

  float a = textAlpha(uv);
  float glow = 0.0;
  vec2 r = vec2(uRes.y / uRes.x, 1.0) * (0.008 + 0.01 * uPulse);
  for (int i = 0; i < 8; i++) {
    float ang = float(i) * 0.785398;
    glow += textAlpha(uv + vec2(cos(ang), sin(ang)) * r);
  }
  glow /= 8.0;
  vec3 col = uC * a + uA * glow * (1.0 - a) * (1.0 + uBass);
  return vec4(col, max(a, glow * 0.5));
}

/** Mode image (with optional RGB split) under the overlays; overlays are sampled once. */
vec3 scene(vec2 uv, float split) {
  vec3 col = split > 0.0
    ? vec3(textureLod(uSrc, uv + vec2(split, 0.0), 0.0).r, textureLod(uSrc, uv, 0.0).g, textureLod(uSrc, uv - vec2(split, 0.0), 0.0).b)
    : textureLod(uSrc, uv, 0.0).rgb;
  if (uSrcGlow > 0.0) {
    vec3 near = max(textureLod(uSrc, uv, 2.5).rgb - uBg, 0.0);
    vec3 far = max(textureLod(uSrc, uv, 4.5).rgb - uBg, 0.0);
    col += (near * 1.6 + far * 3.0) * uSrcGlow;
  }
  if (uHasImage > 0.5) {
    vec4 l = imageLayer(uv);
    col = col * (1.0 - l.a) + l.rgb;
  }
  if (uHasText > 0.5) {
    vec4 l = textLayer(uv);
    col = col * (1.0 - l.a) + l.rgb;
  }
  return col;
}

float rnd(float a, float b) { return hash(vec2(a, b)); }

/** Full-screen filters, step 1: where to sample the picture. */
vec2 filterUv(vec2 uv, inout float split) {
  float a = uFilterAmt;
  float t = uTime;
  float k = floor(uKick);
  float aspect = uRes.x / uRes.y;

  if (uFilter == 1) {
    // Broken monitor: vertical roll, sync jitter, torn bands
    float slot = floor(t * 4.0);
    if (rnd(slot, 1.0) > 1.0 - 0.3 * a) uv.y = fract(uv.y + rnd(slot, 2.0) * 0.6 + t * 0.9);
    float line = floor(uv.y * uRes.y / 3.0);
    uv.x += (rnd(line, floor(t * 30.0)) - 0.5) * 0.006 * a;
    float band = floor(uv.y * 14.0);
    if (rnd(band, floor(t * 9.0)) > 1.0 - 0.18 * a) uv.x += (rnd(band + 9.0, floor(t * 9.0)) - 0.5) * 0.35 * a;
    split += (0.004 + 0.012 * uPulse) * a;
  } else if (uFilter == 2) {
    // VHS: wobble, line noise, a tracking band drifting up
    uv.x += sin(uv.y * 40.0 + t * 3.0) * 0.0012 * a;
    float line = floor(uv.y * uRes.y / 2.0);
    uv.x += (rnd(line, floor(t * 24.0)) - 0.5) * 0.002 * a;
    float band = 1.0 - smoothstep(0.0, 0.04, abs(uv.y - fract(t * 0.07)));
    uv.x += band * (rnd(line, floor(t * 30.0)) - 0.5) * 0.08 * a;
    split += 0.003 * a;
  } else if (uFilter == 3) {
    // Datamosh, step 1: whole macroblocks jump on the beat
    vec2 block = floor(uv * vec2(24.0, 14.0));
    if (rnd(dot(block, vec2(1.0, 57.0)), k) > 1.0 - 0.25 * a) {
      uv += (vec2(rnd(block.x, k + 3.0), rnd(block.y, k + 5.0)) - 0.5) * 0.06 * a;
    }
  } else if (uFilter == 4) {
    // Shake: kick punches zoom, offset and a little rotation
    float p = uPulse * uPulse;
    vec2 off = (vec2(rnd(k, 1.0), rnd(k, 2.0)) - 0.5) * 0.06 * a * p;
    float zoom = 1.0 + (0.1 * p + 0.04 * uBass) * a;
    float ang = (rnd(k, 3.0) - 0.5) * 0.08 * a * p;
    vec2 q = (uv - 0.5) * vec2(aspect, 1.0);
    q = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * q / zoom;
    uv = q / vec2(aspect, 1.0) + 0.5 + off;
    uv = 1.0 - abs(1.0 - abs(uv)); // mirror at the edges instead of smearing the border
    split += 0.006 * a * p;
  } else if (uFilter == 5) {
    // Kaleidoscope: mirrored wedges, slowly turning
    vec2 q = (uv - 0.5) * vec2(aspect, 1.0);
    float seg = 6.28318 / floor(4.0 + a * 8.0);
    float ang = mod(atan(q.y, q.x) + t * 0.15, seg);
    ang = abs(ang - seg * 0.5);
    q = vec2(cos(ang), sin(ang)) * length(q) * (1.0 - 0.08 * uPulse);
    uv = q / vec2(aspect, 1.0) + 0.5;
    uv = 1.0 - abs(1.0 - abs(uv));
  } else if (uFilter == 6) {
    // Pixelate: big pixels, even bigger on the kick
    float cell = mix(4.0, 28.0, a) * (1.0 + uPulse * 0.5);
    uv = (floor(uv * uRes / cell) + 0.5) * cell / uRes;
  }
  return uv;
}

/** Full-screen filters, step 2: change the colors. suv is the untouched screen position. */
vec3 filterColor(vec3 col, vec2 suv) {
  float a = uFilterAmt;
  float t = uTime;
  float k = floor(uKick);

  if (uFilter == 1) {
    float slot = floor(t * 4.0);
    // The picture freezes for a moment
    if (rnd(slot, 4.0) > 1.0 - 0.2 * a) col = textureLod(uPrev, suv, 0.0).rgb;
    // Corrupted blocks
    vec2 cell = floor(suv * vec2(32.0, 18.0));
    float g = rnd(dot(cell, vec2(1.0, 91.0)), floor(t * 6.0));
    if (g > 1.0 - 0.012 * a) {
      vec3 junk = mix(uA, vec3(0.0, 1.0, 0.3), step(0.7, fract(g * 13.0)));
      col = junk * hash(vec2(floor(suv.y * uRes.y / 2.0), g)) * 0.8;
    }
    // Rolling noise bar
    float bar = 1.0 - smoothstep(0.0, 0.05, abs(fract(suv.y * 0.5 - t * 0.35) - 0.5));
    col = mix(col, vec3(hash(suv * uRes + t)), bar * 0.5 * a);
    // Signal loss
    if (rnd(slot, 3.0) > 1.0 - 0.06 * a) col *= 0.05;
    col *= 0.9 + 0.1 * sin(suv.y * uRes.y * 1.5 + t * 50.0);
  } else if (uFilter == 2) {
    col = mix(col, vec3(luma(col)), 0.35 * a);
    col = col * vec3(1.05, 0.98, 0.9) + 0.03 * a;
    col += step(1.0 - 0.002 * a, hash(floor(suv * uRes / vec2(3.0, 1.0)) + floor(t * 30.0)));
    col *= 1.0 - 0.7 * a * dot(suv - 0.5, suv - 0.5);
  } else if (uFilter == 3) {
    // Datamosh, step 2: some blocks keep smearing the previous frame along a motion vector
    vec2 block = floor(suv * vec2(24.0, 14.0));
    vec2 mv = (vec2(rnd(block.x + block.y * 31.0, k), rnd(block.y + block.x * 17.0, k)) - 0.5) * 0.008;
    float mosh = step(1.0 - 0.6 * a, rnd(dot(block, vec2(7.0, 113.0)), k + 11.0));
    col = mix(col, textureLod(uPrev, suv + mv, 0.0).rgb, mosh * 0.85);
    col = floor(col * 12.0) / 12.0;
  } else if (uFilter == 6) {
    col = floor(col * 5.0 + 0.5) / 5.0;
  } else if (uFilter == 8) {
    // Trails: bright things leave a fading tail
    // The subtraction lets dim leftovers (8-bit rounding, grain) die out too
    col = max(col, textureLod(uPrev, suv, 0.0).rgb * min(0.9, 0.7 + 0.2 * a) - 0.015);
  } else if (uFilter == 9) {
    // Night vision
    col = vec3(0.15, 1.0, 0.25) * luma(col) * (1.4 + a);
    col += (hash(suv * uRes + fract(t) * 100.0) - 0.5) * 0.25 * a;
    col *= smoothstep(0.75, 0.45, length((suv - 0.5) * vec2(uRes.x / uRes.y, 1.0)));
    col *= 0.85 + 0.15 * sin(suv.y * uRes.y * 2.0);
  }
  return col;
}

/** Halftone print: one dot per cell, dot size from the cell's brightness. */
vec3 halftone(float split) {
  float cell = mix(6.0, 18.0, uFilterAmt) * (1.0 + 0.3 * uPulse);
  vec2 px = vUv * uRes;
  vec2 center = (floor(px / cell) + 0.5) * cell;
  vec3 col = scene(center / uRes, split);
  float r = sqrt(luma(col)) * cell * 0.62;
  return col * (1.0 - smoothstep(r - 1.0, r + 0.5, length(px - center))) * 1.4;
}

void main() {
  vec2 uv = vUv;
  vec2 c = uv * 2.0 - 1.0;

  if (uCrt > 0.5) {
    c *= 1.0 + 0.05 * dot(c, c);
    c /= 1.05;
    uv = c * 0.5 + 0.5;
    if (!inside(uv)) {
      outColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }
  }

  float split = uCrt > 0.5 ? 1.5 / uRes.x : 0.0;
  if (uGlitch > 0.0) {
    // Horizontal slices jump sideways with an RGB split, new pattern on every beat
    float k = floor(uKick);
    float band = floor(uv.y * 28.0);
    float on = step(0.6, hash(vec2(band, k)));
    uv.x += (hash(vec2(band + 3.1, k)) - 0.5) * 0.14 * uGlitch * on;
    split += 0.012 * uGlitch * on;
  }

  vec2 screenUv = vUv;
  uv = filterUv(uv, split);
  vec3 col = uFilter == 7 ? halftone(split) : scene(uv, split);
  col = filterColor(col, screenUv);

  if (uCrt > 0.5) {
    col *= 0.82 + 0.18 * sin(gl_FragCoord.y * 3.14159 * 0.5);
    col *= 1.15 - 0.6 * dot(c * 0.7, c * 0.7);
  }

  if (uGrain > 0.5) {
    col += (hash(gl_FragCoord.xy + fract(uTime * 7.0) * 311.0) - 0.5) * 0.12;
  }

  col = mix(col, vec3(1.0), uStrobe * 0.75);
  outColor = vec4(col, 1.0);
}
`;
