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
uniform int uVariant;
uniform vec3 uBg;
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;
uniform sampler2D uSpectrum; // 512x1, red = 0..1 magnitude
`;

/** Final pass: optional CRT, grain and strobe on top of the mode's image. */
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

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec2 uv = vUv;
  vec3 col;

  if (uCrt > 0.5) {
    vec2 c = uv * 2.0 - 1.0;
    c *= 1.0 + 0.05 * dot(c, c);
    c /= 1.05;
    uv = c * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
      outColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }
    float ab = 1.5 / uRes.x;
    col = vec3(
      texture(uSrc, uv + vec2(ab, 0.0)).r,
      texture(uSrc, uv).g,
      texture(uSrc, uv - vec2(ab, 0.0)).b
    );
    float scan = 0.82 + 0.18 * sin(gl_FragCoord.y * 3.14159 * 0.5);
    col *= scan;
    col *= 1.15 - 0.6 * dot(c * 0.7, c * 0.7);
  } else {
    col = texture(uSrc, uv).rgb;
  }

  if (uGrain > 0.5) {
    col += (hash(gl_FragCoord.xy + fract(uTime * 7.0) * 311.0) - 0.5) * 0.12;
  }

  col = mix(col, vec3(1.0), uStrobe * 0.75);
  outColor = vec4(col, 1.0);
}
`;
