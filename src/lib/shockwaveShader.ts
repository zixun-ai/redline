/**
 * One fragment pass draws the whole glow. Positions are CSS pixels inside the canvas's visible region, y down.
 *
 * On the sheet, where the lens moves the page by a visible amount and a snapshot is ready, the pixel is the snapshot
 * read at its bent position (red and blue a little apart), tinted, and drawn opaque. Everywhere else, the plain desk
 * around the sheet included, the pass only tints: light mode's mix(page, ring, k) + ring·k·0.2 is exactly ring·1.2 laid over the live page at opacity k, so the
 * page underneath stays the real one.
 */
export const VERTEX = `#version 300 es
in vec2 corner;
void main() { gl_Position = vec4(corner, 0.0, 1.0); }`;

export const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 size;        // the region, CSS px
uniform float scale;      // device pixels per CSS px on this canvas
uniform vec2 center;
uniform float radius;
uniform float intensity;
uniform float lens;       // 1 bends, splits and glints; 0 only tints (reduced motion, or no snapshot)
uniform vec3 rings[4];    // 0..1, inside out
uniform vec4 page;        // the sheet, which is what the snapshot shows: x, y, w, h in CSS px
uniform vec3 desk;        // what a bent read past the sheet's edge finds
uniform sampler2D look;   // the sheet as it looks
uniform sampler2D lines;  // its lines and borders in white on black
uniform vec4 picked;      // the selected component's box; its ring is the live page's, so the picture doesn't have it
uniform vec2 pickedRing;  // that ring's width and its offset from the box, CSS px; width 0 when nothing is selected
uniform vec3 pen;
out vec4 color;

const float W = 110.0;

vec3 ring(float x) {
  vec3 c = vec3(0.0);
  float sum = 0.0;
  for (int i = 0; i < 4; i++) {
    float w = exp(-pow((x - (float(i) - 1.5)) / 0.8, 2.0));
    c += rings[i] * w;
    sum += w;
  }
  return c / sum;
}

bool onSheet(vec2 p) { return all(greaterThanEqual(p, page.xy)) && all(lessThanEqual(p, page.xy + page.zw)); }

vec3 sampleLook(vec2 p) {
  vec2 uv = (p - page.xy) / page.zw;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return desk;
  return texture(look, uv).rgb;
}

float sampleLines(vec2 p) {
  vec2 uv = (p - page.xy) / page.zw;
  float l = 0.0;
  if (all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)))) l = texture(lines, uv).g;
  // The sheet's own edge is a line too.
  vec2 d = min(abs(p - page.xy), abs(p - page.xy - page.zw));
  bool inX = p.x > page.x - 1.0 && p.x < page.x + page.z + 1.0;
  bool inY = p.y > page.y - 1.0 && p.y < page.y + page.w + 1.0;
  float edge = max(inY ? 1.0 - smoothstep(0.0, 1.0, d.x) : 0.0, inX ? 1.0 - smoothstep(0.0, 1.0, d.y) : 0.0);
  return max(l, edge);
}

// How much of the selection ring covers p: an outline round the box, its corners rounded like the CSS one.
float ringAt(vec2 p) {
  if (pickedRing.x <= 0.0) return 0.0;
  float off = pickedRing.y + pickedRing.x * 0.5;
  vec2 ext = picked.zw * 0.5 + off;
  float r = off + pickedRing.y * 2.0 / 3.0;
  vec2 q = abs(p - picked.xy - picked.zw * 0.5) - ext + r;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  return 1.0 - smoothstep(pickedRing.x * 0.5 - 0.5, pickedRing.x * 0.5 + 0.5, abs(d));
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, size.y * scale - gl_FragCoord.y) / scale;
  vec2 off = p - center;
  float dist = length(off);
  float x = (dist - radius) / W;
  float alpha = intensity * exp(-1.1 * pow(x / 2.0, 2.0));
  vec3 hue = ring(x);
  float k = alpha * 0.24;

  float edgeDist = min(min(p.x, p.y), min(size.x - p.x, size.y - p.y));
  float z = x * 0.75;
  float push = 7.0 * 2.33 * z * exp(-z * z) * intensity * lens * clamp(edgeDist / 56.0, 0.0, 1.0);

  // Off the sheet there is only desk, plain enough that bending it shows nothing; the live page stays visible there.
  if (abs(push) < 0.05 || !onSheet(p)) {
    if (k < 0.002) discard;
    color = vec4(min(hue * 1.2, vec3(1.0)) * k, k);
    return;
  }

  vec2 dir = dist > 0.0 ? off / dist : vec2(0.0);
  vec3 base = vec3(
    sampleLook(p - dir * push * 1.08).r,
    sampleLook(p - dir * push).g,
    sampleLook(p - dir * push * 0.92).b);
  base = mix(base, pen, ringAt(p - dir * push));
  vec3 lit = min(base + (hue - base) * k + hue * k * 0.2, vec3(1.0));
  float glint = 0.3 * intensity * exp(-1.4 * pow(x / 2.0, 2.0)) * sampleLines(p - dir * push);
  lit = mix(lit, mix(hue, vec3(1.0), 0.2), glint);
  color = vec4(lit, 1.0);
}`;
