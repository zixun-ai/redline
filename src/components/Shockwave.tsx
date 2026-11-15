import { useEffect, useRef, useState, type RefObject } from "react";
import { FRAGMENT, VERTEX } from "../lib/shockwaveShader";
import { CALM_MS, LAG_MS, PEN_RINGS, SWEEP_MS, calmIntensityAt, calmRadius, intensityAt, radiusAt, sweepFor } from "../lib/shockwave";
import { shootPage, type Shots } from "../lib/pageShot";
import type { Design, Resume } from "../lib/types";

type Props = {
  canvas: RefObject<HTMLDivElement>;
  page: RefObject<HTMLDivElement>;
  /** The node the composer opened on; each new one sends a sweep, restarting one still running. */
  target: string | null;
  resume: Resume;
  design: Design;
  zoom: number;
  /** A proposal is being previewed, so the page isn't the saved one and isn't worth a picture. */
  previewing: boolean;
};

type GL = {
  gl: WebGL2RenderingContext;
  u: Record<string, WebGLUniformLocation | null>;
  look: WebGLTexture;
  lines: WebGLTexture;
  uploaded: Shots | null;
};

/** Content waits this long after the last change before it is photographed, and then only when the browser is idle. */
const SETTLE_MS = 1000;
const UNIFORMS = ["size", "scale", "center", "radius", "intensity", "lens", "rings", "page", "desk", "look", "lines", "picked", "pickedRing", "pen"];

function setup(el: HTMLCanvasElement): GL | null {
  const gl = el.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
  if (!gl) return null;
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
    return s;
  };
  const program = gl.createProgram()!;
  gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "program");
  gl.useProgram(program);
  // One triangle that covers the whole canvas.
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const at = gl.getAttribLocation(program, "corner");
  gl.enableVertexAttribArray(at);
  gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
  const u = Object.fromEntries(UNIFORMS.map((n) => [n, gl.getUniformLocation(program, n === "rings" ? "rings[0]" : n)]));
  const texture = (unit: number) => {
    const t = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const look = texture(0);
  const lines = texture(1);
  gl.uniform1i(u.look, 0);
  gl.uniform1i(u.lines, 1);
  gl.uniform3fv(u.rings, PEN_RINGS.flatMap((c) => c.map((v) => v / 255)));
  return { gl, u, look, lines, uploaded: null };
}

function upload(g: GL, shots: Shots) {
  const { gl } = g;
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  for (const [unit, tex, src] of [[0, g.look, shots.look], [1, g.lines, shots.lines]] as const) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  }
  g.uploaded = shots;
}

const hex = (css: string) => (css.trim().match(/[0-9a-f]{2}/gi) ?? ["0", "0", "0"]).slice(0, 3).map((v) => parseInt(v, 16) / 255);
const rgb = (css: string) => (css.match(/[\d.]+/g) ?? ["0", "0", "0"]).slice(0, 3).map((v) => Number(v) / 255);

/**
 * The glow that sweeps the canvas when the composer opens. It draws only while it runs; at rest the canvas is hidden
 * and nothing is scheduled, apart from photographing the page once it settles after a change.
 */
export function Shockwave({ canvas, page, target, resume, design, zoom, previewing }: Props) {
  const [calm, setCalm] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setCalm(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  const ref = useRef<HTMLCanvasElement>(null);
  const gl = useRef<GL | null | undefined>(undefined);
  const shots = useRef<Shots | null>(null);
  const run = useRef<{ frame: number; timer: number } | null>(null);
  const zoomNow = useRef(zoom);
  zoomNow.current = zoom;

  const stop = () => {
    if (!run.current) return;
    clearTimeout(run.current.timer);
    cancelAnimationFrame(run.current.frame);
    run.current = null;
    if (ref.current) ref.current.style.display = "none";
  };
  useEffect(() => stop, []);

  // Photograph the page once it has settled; any change makes the last picture useless until the next one.
  useEffect(() => {
    shots.current = null;
    if (previewing || calm) return;
    let cancelled = false;
    let idle = 0;
    let timer = 0;
    const shoot = async () => {
      const el = page.current;
      if (!el || cancelled) return;
      try {
        const taken = await shootPage(el, zoom);
        if (!cancelled) shots.current = taken;
      } catch {
        // Without a picture the glow still tints; it just doesn't bend.
      }
    };
    // Taking the picture holds the main thread for a few dozen milliseconds, so it waits for the interface to be still:
    // a panel sliding or a card coming in would drop frames.
    const attempt = () => {
      if (cancelled) return;
      if (document.getAnimations().some((a) => a.playState === "running")) timer = window.setTimeout(attempt, 500);
      else idle = requestIdleCallback(shoot, { timeout: 1000 });
    };
    timer = window.setTimeout(attempt, SETTLE_MS);
    return () => { cancelled = true; clearTimeout(timer); cancelIdleCallback(idle); };
  }, [resume, design, zoom, previewing, page, canvas, calm]);

  // A new target restarts the sweep. Closing the composer lets a running one finish.
  useEffect(() => {
    if (!target) return;
    stop();
    const zoom = zoomNow.current;
    const timer = window.setTimeout(() => {
      const el = ref.current;
      const scroller = canvas.current;
      const sheet = page.current;
      const composer = scroller?.querySelector<HTMLElement>(".composer:not(.leaving)");
      if (!el || !scroller || !sheet || !composer) return;
      if (gl.current === undefined) {
        try { gl.current = setup(el); } catch { gl.current = null; }
      }
      const g = gl.current;
      if (!g) return;
      const shot = !calm && shots.current?.zoom === zoom ? shots.current : null;
      if (shot && g.uploaded !== shot) upload(g, shot);

      // The origin is the composer's edge facing its target, held to the page so it scrolls with it.
      const c = composer.getBoundingClientRect();
      const s0 = sheet.getBoundingClientRect();
      const from = { x: c.left + c.width / 2 - s0.left, y: (composer.classList.contains("above") ? c.bottom : c.top) - s0.top };
      const r0 = scroller.getBoundingClientRect();
      const sweep = sweepFor({ x: from.x + s0.left - r0.left, y: from.y + s0.top - r0.top }, { left: 0, top: 0, width: scroller.clientWidth, height: scroller.clientHeight });
      const length = calm ? CALM_MS : SWEEP_MS;
      const desk = rgb(getComputedStyle(scroller).backgroundColor);
      const pen = hex(getComputedStyle(scroller).getPropertyValue("--pen"));
      const node = sheet.querySelector<HTMLElement>(`[data-node="${CSS.escape(target)}"]`);
      const t0 = performance.now();

      const frame = () => {
        const t = (performance.now() - t0) / length;
        if (t >= 1 || !run.current) return stop();
        const region = scroller.getBoundingClientRect();
        const w = scroller.clientWidth;
        const h = scroller.clientHeight;
        const scale = Math.min(2, window.devicePixelRatio || 1);
        el.style.cssText = `display:block;left:${region.left}px;top:${region.top}px;width:${w}px;height:${h}px`;
        const bw = Math.round(w * scale);
        const bh = Math.round(h * scale);
        if (el.width !== bw || el.height !== bh) { el.width = bw; el.height = bh; }
        const sheetBox = sheet.getBoundingClientRect();
        const ox = sheetBox.left - region.left;
        const oy = sheetBox.top - region.top;
        const { gl: x, u } = g;
        x.viewport(0, 0, bw, bh);
        x.clearColor(0, 0, 0, 0);
        x.clear(x.COLOR_BUFFER_BIT);
        x.uniform2f(u.size, w, h);
        x.uniform1f(u.scale, bw / w);
        x.uniform2f(u.center, ox + from.x, oy + from.y);
        x.uniform1f(u.radius, calm ? calmRadius : radiusAt(t, sweep.start, sweep.grow));
        x.uniform1f(u.intensity, calm ? calmIntensityAt(t) : intensityAt(t));
        x.uniform1f(u.lens, shot ? 1 : 0);
        x.uniform4f(u.page, ox, oy, sheetBox.width, sheetBox.height);
        x.uniform3f(u.desk, desk[0], desk[1], desk[2]);
        x.uniform3f(u.pen, pen[0], pen[1], pen[2]);
        // The selection ring: 1.5px, 3px out, scaled with the page like everything on it.
        const picked = node?.isConnected ? node.getBoundingClientRect() : null;
        if (picked) x.uniform4f(u.picked, picked.left - region.left, picked.top - region.top, picked.width, picked.height);
        x.uniform2f(u.pickedRing, picked ? 1.5 * zoom : 0, 3 * zoom);
        x.drawArrays(x.TRIANGLES, 0, 3);
        run.current!.frame = requestAnimationFrame(frame);
      };
      run.current = { timer: 0, frame: requestAnimationFrame(frame) };
    }, LAG_MS);
    run.current = { timer, frame: 0 };
  }, [target, canvas, page, calm]);

  return <canvas ref={ref} className="shockwave chrome" aria-hidden="true" style={{ display: "none" }} />;
}
