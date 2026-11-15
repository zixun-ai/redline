export type InlinePart = { text: string; start: number; end: number; bold?: boolean; href?: string; placeholder?: boolean };

const TOKEN = /\*\*([^*\n]+)\*\*|\[待填写[^\]]*\]|https?:\/\/[^\s<>"'，。！？；（）【】]+|[A-Za-z0-9.!#$%&'+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}/g;

/** Small, text-only markup. Source offsets keep selections tied to the stored text. */
export function inlineParts(text: string, offset = 0, bold = false): InlinePart[] {
  const parts: InlinePart[] = [];
  const add = (value: string, start: number, extra: Partial<InlinePart> = {}) => {
    if (value) parts.push({ text: value, start: offset + start, end: offset + start + value.length, bold, ...extra });
  };
  let cursor = 0;
  for (const match of text.matchAll(TOKEN)) {
    const start = match.index!;
    add(text.slice(cursor, start), cursor);
    const value = match[0];
    if (match[1] !== undefined) parts.push(...inlineParts(match[1], offset + start + 2, true));
    else if (value.startsWith("[待填写")) add(value, start, { placeholder: true });
    else {
      const link = value.replace(/[.,;:!?)\]]+$/, "");
      let href: string | undefined;
      if (link.startsWith("http")) {
        try { const url = new URL(link); if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password) href = url.href; } catch { /* Invalid URLs remain plain text. */ }
      } else href = `mailto:${link}`;
      add(link, start, { href });
      add(value.slice(link.length), start + link.length);
    }
    cursor = start + value.length;
  }
  add(text.slice(cursor), cursor);
  return parts;
}

export const plainInline = (text: string) => inlineParts(text).map((part) => part.text).join("");
