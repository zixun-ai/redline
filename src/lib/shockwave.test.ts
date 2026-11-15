import { describe, expect, it } from "vitest";
import {
  PEN_RINGS, RING_W, START_R, across, calmIntensityAt, edgeFade, glint, intensityAt, push, radiusAt, ringAlpha, ringColor, sweepFor, tint,
} from "./shockwave";

describe("the shockwave", () => {
  it("grows fast out of its origin and slows as it reaches its full size", () => {
    expect(radiusAt(0, 20, 800)).toBe(20);
    expect(radiusAt(1, 20, 800)).toBeCloseTo(820, 6);
    // Most of the way there by a third of the time, the last stretch slow.
    expect(radiusAt(1 / 3, 20, 800)).toBeGreaterThan(20 + 800 * 0.85);
    expect(radiusAt(1, 20, 800) - radiusAt(0.9, 20, 800)).toBeLessThan(5);
  });

  it("comes up in the first 3% and is gone by the end", () => {
    expect(intensityAt(0)).toBe(0);
    expect(intensityAt(0.03)).toBeCloseTo(1 - 0.03 ** 2.2, 6);
    expect(intensityAt(0.5)).toBeLessThan(intensityAt(0.1));
    expect(intensityAt(1)).toBe(0);
  });

  it("with reduced motion, fades in and out at half strength", () => {
    expect(calmIntensityAt(0)).toBe(0);
    expect(calmIntensityAt(0.5)).toBeCloseTo(0.5, 6);
    expect(calmIntensityAt(1)).toBeCloseTo(0, 6);
  });

  it("is red pen on the inside, cream on the outside, blending between", () => {
    const inner = ringColor(-1.5);
    const outer = ringColor(1.5);
    expect(inner[0]).toBeLessThan(outer[0]);
    expect(inner[2]).toBeLessThan(outer[2]);
    // On the circle itself it sits between the second and third ring.
    const mid = ringColor(0);
    for (const ch of [0, 1, 2]) {
      expect(mid[ch]).toBeGreaterThan(Math.min(PEN_RINGS[1][ch], PEN_RINGS[2][ch]) - 1);
      expect(mid[ch]).toBeLessThan(Math.max(PEN_RINGS[1][ch], PEN_RINGS[2][ch]) + 1);
    }
  });

  it("shows most on its circle and fades out across about four ring widths", () => {
    expect(ringAlpha(0, 1)).toBe(1);
    expect(ringAlpha(2, 1)).toBeCloseTo(Math.exp(-1.1), 6);
    expect(ringAlpha(-4, 1)).toBeLessThan(0.02);
    expect(ringAlpha(0, 0.5)).toBe(0.5);
  });

  it("tints white paper toward the ring without ever going past white", () => {
    const white = [1, 1, 1] as const;
    const ring = PEN_RINGS[0].map((c) => c / 255) as unknown as readonly [number, number, number];
    const out = tint(white, ring, 1);
    expect(out[0]).toBeLessThanOrEqual(1);
    expect(out[2]).toBeLessThan(1);
    expect(tint(white, ring, 0)).toEqual([1, 1, 1]);
  });

  it("bends like a lens: stretched outside the circle, squeezed inside, no wider than the glow", () => {
    expect(push(0)).toBe(0);
    expect(push(1)).toBeGreaterThan(0);
    expect(push(-1)).toBeLessThan(0);
    expect(push(1)).toBeCloseTo(-push(-1), 9);
    // Peaks at a few pixels...
    const peak = Math.max(...Array.from({ length: 401 }, (_, i) => Math.abs(push(-4 + i / 50))));
    expect(peak).toBeGreaterThan(6);
    expect(peak).toBeLessThan(8);
    // ...and is gone a couple of rings out.
    expect(Math.abs(push(4))).toBeLessThan(0.1);
  });

  it("splits colour by at most one trace, under a pixel", () => {
    const peak = Math.max(...Array.from({ length: 401 }, (_, i) => Math.abs(push(-4 + i / 50))));
    expect(peak * 0.08).toBeLessThan(0.65);
  });

  it("lets the lens go flat at the canvas's edges", () => {
    expect(edgeFade(0)).toBe(0);
    expect(edgeFade(28)).toBe(0.5);
    expect(edgeFade(56)).toBe(1);
    expect(edgeFade(200)).toBe(1);
  });

  it("glints lines faintly, and only near the circle", () => {
    expect(glint(0, 1)).toBe(0.3);
    expect(glint(4, 1)).toBeLessThan(0.01);
  });

  it("measures positions across the glow in ring widths", () => {
    expect(across(500 + RING_W, 500)).toBe(1);
    expect(across(500, 500)).toBe(0);
  });

  it("starts small around its origin and carries every ring past the canvas's farthest corner", () => {
    const region = { left: 0, top: 0, width: 900, height: 700 };
    const { start, grow } = sweepFor({ x: 100, y: 100 }, region);
    expect(start).toBe(START_R);
    const far = Math.hypot(800, 600);
    expect(start + grow - 1.5 * RING_W).toBeGreaterThan(far);
  });
});
