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
uniform sampler2D uText;
uniform float uHasText;
uniform vec4 uTextRect;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec2 local(vec2 uv, vec4 r) { return (uv - r.xy) / (2.0 * r.zw) + 0.5; }
bool inside(vec2 t) { return t.x >= 0.0 && t.x <= 1.0 && t.y >= 0.0 && t.y <= 1.0; }
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

float imageLuma(vec2 t) {
  vec4 s = texture(uImage, t);
  return uImageAlpha > 0.5 ? s.a * (0.5 + 0.5 * luma(s.rgb)) : luma(s.rgb);
}

// Premultiplied color + alpha of the user image
vec4 imageLayer(vec2 uv) {
  vec2 t = local(uv, uImageRect);
  if (!inside(t)) return vec4(0.0);
  vec4 s = texture(uImage, t);
  float edge = min(min(t.x, 1.0 - t.x), min(t.y, 1.0 - t.y));
  // Photos fade out towards the edges (per axis, so the corners stay round instead of creased)
  vec2 fx = smoothstep(0.0, 0.12, t) * smoothstep(0.0, 0.12, 1.0 - t);
  float mask = uImageAlpha > 0.5 ? s.a : fx.x * fx.y;
  float boost = 0.85 + 0.35 * uPulse;

  if (uImageStyle == 1) {
    // Glowing outline (Sobel on brightness)
    vec2 d = uImageTexel * 1.5;
    float tl = imageLuma(t + vec2(-d.x, d.y)), tc = imageLuma(t + vec2(0.0, d.y)), tr = imageLuma(t + d);
    float ml = imageLuma(t - vec2(d.x, 0.0)), mr = imageLuma(t + vec2(d.x, 0.0));
    float bl = imageLuma(t - d), bc = imageLuma(t - vec2(0.0, d.y)), br = imageLuma(t + vec2(d.x, -d.y));
    float gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
    float gy = (tl + 2.0 * tc + tr) - (bl + 2.0 * bc + br);
    float e = smoothstep(0.1, 0.5, length(vec2(gx, gy))) * smoothstep(0.0, 0.05, edge);
    vec3 col = (uA * (1.0 + uBass * 1.5) + uC * e * 0.6) * e * boost;
    return vec4(col, e * 0.6);
  }

  float l = luma(s.rgb);
  vec3 col = uImageStyle == 0
    ? (l < 0.5 ? mix(uBg, uA, l * 2.0) : mix(uA, uC, l * 2.0 - 1.0))
    : s.rgb;
  return vec4(col * boost * mask, mask);
}

// Premultiplied text with palette glow; bands slip sideways on the beat
vec4 textLayer(vec2 uv) {
  float k = floor(uKick);
  float band = floor(uv.y * 40.0);
  float slip = step(0.75, hash(vec2(band, k))) * uPulse * uPulse;
  uv.x += (hash(vec2(band, k + 7.0)) - 0.5) * 0.06 * slip;

  vec2 t = local(uv, uTextRect);
  float a = inside(t) ? texture(uText, t).a : 0.0;
  float glow = 0.0;
  vec2 r = vec2(uRes.y / uRes.x, 1.0) * (0.008 + 0.01 * uPulse);
  for (int i = 0; i < 8; i++) {
    float ang = float(i) * 0.785398;
    vec2 tt = local(uv + vec2(cos(ang), sin(ang)) * r, uTextRect);
    if (inside(tt)) glow += texture(uText, tt).a;
  }
  glow /= 8.0;
  vec3 col = uC * a + uA * glow * (1.0 - a) * (1.0 + uBass);
  return vec4(col, max(a, glow * 0.5));
}

vec3 scene(vec2 uv) {
  vec3 col = texture(uSrc, uv).rgb;
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

  vec3 col = split > 0.0
    ? vec3(scene(uv + vec2(split, 0.0)).r, scene(uv).g, scene(uv - vec2(split, 0.0)).b)
    : scene(uv);

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
