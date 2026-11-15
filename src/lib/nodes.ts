import type {
  Basics, Item, ItemPayload, ListSection, NodeStyle, NodeType, Payload, Resume, Section, SectionPayload, TextPayload,
} from "./types";
import { BASICS, BASICS_KEYS, FIRST_KEYS, ENGLISH_BASICS, emptyBasics } from "./basics";

export const uid = (prefix = "n") =>
  `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;

/** Heading fields have stable ids derived from their item. */
export const titleId = (itemId: string) => `${itemId}__title`;
export const subtitleId = (itemId: string) => `${itemId}__subtitle`;

export type NodeRef = { type: NodeType; label: string };

const clip = (s: string, n = 14) => (s.length > n ? `${s.slice(0, n)}…` : s);

const bulletLabel = (index: number, english: boolean) => english ? `Bullet ${index + 1}` : `第 ${index + 1} 条`;

export function findNode(r: Resume, id: string, english = false): NodeRef | null {
  if (id === "basics") return { type: "basics", label: english ? "Personal information" : "个人信息" };
  if (id === r.summary.id) return { type: "summary", label: english ? "Summary" : "个人简介" };
  for (const s of r.sections) {
    if (s.id === id) return { type: "section", label: s.title || (english ? "Section" : "模块") };
    if (s.kind === "text") {
      if (s.body.id === id) return { type: "summary", label: `${clip(s.title || (english ? "Section" : "模块"))} · ${english ? "Body text" : "正文"}` };
      continue;
    }
    for (const it of s.items) {
      if (it.id === id) return { type: "item", label: `${s.title} · ${it.title || (english ? "Entry" : "条目")}` };
      if (titleId(it.id) === id) return { type: "field", label: `${clip(it.title || s.title)} · ${english ? "Title" : "标题"}` };
      if (subtitleId(it.id) === id) return { type: "field", label: `${clip(it.title || s.title)} · ${clip(it.subtitle)}` };
      const i = it.bullets.findIndex((b) => b.id === id);
      if (i >= 0)
        return { type: "bullet", label: `${clip(it.title || s.title)} · ${bulletLabel(i, english)}` };
    }
  }
  return null;
}

export type Crumb = { id: string; name: string };

/** The way down to a component, outermost first. */
export function pathTo(r: Resume, id: string, english = false): Crumb[] {
  for (const s of r.sections) {
    const section = { id: s.id, name: s.title || (english ? "Section" : "模块") };
    if (s.id === id) return [section];
    if (s.kind === "text") {
      if (s.body.id === id) return [section, { id, name: english ? "Body text" : "正文" }];
      continue;
    }
    for (const it of s.items) {
      const item = { id: it.id, name: clip(it.title || (english ? "Entry" : "条目")) };
      if (it.id === id) return [section, item];
      if (titleId(it.id) === id) return [section, item, { id, name: english ? "Title" : "标题" }];
      if (subtitleId(it.id) === id) return [section, item, { id, name: clip(it.subtitle) }];
      const i = it.bullets.findIndex((b) => b.id === id);
      if (i >= 0) return [section, item, { id, name: bulletLabel(i, english) }];
    }
  }
  const node = findNode(r, id, english);
  return node ? [{ id, name: node.label }] : [];
}

const itemPayload = (it: Item): ItemPayload => ({
  title: it.title, subtitle: it.subtitle, period: it.period, bullets: it.bullets.map((b) => b.text),
});

/** The model edits every module in one shape, so a text module goes out as a single untitled entry. */
const sectionPayload = (s: Section): SectionPayload => ({
  title: s.title,
  items: s.kind === "text" ? [{ title: "", subtitle: "", period: "", bullets: [s.body.text] }] : s.items.map(itemPayload),
});

/** Lines of prose as one passage, one paragraph per line. */
const prose = (lines: unknown[]) => lines.filter(isStr).map((l) => l.trim()).filter(Boolean).join("\n");

export function getPayload(r: Resume, id: string): Payload | null {
  if (id === "basics") return r.basics;
  if (id === r.summary.id) return { text: r.summary.text };
  for (const s of r.sections) {
    if (s.id === id) return sectionPayload(s);
    if (s.kind === "text") {
      if (s.body.id === id) return { text: s.body.text };
      continue;
    }
    for (const it of s.items) {
      if (it.id === id) return itemPayload(it);
      if (titleId(it.id) === id) return { text: it.title };
      if (subtitleId(it.id) === id) return { text: it.subtitle };
      const b = it.bullets.find((x) => x.id === id);
      if (b) return { text: b.text };
    }
  }
  return null;
}

/** A moved, unchanged row keeps its identity. A rewritten row must not inherit another row's comments. */
function mergeItem(old: Item | undefined, p: ItemPayload): Item {
  const unused = [...(old?.bullets ?? [])];
  return {
    id: old?.id ?? uid("it"),
    title: p.title, subtitle: p.subtitle, period: p.period,
    bullets: p.bullets.map((text) => {
      const index = unused.findIndex((b) => b.text === text);
      const match = index < 0 ? undefined : unused.splice(index, 1)[0];
      return { id: match?.id ?? uid("b"), text };
    }),
  };
}

function mergeItems(old: Item[], next: ItemPayload[]): Item[] {
  const unused = [...old];
  // Reserve complete matches first so a partial match cannot steal a moved item.
  const matches = next.map((p) => {
    const index = unused.findIndex((it) => JSON.stringify(itemPayload(it)) === JSON.stringify(p));
    return index < 0 ? undefined : unused.splice(index, 1)[0];
  });
  const header = (it: Item | ItemPayload) => JSON.stringify([it.title, it.subtitle, it.period]);
  return next.map((p, i) => {
    let match = matches[i];
    if (!match && (p.title || p.subtitle || p.period)) {
      const key = header(p);
      const candidates = unused.filter((it) => header(it) === key);
      const destinations = next.filter((it, j) => !matches[j] && header(it) === key);
      // A unique unchanged heading plus an unchanged bullet identifies the same experience.
      if (candidates.length === 1 && destinations.length === 1 && candidates[0].bullets.some((b) => p.bullets.includes(b.text))) {
        match = candidates[0];
        unused.splice(unused.indexOf(match), 1);
      }
    }
    return mergeItem(match, p);
  });
}

export function applyPayload(r: Resume, id: string, p: Payload): Resume {
  // A reply that leaves a field out keeps it; an empty string clears it.
  if (id === "basics") return { ...r, basics: { ...r.basics, ...(p as Partial<Basics>) } };
  if (id === r.summary.id) return { ...r, summary: { ...r.summary, text: (p as TextPayload).text } };
  return {
    ...r,
    sections: r.sections.map((s): Section => {
      if (s.kind === "text") {
        if (s.id === id) return { ...s, title: (p as SectionPayload).title, body: { ...s.body, text: prose((p as SectionPayload).items.flatMap((ip) => ip.bullets)) } };
        return s.body.id === id ? { ...s, body: { ...s.body, text: (p as TextPayload).text } } : s;
      }
      if (s.id === id) {
        const sp = p as SectionPayload;
        return { ...s, title: sp.title, items: mergeItems(s.items, sp.items) };
      }
      return {
        ...s,
        items: s.items.map((it) => {
          if (it.id === id) return mergeItem(it, p as ItemPayload);
          if (titleId(it.id) === id) return { ...it, title: (p as TextPayload).text };
          if (subtitleId(it.id) === id) return { ...it, subtitle: (p as TextPayload).text };
          if (!it.bullets.some((b) => b.id === id)) return it;
          return {
            ...it,
            bullets: it.bullets.map((b) => (b.id === id ? { ...b, text: (p as TextPayload).text } : b)),
          };
        }),
      };
    }),
  };
}

const flattenItem = (p: ItemPayload) =>
  [[p.title, p.subtitle, p.period].filter(Boolean).join(" | "), ...p.bullets.map((b) => `• ${b}`)].join("\n");

export function flatten(type: NodeType, p: Payload): string {
  if (type === "basics") return Object.values(p as Basics).filter(Boolean).join(" | ");
  if (type === "summary" || type === "bullet" || type === "field") return (p as TextPayload).text;
  if (type === "item") return flattenItem(p as ItemPayload);
  const s = p as SectionPayload;
  return [s.title, ...s.items.map(flattenItem)].join("\n");
}

export function resumeText(r: Resume): string {
  return [
    flatten("basics", r.basics),
    r.summary.text,
    ...r.sections.map((s) => flatten("section", sectionPayload(s))),
  ].join("\n");
}

/** Only the selected component can establish facts for its suggested rewrite. */
export function targetFacts(r: Resume, id: string): string {
  const node = findNode(r, id);
  const payload = getPayload(r, id);
  return node && payload ? flatten(node.type, payload) : "";
}

/** Context for a local request stops at its own experience; it never adds personal information. */
export function targetContext(r: Resume, id: string): string {
  for (const s of r.sections) {
    if (s.kind === "text") continue;
    for (const it of s.items) {
      if (it.id === id || titleId(it.id) === id || subtitleId(it.id) === id || it.bullets.some((b) => b.id === id)) {
        return `${s.title}\n${flattenItem(itemPayload(it))}`;
      }
    }
  }
  return targetFacts(r, id);
}

/** A quote edit must leave both surrounding spans intact. Old, ambiguous quotes need a new selection. */
export function quoteOnlyEdit(before: Payload, after: Payload, quote: string, range?: { start: number; end: number }): boolean {
  if (!quote || !("text" in before) || !("text" in after)) return false;
  const start = range?.start ?? before.text.indexOf(quote);
  const end = range?.end ?? start + quote.length;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > before.text.length) return false;
  if (before.text.slice(start, end) !== quote) return false;
  if (!range && before.text.lastIndexOf(quote) !== start) return false;
  const prefix = before.text.slice(0, start);
  const suffix = before.text.slice(end);
  return after.text.length >= prefix.length + suffix.length
    && after.text.startsWith(prefix) && after.text.endsWith(suffix);
}

export type EditableField = { key: string; label: string; value: string; multiline: boolean };

/** Explicit fields keep manual edits structured, including text that contains pipes or newlines. */
export function editableFields(type: NodeType, payload: Payload, english = false): EditableField[] {
  const field = (key: string, label: string, value: string, multiline = false): EditableField => ({ key, label, value, multiline });
  const itemFields = (item: ItemPayload, prefix = "", label = "") => [
    field(`${prefix}title`, `${label}${english ? "Title" : "标题"}`, item.title),
    field(`${prefix}subtitle`, `${label}${english ? "Subtitle" : "副标题"}`, item.subtitle),
    field(`${prefix}period`, `${label}${english ? "Dates" : "时间"}`, item.period),
    ...item.bullets.map((text, i) => field(`${prefix}bullets.${i}`, `${label}${bulletLabel(i, english)}`, text, true)),
  ];
  if (type === "basics") return BASICS.map(({ key, label }) => field(key, english ? ENGLISH_BASICS[key] : label, (payload as Basics)[key] ?? ""));
  if (type === "item") return itemFields(payload as ItemPayload);
  if (type === "section") {
    const section = payload as SectionPayload;
    return [field("title", english ? "Section title" : "模块标题", section.title), ...section.items.flatMap((item, i) => itemFields(item, `items.${i}.`, english ? `Entry ${i + 1} · ` : `条目 ${i + 1} · `))];
  }
  return [field("text", english ? "Content" : "内容", (payload as TextPayload).text, true)];
}

/** Only a known text field may change; array length and all other values stay intact. */
export function editPayloadField(type: NodeType, payload: Payload, key: string, value: string): Payload {
  if (!editableFields(type, payload).some((field) => field.key === key)) return payload;
  const copy = structuredClone(payload);
  const path = key.split(".");
  let at = copy as unknown as Record<string, unknown>;
  for (const part of path.slice(0, -1)) at = at[part] as Record<string, unknown>;
  at[path.at(-1)!] = value;
  return copy;
}

/** The fixed manual form identifies rows by their fields, so it can preserve their comments and formatting. */
export function applyManualPayload(r: Resume, id: string, input: Payload): Resume {
  const node = findNode(r, id);
  const before = getPayload(r, id);
  const payload = node && validatePayload(node.type, input, true);
  if (!node || !before || !payload) return r;
  const sameShape = (a: Payload, b: Payload) => editableFields(node.type, a).map((f) => f.key).join("|") === editableFields(node.type, b).map((f) => f.key).join("|");
  if (!sameShape(before, payload)) return r;
  const updateItem = (item: Item, value: ItemPayload): Item => ({
    ...item, title: value.title, subtitle: value.subtitle, period: value.period,
    bullets: item.bullets.map((bullet, i) => ({ ...bullet, text: value.bullets[i] })),
  });
  if (node.type !== "section" && node.type !== "item") return applyPayload(r, id, payload);
  return { ...r, sections: r.sections.map((section): Section => {
    if (section.id === id) {
      const value = payload as SectionPayload;
      if (section.kind === "text") return { ...section, title: value.title, body: { ...section.body, text: value.items[0].bullets[0] } };
      return { ...section, title: value.title, items: section.items.map((item, i) => updateItem(item, value.items[i])) };
    }
    return section.kind === "text" ? section : { ...section, items: section.items.map((item) => item.id === id ? updateItem(item, payload as ItemPayload) : item) };
  }) };
}

/** Merges a patch into one component's style; an undefined value clears that setting. */
export function setNodeStyle(r: Resume, id: string, patch: NodeStyle): Resume {
  const merged: NodeStyle = { ...r.nodeStyles?.[id], ...patch };
  const next = Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== undefined && v !== false && v !== ""));
  const nodeStyles = { ...r.nodeStyles };
  if (Object.keys(next).length) nodeStyles[id] = next;
  else delete nodeStyles[id];
  return { ...r, nodeStyles };
}

const isStr = (v: unknown): v is string => typeof v === "string";

function validItem(v: unknown): ItemPayload | null {
  const o = v as Partial<ItemPayload> | null;
  if (!o || !isStr(o.title) || !Array.isArray(o.bullets) || !o.bullets.every(isStr)) return null;
  return { title: o.title, subtitle: isStr(o.subtitle) ? o.subtitle : "", period: isStr(o.period) ? o.period : "", bullets: o.bullets };
}

/** Model output is untrusted: returns a clean payload of the expected shape, or null. */
export function validatePayload(type: NodeType, v: unknown, allowEmpty = false): Payload | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (type === "summary" || type === "bullet" || type === "field") {
    if (!isStr(o.text)) return null;
    return allowEmpty ? { text: o.text } : o.text.trim() ? { text: o.text.trim() } : null;
  }
  if (type === "item") return validItem(v);
  if (type === "section") {
    if (!isStr(o.title) || !Array.isArray(o.items)) return null;
    const items = o.items.map(validItem);
    return items.every(Boolean) ? { title: o.title, items: items as ItemPayload[] } : null;
  }
  if (!FIRST_KEYS.every((k) => isStr(o[k]))) return null;
  return Object.fromEntries(BASICS_KEYS.filter((k) => isStr(o[k])).map((k) => [k, o[k]])) as Basics;
}

/** Turns an imported, model-produced structure into a Resume with fresh ids. */
export function resumeFromImport(v: unknown): Resume | null {
  const o = v as { basics?: unknown; summary?: unknown; sections?: unknown } | null;
  if (!o || !o.basics || !Array.isArray(o.sections)) return null;
  const b = o.basics as Partial<Basics>;
  const str = (x: unknown) => (isStr(x) ? x : "");
  const kinds = ["experience", "project", "education", "skill", "other"];
  const sections: Section[] = [];
  for (const raw of o.sections as Record<string, unknown>[]) {
    if (!raw || !isStr(raw.title)) return null;
    if (raw.kind === "text") {
      // The prompt asks for paragraphs; a model may still answer with one string or with entries.
      const lines = Array.isArray(raw.paragraphs) ? raw.paragraphs
        : Array.isArray(raw.items) ? raw.items.flatMap((it) => validItem(it)?.bullets ?? []) : [raw.text];
      sections.push({ id: uid("s"), kind: "text", title: raw.title, body: { id: uid("txt"), text: prose(lines) } });
      continue;
    }
    if (!Array.isArray(raw.items)) return null;
    const items = raw.items.map(validItem);
    if (!items.every(Boolean)) return null;
    sections.push({
      id: uid("s"),
      kind: (kinds.includes(raw.kind as string) ? raw.kind : "experience") as ListSection["kind"],
      title: raw.title,
      items: (items as ItemPayload[]).map((ip) => mergeItem(undefined, ip)),
    });
  }
  return {
    basics: { ...emptyBasics(), ...Object.fromEntries(BASICS_KEYS.map((k) => [k, str(b[k])])) },
    summary: { id: uid("sum"), text: str(o.summary) },
    sections,
  };
}

/** The text with its whitespace gone, and where each remaining character sat in the original. */
function squeeze(text: string) {
  let flat = "";
  const at: number[] = [];
  for (let i = 0; i < text.length; i++) if (!/\s/.test(text[i])) { flat += text[i]; at.push(i); }
  return { flat, at };
}

/**
 * The page shows the summary under the name, and a model tends to file a closing 个人总结 there.
 * A summary the source only reaches after every module's title was a closing module, so it goes back
 * to the end, under the heading it had.
 */
export function moveClosingSummary(r: Resume, source: string): Resume {
  const text = r.summary.text.trim();
  const { flat, at } = squeeze(source);
  const start = text ? flat.indexOf(squeeze(text).flat.slice(0, 8)) : -1;
  const titles = r.sections.map((s) => squeeze(s.title).flat).filter(Boolean).map((t) => flat.indexOf(t)).filter((i) => i >= 0);
  if (start < 0 || !titles.length || titles.some((i) => i > start)) return r;
  const lines = source.slice(0, at[start]).split("\n");
  const sameLine = lines.pop()!.trim();
  const heading = (sameLine || lines.reverse().find((l) => l.trim()) || "").replace(/\s+/g, "").replace(/[：:]$/, "");
  // A short line that is also content, such as a skill, is the end of the module before, not a heading.
  const title = /^[一-龥]{2,8}$/.test(heading) && !resumeText(r).includes(heading) ? heading : "个人总结";
  return {
    ...r,
    summary: { ...r.summary, text: "" },
    sections: [...r.sections, { id: uid("s"), kind: "text", title, body: { id: uid("txt"), text } }],
  };
}
