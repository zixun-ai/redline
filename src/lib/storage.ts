import type { Design, Doc, JobTarget, NodeStyle, Proposal, Thread, Version } from "./types";
import { validatePayload } from "./nodes";
import { BASICS_KEYS, FIRST_KEYS } from "./basics";
import { ALIGNS, DESIGN_DEFAULTS, DESIGN_IDS, FONT_SCALE } from "./design";

const object = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === "string");
const fields = (v: any, keys: string[]) => object(v) && keys.every(k => typeof v[k] === "string");
const id = (v: unknown) => typeof v === "string" && /^[a-zA-Z0-9_-]+$/.test(v);
const designKeys = ["template", "density", "accent", "fontScale"] as const;
const designValue = (k: string, v: unknown) => k === "accent" ? typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)
  : k === "fontScale" ? typeof v === "number" && Number.isFinite(v) && v >= FONT_SCALE.min && v <= FONT_SCALE.max
  : Object.hasOwn(DESIGN_IDS, k) && (DESIGN_IDS[k as keyof typeof DESIGN_IDS] as readonly unknown[]).includes(v);
/** Settings added later may be absent from older saves, which then get their defaults on load. */
const laterKeys = ["font", "latin", "heading", "margin", "pageLimit", "language", "photoShape"] as const;
const isDesign = (v: unknown): v is Design => object(v) && designKeys.every(k => designValue(k, v[k]))
  && laterKeys.every(k => v[k] === undefined || designValue(k, v[k]));

export function isDoc(v: unknown): v is Doc {
  if (!object(v) || !isDesign(v.design) || !object(v.resume)) return false;
  const r = v.resume;
  const ids = new Set(["basics"]);
  const node = (n: any) => object(n) && id(n.id) && !ids.has(n.id) && !!ids.add(n.id);
  return fields(r.basics, FIRST_KEYS) && BASICS_KEYS.every(k => r.basics[k] === undefined || typeof r.basics[k] === "string")
    && node(r.summary) && typeof r.summary.text === "string"
    && (r.photo === undefined || typeof r.photo === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(r.photo))
    && (r.nodeStyles === undefined || object(r.nodeStyles) && Object.values(r.nodeStyles).every(isNodeStyle))
    && (r.sectionPlacement === undefined || object(r.sectionPlacement) && Object.entries(r.sectionPlacement).every(([key, value]) => id(key) && ["side", "main"].includes(value as string)))
    && Array.isArray(r.sections) && r.sections.every((s: any) => node(s) && typeof s.title === "string"
      && (s.kind === "text" ? node(s.body) && typeof s.body.text === "string"
        : ["experience", "project", "education", "skill", "other"].includes(s.kind)
        && Array.isArray(s.items) && s.items.every((it: any) => node(it) && fields(it, ["title", "subtitle", "period"])
          && Array.isArray(it.bullets) && it.bullets.every((b: any) => node(b) && typeof b.text === "string"))));
}
const isNodeStyle = (s: unknown) => object(s)
  && (s.align === undefined || ALIGNS.includes(s.align))
  && ["bold", "italic"].every(k => s[k] === undefined || typeof s[k] === "boolean")
  && (s.color === undefined || s.color === "" || typeof s.color === "string" && /^#[0-9a-f]{6}$/i.test(s.color));

function isProposal(p: any): boolean {
  if (!fields(p, ["id", "why"]) || !["pending", "accepted", "rejected"].includes(p.status)) return false;
  if (p.kind === "style") return isDesign(p.beforeDesign) && object(p.patch)
    && Object.entries(p.patch).every(([k,v]) => designValue(k,v));
  if (p.kind === "nodeStyle") return id(p.targetId) && isNodeStyle(p.patch) && isNodeStyle(p.beforeStyle);
  if (p.kind !== "content" || !id(p.targetId) || !["basics", "summary", "section", "item", "bullet", "field"].includes(p.type)
    || typeof p.before !== "string" || !strings(p.unsupported)) return false;
  try { return !!validatePayload(p.type, JSON.parse(p.before), true) && !!validatePayload(p.type, p.after); } catch { return false; }
}
export const isThread = (t: any): t is Thread => fields(t, ["id", "label"])
  && (t.jobId === undefined || id(t.jobId))
  && id(t.targetId) && typeof t.resolved === "boolean" && Array.isArray(t.messages)
  && t.messages.every((m: any) => fields(m, ["id", "text"]) && ["user", "ai"].includes(m.role) && Number.isFinite(m.at)
    && (m.proposal === undefined || isProposal(m.proposal)) && (m.options === undefined || strings(m.options))
    && (m.quote === undefined || typeof m.quote === "string")
    && (m.quoteRange === undefined || object(m.quoteRange) && Number.isInteger(m.quoteRange.start)
      && Number.isInteger(m.quoteRange.end) && m.quoteRange.start >= 0 && m.quoteRange.end > m.quoteRange.start
      && typeof m.quote === "string" && m.quoteRange.end - m.quoteRange.start === m.quote.length)
    && ["failed", "fromJd"].every(k => m[k] === undefined || typeof m[k] === "boolean"));
export const isThreads = (v: unknown): v is Thread[] => Array.isArray(v) && v.every(isThread);
export const isVersions = (v: unknown): v is Version[] => Array.isArray(v) && v.every(x => fields(x, ["id", "name"]) && Number.isFinite(x.at) && isDoc(x.doc) && (x.job === undefined || isJob(x.job)));
const isJobMatch = (v: unknown): boolean => object(v) && (v.id === undefined || id(v.id)) && typeof v.summary === "string" && strings(v.missing)
  && (v.matched === undefined || strings(v.matched)) && (v.at === undefined || Number.isFinite(v.at));
export const isJob = (v: unknown): v is JobTarget | null => v === null || object(v) && isJobMatch(v)
  && (v.history === undefined || Array.isArray(v.history) && v.history.length <= 4 && v.history.every(isJobMatch));

export function styleStale(doc: Doc, p: Extract<Proposal, { kind: "style" | "nodeStyle" }>): boolean {
  if (p.kind === "style") return (Object.keys(p.patch) as (keyof Design)[]).some(k => doc.design[k] !== (p.beforeDesign[k] ?? DESIGN_DEFAULTS[k]));
  const current = doc.resume.nodeStyles?.[p.targetId] ?? {};
  return !sameNodeStyle(current, p.beforeStyle, p.patch);
}

export const sameNodeStyle = (a: NodeStyle, b: NodeStyle, keys: NodeStyle) => Object.keys(keys).every(key => {
  const k = key as keyof NodeStyle;
  const fallback = k === "bold" || k === "italic" ? false : "";
  return (a[k] ?? fallback) === (b[k] ?? fallback);
});

export function revertStyle(current: Design, p: Extract<Proposal, { kind: "style" }>): Design | null {
  const keys = Object.keys(p.patch) as (keyof Design)[];
  if (keys.some(k => current[k] !== p.patch[k])) return null;
  return { ...current, ...Object.fromEntries(keys.map(k => [k, p.beforeDesign[k] ?? DESIGN_DEFAULTS[k]])) };
}
