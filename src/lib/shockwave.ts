/**
 * The shockwave glow that sweeps the canvas when the composer opens: one circle growing out of the composer,
 * drawn as four soft rings that tint the page, bend it like a lens and catch the light on its lines.
 * These are the numbers the shader draws with; the shader repeats the per-pixel ones.
 */

export type RGB = readonly [number, number, number];

/** The sweep's length, and the reduced-motion fade's. */
export const SWEEP_MS = 1000;
export const CALM_MS = 600;
/** How long after the composer starts opening the sweep starts. */
export const LAG_MS = 40;
/** The width of one ring, in CSS pixels; the glow spans about four of them. */
export const RING_W = 110;
/** The radius the glow starts at, around a point inside the canvas. */
export const START_R = 20;
/** The lens fades to nothing over this much of the canvas's edge, so the edges stay straight. */
export const EDGE_FADE = 56;

/** Red pen, inside out: vermilion, coral, apricot, cream. Light only; Redline has no dark mode. */
export const PEN_RINGS: readonly RGB[] = [[205, 80, 55], [240, 125, 95], [250, 175, 120], [250, 215, 170]];

/** Fast out of the composer, slowing as it nears the far edge. `t` runs 0 to 1. */
export const radiusAt = (t: number, start: number, grow: number) => start + (grow * (1 - 2 ** (-9 * t))) / (1 - 2 ** -9);

/** Up in the first 3%, then fading so it is gone by the end of the slow last stretch. */
export const intensityAt = (t: number) => Math.min(1, t / 0.03) * (1 - t ** 2.2);

/** Reduced motion: half strength, in place, in and out. */
export const calmIntensityAt = (t: number) => 0.5 * Math.sin(Math.PI * Math.min(1, Math.max(0, t)));

/** Where a point sits across the glow: 0 on the circle, one unit per ring width, outward positive. */
export const across = (distance: number, radius: number) => (distance - radius) / RING_W;

/** Each ring's pull at `x`; ring i is centred at i - 1.5, so neighbours blend softly. */
export const ringWeights = (x: number) => [0, 1, 2, 3].map((i) => Math.exp(-(((x - (i - 1.5)) / 0.8) ** 2)));

/** The colour at `x`: the rings' weighted average. */
export function ringColor(x: number, rings: readonly RGB[] = PEN_RINGS): RGB {
  const w = ringWeights(x);
  const sum = w.reduce((a, b) => a + b, 0);
  const c = [0, 1, 2].map((ch) => w.reduce((a, wi, i) => a + wi * rings[i][ch], 0) / sum);
  return [c[0], c[1], c[2]];
}

/** How much of the glow shows at `x`: one envelope over all four rings. */
export const ringAlpha = (x: number, intensity: number) => intensity * Math.exp(-1.1 * (x / 2) ** 2);

/** Light mode tints the page toward the ring, with a little extra light. Channels in 0..1. */
export function tint(page: RGB, ring: RGB, alpha: number): RGB {
  const k = alpha * 0.24;
  const c = [0, 1, 2].map((i) => Math.min(1, page[i] + (ring[i] - page[i]) * k + ring[i] * k * 0.2));
  return [c[0], c[1], c[2]];
}

/** The lens: how far, in CSS pixels, the page at `x` is pushed away from the centre. Stretched outside, squeezed inside. */
export function push(x: number) {
  const z = x * 0.75;
  return 7 * 2.33 * z * Math.exp(-z * z);
}

/** The lens's strength at `d` pixels from the canvas's nearest edge. */
export const edgeFade = (d: number) => Math.min(1, Math.max(0, d / EDGE_FADE));

/** How much a line glints at `x`. Light mode; a glint, not a redrawn border. */
export const glint = (x: number, intensity: number) => 0.3 * intensity * Math.exp(-1.4 * (x / 2) ** 2);

export type Box = { left: number; top: number; width: number; height: number };

/**
 * From a point inside the canvas the glow starts small around it and, by the end, has carried all four rings past
 * the canvas's farthest corner.
 */
export function sweepFor(origin: { x: number; y: number }, region: Box) {
  const corners = [[region.left, region.top], [region.left + region.width, region.top], [region.left, region.top + region.height], [region.left + region.width, region.top + region.height]];
  const far = Math.max(...corners.map(([x, y]) => Math.hypot(x - origin.x, y - origin.y)));
  return { start: START_R, grow: far + 2 * RING_W - START_R };
}

/** Reduced motion keeps the glow where it starts, a couple of rings out so it rings the composer. */
export const calmRadius = START_R + 2 * RING_W;
