import type { ItemPayload, NodeType, Payload, SectionPayload } from "./types";
import { flatten } from "./nodes";

export type Row = { key: string; before: string; after: string };

const head = (p: ItemPayload) => [p.title, p.subtitle, p.period].filter(Boolean).join(" | ");

/** The rows of a multi-part edit that actually changed. Rows pair up by position. */
export function changedRows(type: NodeType, before: Payload, after: Payload): Row[] {
  const rows: Row[] = [];
  if (type === "item") {
    const a = before as ItemPayload;
    const b = after as ItemPayload;
    rows.push({ key: "head", before: head(a), after: head(b) });
    for (let i = 0; i < Math.max(a.bullets.length, b.bullets.length); i++) {
      rows.push({ key: `b${i}`, before: a.bullets[i] ?? "", after: b.bullets[i] ?? "" });
    }
  } else if (type === "section") {
    const a = before as SectionPayload;
    const b = after as SectionPayload;
    rows.push({ key: "title", before: a.title, after: b.title });
    for (let i = 0; i < Math.max(a.items.length, b.items.length); i++) {
      rows.push({
        key: `i${i}`,
        before: a.items[i] ? flatten("item", a.items[i]) : "",
        after: b.items[i] ? flatten("item", b.items[i]) : "",
      });
    }
  }
  return rows.filter((r) => r.before !== r.after);
}

const pick = <T,>(keep: boolean, before: T | undefined, after: T | undefined) => (keep ? after : before);

/** Builds the payload for the rows the user kept; every other row stays as it was. */
export function mergeRows(type: NodeType, before: Payload, after: Payload, keep: Set<string>): Payload {
  if (type === "item") {
    const a = before as ItemPayload;
    const b = after as ItemPayload;
    const base = keep.has("head") ? b : a;
    const bullets: string[] = [];
    for (let i = 0; i < Math.max(a.bullets.length, b.bullets.length); i++) {
      const text = pick(keep.has(`b${i}`), a.bullets[i], b.bullets[i]);
      if (text !== undefined) bullets.push(text);
    }
    return { title: base.title, subtitle: base.subtitle, period: base.period, bullets };
  }
  const a = before as SectionPayload;
  const b = after as SectionPayload;
  const items: ItemPayload[] = [];
  for (let i = 0; i < Math.max(a.items.length, b.items.length); i++) {
    const item = pick(keep.has(`i${i}`), a.items[i], b.items[i]);
    if (item) items.push(item);
  }
  return { title: keep.has("title") ? b.title : a.title, items };
}
