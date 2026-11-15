/** Where a line of text starts and ends on the page, top to bottom. */
export type Line = [top: number, bottom: number];

/** Every line of text in `root` that runs under a horizontal span, measured from `origin`. */
export function textLines(root: Element | null, origin: DOMRect, from: number, to: number): Line[] {
  const lines: Line[] = [];
  if (!root) return lines;
  const range = document.createRange();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim()) continue;
    range.selectNodeContents(node);
    for (const r of range.getClientRects()) {
      if (r.right - origin.left > from && r.left - origin.left < to) lines.push([r.top - origin.top, r.bottom - origin.top]);
    }
  }
  return lines;
}

/**
 * Moves an edge past every overlapping line. Staggered columns may form a longer run;
 * keep walking that run until the edge is clear in both columns.
 */
export function clearOfText(lines: Line[], edge: number, away: 1 | -1) {
  const cut = (y: number) => lines.filter(([top, bottom]) => top < y && y < bottom);
  for (let hit = cut(edge); hit.length; hit = cut(edge)) {
    const past = away > 0 ? Math.max(...hit.map(([, bottom]) => bottom)) : Math.min(...hit.map(([top]) => top));
    // Prefer a pixel of air, but preserve a real subpixel gap between lines.
    const clear = [past + away, past + away / 2, past].find((y) => !cut(y).length);
    if (clear !== undefined) return clear;
    edge = past;
  }
  return edge;
}
