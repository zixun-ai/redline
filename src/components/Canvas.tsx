import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type RefObject } from "react";
import { AlignCenter, AlignLeft, AlignRight, ArrowUp, Bold, ChevronRight, Italic, Loader2, Pencil, TextQuote, Type, X } from "lucide-react";
import { Toggle } from "@/components/ui/toggle";
import { useLanguage } from "@/lib/language";
import { cn, isFresh, scrollMotion } from "@/lib/utils";
import { IconButton } from "./IconButton";
import type { Align, Design, Doc, NodeStyle, NodeType, Payload, Resume, Thread } from "../lib/types";
import { editPayloadField, editableFields, findNode, flatten, getPayload, pathTo, validatePayload, type Crumb } from "../lib/nodes";
import { clearOfText, textLines } from "../lib/placement";
import { useLinger } from "../lib/useLinger";
import { ResumePage } from "./ResumePage";
import { Shockwave } from "./Shockwave";
import "./editor-upgrades.css";

export const A4_W = 793.7;
export const A4_H = 1122.5;

export const clampZoom = (z: number) => Math.min(1.4, Math.max(0.5, z));

type Rect = { top: number; left: number; right: number; bottom: number };
type Quote = { id: string; text: string; start: number; end: number };
type ManualDraft = { id: string; type: NodeType; before: string; payload: Payload; prose: boolean; select?: { key: string; start: number; end: number } };

/** Source offsets stay correct when RichText hides Markdown delimiters or a passage renders separate paragraphs. */
function textSegments(host: HTMLElement) {
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  const segments: { node: Text; start: number; end: number; visibleStart: number; visibleEnd: number }[] = [];
  let visible = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const token = node.parentElement?.closest<HTMLElement>("[data-source-start]");
    const paragraph = node.parentElement?.closest("p");
    const breaks = host.classList.contains("passage") ? Math.max(0, [...host.children].indexOf(paragraph!)) : 0;
    const start = token && host.contains(token) ? Number(token.dataset.sourceStart) : visible + breaks;
    const length = node.textContent?.length ?? 0;
    segments.push({ node: node as Text, start, end: start + length, visibleStart: visible, visibleEnd: visible + length });
    visible += length;
  }
  return segments;
}

function sourceOffset(host: HTMLElement, container: Node, offset: number, end = false): number {
  const range = document.createRange();
  range.selectNodeContents(host);
  range.setEnd(container, offset);
  const visible = range.toString().length;
  const segments = textSegments(host);
  const segment = end ? [...segments].reverse().find((s) => visible > s.visibleStart) ?? segments[0]
    : segments.find((s) => visible < s.visibleEnd) ?? segments.at(-1);
  return segment ? segment.start + Math.max(0, Math.min(segment.end - segment.start, visible - segment.visibleStart)) : 0;
}

function sourceRange(host: HTMLElement, start: number, end: number): Range | null {
  const segments = textSegments(host);
  const first = segments.find((s) => start >= s.start && start < s.end);
  const last = [...segments].reverse().find((s) => end > s.start && end <= s.end);
  if (!first || !last) return null;
  const range = document.createRange();
  range.setStart(first.node, start - first.start);
  range.setEnd(last.node, end - last.start);
  return range;
}

const CHIPS = {
  results: ["突出成果", "Highlight results"],
  concise: ["更精炼", "Make it concise"],
  quantify: ["加上量化数据", "Add verified metrics"],
  strengths: ["突出核心优势", "Highlight key strengths"],
  filler: ["去掉空话", "Remove filler"],
  professional: ["更专业", "Make it more professional"],
  shorter: ["更简短", "Make it shorter"],
  three: ["控制在三条以内", "Limit to three points"],
  reorder: ["调整顺序", "Reorder"],
  compact: ["更紧凑", "Make it more compact"],
  priority: ["按重要性排序", "Sort by importance"],
  unnecessary: ["去掉不必要的信息", "Remove unnecessary details"],
  rewrite: ["改写", "Rewrite"],
} as const;

const NODE_CHIPS: Record<NodeType, (keyof typeof CHIPS)[]> = {
  bullet: ["results", "concise", "quantify"],
  summary: ["concise", "strengths", "filler"],
  field: ["professional", "shorter"],
  item: ["results", "three", "reorder"],
  section: ["compact", "priority"],
  basics: ["unnecessary"],
};

const FORMAT_KEY = "redline.formatOpen";
const COMPOSER_EXIT_MS = 120;

const loadFormatOpen = () => {
  try { return localStorage.getItem(FORMAT_KEY) === "1"; } catch { return false; }
};

type Props = {
  resume: Resume;
  design: Design;
  /** The saved document, independent of the current proposal preview. */
  committedDoc?: Doc;
  threads: Thread[];
  selectedId: string | null;
  activeThreadId: string | null;
  /** The thread whose card is under the pointer in the comments panel. */
  hotThreadId: string | null;
  previewId: string | null;
  /** A style proposal is being previewed, which changes the whole page rather than one node. */
  previewWhole: boolean;
  busy: Set<string>;
  flashIds: string[];
  zoom: number;
  /** A new object each time something asks to be brought into view, even the same id twice. */
  reveal: { id: string } | null;
  onZoom: (zoom: number) => void;
  onSelect: (id: string | null) => void;
  onOpenThread: (t: Thread) => void;
  onComment: (targetId: string, text: string, quote?: string, quoteRange?: { start: number; end: number }) => boolean;
  onManualEdit: (id: string, payload: Payload) => void;
  onNodeStyle: (id: string, patch: NodeStyle) => void;
  onOverflow: (lines: number) => void;
  onHorizontalOverflow?: (targetIds: string[]) => void;
  onPageCount?: (pages: number) => void;
};

export function Canvas(p: Props) {
  const { english, t } = useLanguage();
  const { resume, design, committedDoc, threads, selectedId, zoom, reveal, onZoom, onOverflow, onHorizontalOverflow, onPageCount } = p;
  const committedResume = committedDoc?.resume ?? resume;
  const committedDesign = committedDoc?.design ?? design;
  const canvasRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const printRef = useRef<HTMLDivElement>(null);
  const paginationRef = useRef<HTMLDivElement>(null);
  const [rects, setRects] = useState<Record<string, Rect>>({});
  const [height, setHeight] = useState(A4_H);
  const [hovered, setHovered] = useState<string | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteRects, setQuoteRects] = useState<Rect[]>([]);
  const [manual, setManual] = useState<ManualDraft | null>(null);
  const [manualError, setManualError] = useState<"" | "changed" | "invalid">("");
  const [expandedPins, setExpandedPins] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [formatOpen, setFormatOpen] = useState(loadFormatOpen);
  const [cursor, setCursor] = useState<string | null>(null);
  const fromKeys = useRef(false);
  const zoomRef = useRef(zoom);
  const zoomAnchor = useRef<{ clientY: number; at: number } | null>(null);

  const open = useMemo(() => threads.filter((t) => !t.resolved), [threads]);
  const pinGroups = useMemo(() => {
    const groups = new Map<string, { thread: Thread; number: number }[]>();
    open.forEach((thread, i) => groups.set(thread.targetId, [...groups.get(thread.targetId) ?? [], { thread, number: i + 1 }]));
    return [...groups];
  }, [open]);
  const composerId = useLinger(selectedId, COMPOSER_EXIT_MS);
  const selected = composerId ? findNode(resume, composerId) : null;
  const draftKey = Object.keys(drafts).join(" ");

  const measure = useCallback(() => {
    const page = pageRef.current;
    if (!page) return;
    const base = page.getBoundingClientRect();
    const next: Record<string, Rect> = {};
    for (const id of new Set([...open.map((t) => t.targetId), ...(composerId ? [composerId] : []), ...(cursor ? [cursor] : []), ...draftKey.split(" ").filter(Boolean)])) {
      const r = page.querySelector(`[data-node="${id}"]`)?.getBoundingClientRect();
      if (!r) continue;
      next[id] = {
        top: (r.top - base.top) / zoom, left: (r.left - base.left) / zoom,
        right: (r.right - base.left) / zoom, bottom: (r.bottom - base.top) / zoom,
      };
    }
    setRects(next);
    const content = page.firstElementChild as HTMLElement;
    const h = Math.max(content.scrollHeight, A4_H);
    setHeight(h);
    const committed = printRef.current?.firstElementChild as HTMLElement | null;
    if (!committed) return;
    // Columns use the same fragmentation rules and printable height as @page. Dividing a continuous
    // height misses the space left behind when an experience moves intact to the following page.
    const fragments = [...paginationRef.current?.firstElementChild?.getClientRects() ?? []]
      .filter((rect) => rect.width > 0 && rect.height > 0);
    // The probe is deliberately hidden in print media; keep the last screen measurement there.
    if (fragments.length) {
      onPageCount?.(fragments.length);
      // Only the committed document controls export eligibility, never a hovered proposal.
      const excess = committedDesign.pageLimit ? fragments.slice(committedDesign.pageLimit) : [];
      onOverflow(excess.length ? Math.max(1, Math.ceil(excess.reduce((sum, rect) => sum + rect.height, 0) / (20 * committedDesign.fontScale))) : 0);
    }
    const paper = committed.getBoundingClientRect();
    const overflowing = [...committed.querySelectorAll<HTMLElement>("[data-node]")].filter((el) => {
      const bounds = el.getBoundingClientRect();
      return bounds.width > 0 && (bounds.left < paper.left - 1 || bounds.right > paper.right + 1 || el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1);
    });
    // Keep the smallest affected component, rather than every ancestor that also overflows.
    const ids = overflowing.filter((el) => !overflowing.some((child) => child !== el && el.contains(child))).map((el) => el.dataset.node!);
    if (!ids.length && committed.scrollWidth > committed.clientWidth + 1) ids.push("basics");
    onHorizontalOverflow?.(ids);
  }, [open, composerId, cursor, draftKey, zoom, onOverflow, onHorizontalOverflow, onPageCount, committedDesign.fontScale, committedDesign.pageLimit]);

  useLayoutEffect(measure, [measure, resume, design, committedResume, committedDesign]);
  useEffect(() => {
    const ro = new ResizeObserver(measure);
    if (pageRef.current) ro.observe(pageRef.current.firstElementChild as Element);
    if (printRef.current) ro.observe(printRef.current.firstElementChild as Element);
    if (paginationRef.current) ro.observe(paginationRef.current.firstElementChild as Element);
    return () => ro.disconnect();
  }, [measure]);

  useLayoutEffect(() => {
    // Delete only our transient highlight; other features may own registry entries.
    const registry = globalThis.CSS?.highlights;
    registry?.delete("redline-quote");
    const host = quote && quote.id === selectedId ? pageRef.current?.querySelector<HTMLElement>(`[data-node="${quote.id}"]`) : null;
    const payload = quote ? getPayload(resume, quote.id) : null;
    const range = host && payload && "text" in payload && payload.text.slice(quote!.start, quote!.end) === quote!.text
      ? sourceRange(host, quote!.start, quote!.end) : null;
    if (range && registry && typeof Highlight !== "undefined") {
      registry.set("redline-quote", new Highlight(range));
      setQuoteRects([]);
    } else {
      const base = pageRef.current?.getBoundingClientRect();
      setQuoteRects(range && base ? [...range.getClientRects()].map((r) => ({ top: r.top - base.top, left: r.left - base.left, right: r.right - base.left, bottom: r.bottom - base.top })) : []);
    }
    return () => { registry?.delete("redline-quote"); };
  }, [quote, selectedId, resume, design, zoom, height]);

  /** Scrolls a component to the upper third of the canvas, unless it's already in view. */
  const bringIntoView = useCallback((id: string, behavior: ScrollBehavior) => {
    const canvas = canvasRef.current;
    const r = pageRef.current?.querySelector(`[data-node="${id}"]`)?.getBoundingClientRect();
    if (!canvas || !r) return;
    const view = canvas.getBoundingClientRect();
    if (r.top >= view.top + 16 && r.bottom <= view.bottom - 16) return;
    canvas.scrollBy({ top: r.top - view.top - view.height * 0.3, behavior });
  }, []);

  useEffect(() => {
    if (reveal) bringIntoView(reveal.id, scrollMotion());
  }, [reveal, bringIntoView]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // React's onWheel is passive, and only a non-passive listener can stop the browser zooming the whole page.
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const z = zoomRef.current;
      const next = clampZoom(+(z * Math.exp(-Math.max(-10, Math.min(10, e.deltaY)) * 0.01)).toFixed(2));
      if (next === z || !pageRef.current) return;
      zoomAnchor.current = { clientY: e.clientY, at: (e.clientY - pageRef.current.getBoundingClientRect().top) / z };
      onZoom(next);
    };
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => canvas.removeEventListener("wheel", wheel);
  }, [onZoom]);

  useLayoutEffect(() => {
    zoomRef.current = zoom;
    const anchor = zoomAnchor.current;
    const canvas = canvasRef.current;
    if (!anchor || !canvas || !pageRef.current) return;
    canvas.scrollTop += pageRef.current.getBoundingClientRect().top + anchor.at * zoom - anchor.clientY;
    zoomAnchor.current = null;
  }, [zoom]);

  const backToPage = () => {
    if (!fromKeys.current) return;
    fromKeys.current = false;
    pageRef.current?.focus({ preventScroll: true });
  };
  const closeComposer = () => {
    setManual(null);
    setQuote(null);
    p.onSelect(null);
    backToPage();
  };
  const setDraft = (id: string, text: string) => setDrafts(({ [id]: _, ...rest }) => (text ? { ...rest, [id]: text } : rest));

  const beginManual = (id: string, placeholder?: HTMLElement) => {
    const node = findNode(committedResume, id);
    const payload = getPayload(committedResume, id);
    if (!node || !payload) return;
    const fields = editableFields(node.type, payload);
    const placeholderText = placeholder?.textContent ?? "";
    const field = placeholderText ? fields.find((f) => f.value.includes(placeholderText)) : undefined;
    const rawStart = Number(placeholder?.dataset.sourceStart);
    const start = field ? field.key === "text" && Number.isSafeInteger(rawStart) ? rawStart : field.value.indexOf(placeholderText) : 0;
    setManual({
      id, type: node.type, before: JSON.stringify(payload), payload: structuredClone(payload),
      prose: committedResume.sections.some((s) => s.id === id && s.kind === "text"),
      select: field ? { key: field.key, start, end: start + placeholderText.length } : undefined,
    });
    setManualError("");
    setQuote(null);
    p.onSelect(id);
  };

  const saveManual = () => {
    if (!manual) return;
    const now = getPayload(committedResume, manual.id);
    if (!now || JSON.stringify(now) !== manual.before) {
      setManualError("changed");
      return;
    }
    const value = validatePayload(manual.type, manual.payload, true);
    if (!value) { setManualError("invalid"); return; }
    p.onManualEdit(manual.id, value);
    closeComposer();
  };

  const pick = (e: MouseEvent) => {
    fromKeys.current = false;
    setCursor(null);
    const placeholder = (e.target as HTMLElement).closest<HTMLElement>("[data-placeholder]");
    const placeholderId = placeholder?.closest<HTMLElement>("[data-node]")?.dataset.node;
    if (placeholder && placeholderId) {
      e.preventDefault();
      beginManual(placeholderId, placeholder);
      return;
    }
    setManual(null);
    const sel = window.getSelection();
    const text = sel && !sel.isCollapsed ? sel.toString().trim() : "";
    if (text && sel) {
      const range = sel.getRangeAt(0);
      const anchor = range.commonAncestorContainer;
      const host = anchor instanceof Element ? anchor : anchor.parentElement;
      const node = host?.closest<HTMLElement>("[data-node]");
      const id = node?.dataset.node;
      const type = id ? findNode(resume, id)?.type : undefined;
      if (id && node && (type === "bullet" || type === "summary" || type === "field")) {
        const source = flatten(type, getPayload(resume, id)!);
        const from = sourceOffset(node, range.startContainer, range.startOffset);
        const raw = source.slice(from, sourceOffset(node, range.endContainer, range.endOffset, true));
        const start = from + raw.length - raw.trimStart().length;
        const selectedText = raw.trim();
        if (!selectedText) return;
        setQuote({ id, text: selectedText, start, end: start + selectedText.length });
        p.onSelect(id);
        return;
      }
    }
    setQuote(null);
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-node]");
    p.onSelect(el?.dataset.node ?? null);
  };
  const hover = (e: MouseEvent) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>("[data-node]")?.dataset.node ?? null;
    if (id !== hovered) setHovered(id);
  };

  const roam = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const ids = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-node]")].map((el) => el.dataset.node!);
      const at = cursor ? ids.indexOf(cursor) : -1;
      const next = ids[e.key === "ArrowDown" ? Math.min(at + 1, ids.length - 1) : Math.max(at - 1, 0)];
      if (!next) return;
      setCursor(next);
      bringIntoView(next, "auto");
    } else if (e.key === "Enter" && cursor) {
      e.preventDefault();
      fromKeys.current = true;
      setQuote(null);
      setManual(null);
      p.onSelect(cursor);
    } else if (e.key === "F2" && cursor) {
      e.preventDefault();
      fromKeys.current = true;
      beginManual(cursor);
    }
  };

  const box = composerId ? rects[composerId] : undefined;
  const quoted = quote && quote.id === composerId ? quote.text : null;
  const rule = (id: string | null, css: string) => (id ? `.page-live [data-node="${id}"]{${css}}` : "");
  const hot = threads.find((t) => t.id === p.hotThreadId && !t.resolved);
  // Pointing is a hairline at half strength; choosing is a firm line with the component's name on its corner.
  const highlight =
    rule(hot?.targetId ?? null, "outline:1px solid color-mix(in srgb,var(--pen) 45%,transparent);outline-offset:3px;border-radius:2px;background-color:rgba(180,53,31,.04);") +
    rule(hovered, "outline:1px solid color-mix(in srgb,var(--pen) 50%,transparent);outline-offset:3px;border-radius:2px;") +
    rule(selectedId, "outline:1.5px solid var(--pen);outline-offset:3px;border-radius:2px;") +
    rule(p.previewId, "background:rgba(31,107,69,.1);outline:1.5px solid var(--add);outline-offset:3px;border-radius:2px;") +
    p.flashIds.map((id) => rule(id, "animation:var(--flash);")).join("") +
    threads.filter((t) => p.busy.has(t.id)).map((t) => rule(t.targetId, "animation:reading 1.5s ease-in-out infinite;")).join("") +
    (cursor ? `@media screen{.page-live.roaming:focus [data-node="${cursor}"]{outline:1.5px solid var(--pen);outline-offset:3px;border-radius:2px;}}` : "");
  // Stepping with the keys, the component under the cursor wears its name, as a layer does in a design tool. A click
  // doesn't need it: the composer that opens names it in its breadcrumb, and a tag would cover the line above.
  const tagged = cursor && !selectedId ? cursor : null;
  const tagBox = tagged ? rects[tagged] : undefined;

  return (
    <>
    <div className="canvas" ref={canvasRef} onMouseDown={(e) => { if (e.target === e.currentTarget) p.onSelect(null); }}>
      <style>{highlight}</style>
      <Shockwave canvas={canvasRef} page={pageRef} target={selectedId} resume={resume} design={design} zoom={zoom}
        previewing={!!p.previewId || p.previewWhole} />
      <p className="sr-only chrome" aria-live="polite">{cursor ? findNode(resume, cursor, english)?.label : ""}</p>
      <div className="stage" style={{ width: A4_W * zoom, height: height * zoom }}>
        {/* While a card is hovered the page shows its proposal, and the left panel still shows the resume as saved.
            This says which one the page is. It stays at the top of the view, so it never covers the text it is about. */}
        {(p.previewId || p.previewWhole) && (
          <div className="preview-bar chrome">
            <span>{p.previewWhole ? t("预览整页样式", "Preview page layout") : t("预览修改", "Preview changes")}<i />{t("接受后才会生效", "Accept to apply")}</span>
          </div>
        )}
        <div
          className={cn("page page-live", cursor && "roaming")}
          ref={pageRef}
          style={{ transform: `scale(${zoom})` }}
          tabIndex={0}
          role="group"
          aria-label={t("简历。按上下方向键在组件间移动，按回车写批注，按 F2 直接改字", "Resume. Use the Up and Down arrows to move between sections. Press Enter to comment or F2 to edit.")}
          onClick={pick}
          onDoubleClick={(e) => {
            const id = (e.target as HTMLElement).closest<HTMLElement>("[data-node]")?.dataset.node;
            if (id) { window.getSelection()?.removeAllRanges(); beginManual(id); }
          }}
          onKeyDown={roam}
          onMouseMove={hover}
          onMouseLeave={() => setHovered(null)}
        >
          <ResumePage resume={resume} design={design} />
        </div>
        {quoteRects.map((r, i) => <span key={i} className="quote-selection chrome" aria-hidden="true" style={{ top: r.top, left: r.left, width: r.right - r.left, height: r.bottom - r.top }} />)}

        {tagged && tagBox && (
          <span className="sel-tag chrome" aria-hidden="true" style={{ top: (tagBox.top - ringReach()) * zoom, left: (tagBox.left - ringReach()) * zoom }}>
            {findNode(resume, tagged, english)?.label}
          </span>
        )}

        {Array.from({ length: Math.max(0, Math.ceil((height - 1) / A4_H) - 1) }, (_, i) => (
          <div key={i} className="page-end chrome" style={{ top: A4_H * (i + 1) * zoom }}><span>{t(`第 ${i + 1} 页参考线 · 浏览器实际按段落分页`, `Page ${i + 1} guide · The browser breaks pages at paragraphs`)}</span></div>
        ))}

        {pinGroups.map(([id, group]) => {
          const r = rects[id];
          if (!r) return null;
          const grouped = group.length > 2;
          const width = grouped ? 34 : group.length * 26 - 4;
          const left = Math.max(4, Math.min(r.right * zoom + 8, A4_W * zoom - width - 8));
          const arrival = group.some(({ thread }) => isFresh(thread.messages[0]?.at))
            ? open.filter((o) => isFresh(o.messages[0]?.at) && (rects[o.targetId]?.top ?? 0) < r.top).length
            : 0;
          return (
            <Fragment key={id}>
              {grouped ? <button
                className={cn("pin pin-group chrome", group.some(({ thread }) => thread.id === p.activeThreadId) && "on", group.some(({ thread }) => thread.id === p.hotThreadId) && "hot")}
                style={{ top: r.top * zoom - 11, left, animationDelay: arrival ? `${arrival * 40}ms` : undefined }}
                aria-label={t(`展开此组件的 ${group.length} 条批注`, `Show ${group.length} comments on this element`)} aria-expanded={expandedPins === id}
                onClick={() => setExpandedPins(expandedPins === id ? null : id)}>{group.length}</button>
                : group.map(({ thread, number }, i) => <button key={thread.id}
                  className={cn("pin chrome", thread.id === p.activeThreadId && "on", thread.id === p.hotThreadId && "hot")}
                  style={{ top: r.top * zoom - 11, left: left + i * 26, animationDelay: arrival ? `${arrival * 40}ms` : undefined }}
                  onClick={() => p.onOpenThread(thread)} aria-label={t(`打开第 ${number} 条批注`, `Open comment ${number}`)}>
                  {p.busy.has(thread.id) ? <Loader2 size={12} className="spin" /> : number}
                </button>)}
              {grouped && expandedPins === id && <div className="pin-list chrome" role="group" aria-label={t("此组件的批注", "Comments on this element")}
                style={{ top: r.top * zoom + 16, left: Math.max(4, Math.min(left, A4_W * zoom - 240 - 8)) }}
                onKeyDown={(e) => { if (e.key === "Escape") setExpandedPins(null); }}>
                {group.map(({ thread, number }) => <button key={thread.id} aria-label={t(`打开第 ${number} 条批注`, `Open comment ${number}`)}
                  onClick={() => { p.onOpenThread(thread); setExpandedPins(null); }}>
                  <b>{number}</b><span>{thread.messages.find((m) => m.role === "user")?.text || thread.label}</span>
                </button>)}
              </div>}
            </Fragment>
          );
        })}

        {Object.keys(drafts).map((id) => {
          const r = rects[id];
          if (!r || id === selectedId) return null;
          const pins = Math.min(2, open.filter((t) => t.targetId === id).length);
          return (
            <button
              key={id}
              className="draft-dot chrome"
              style={{ top: r.top * zoom + (pins ? 16 : -11), left: Math.max(4, Math.min(r.right * zoom + 8, A4_W * zoom - 24)) }}
              title={t("有没发出的批注", "Unsent comment")}
              aria-label={t("继续写没发出的批注", "Continue writing the unsent comment")}
              onClick={() => { setQuote(null); p.onSelect(id); }}
            />
          );
        })}

        {selected && box && composerId && (
          <Composer
            targetId={composerId}
            path={pathTo(resume, composerId, english)}
            quote={quoted}
            style={resume.nodeStyles?.[composerId] ?? {}}
            onStyle={(patch) => p.onNodeStyle(composerId, patch)}
            chips={(quoted ? (["rewrite", "concise", "professional"] as const) : NODE_CHIPS[selected.type]).map((key) => CHIPS[key][english ? 1 : 0])}
            box={box}
            zoom={zoom}
            stageHeight={height * zoom}
            canvas={canvasRef}
            leaving={!selectedId}
            draft={drafts[composerId] ?? ""}
            onDraft={(text) => setDraft(composerId, text)}
            manual={manual?.id === composerId ? manual : null}
            manualError={manualError === "changed"
              ? t("原文已变化。请取消后重新打开，避免覆盖新的内容。", "The original text has changed. Cancel and reopen the editor to keep the latest changes.")
              : manualError === "invalid" ? t("内容格式不正确，请检查后再保存。", "Check the format before saving.") : ""}
            onManual={() => beginManual(composerId)}
            onManualChange={(key, value) => { setManual((current) => current ? { ...current, payload: editPayloadField(current.type, current.payload, key, value) } : null); setManualError(""); }}
            onManualCancel={() => { setManual(null); setManualError(""); }}
            onManualSave={saveManual}
            formatOpen={formatOpen}
            onFormatOpen={(next) => {
              setFormatOpen(next);
              try { localStorage.setItem(FORMAT_KEY, next ? "1" : "0"); } catch { /* still works for this session */ }
            }}
            onPick={(id) => { setQuote(null); setManual(null); p.onSelect(id); }}
            onClose={closeComposer}
            onSend={(text) => {
              const sent = p.onComment(composerId, text, quoted ?? undefined, quote?.id === composerId ? { start: quote.start, end: quote.end } : undefined);
              if (sent) {
                setDraft(composerId, "");
                backToPage();
              }
              return sent;
            }}
          />
        )}
      </div>
    </div>
    <div className="print-page" ref={printRef}>
      <ResumePage resume={committedResume} design={committedDesign} />
    </div>
    <div className="pagination-probe" aria-hidden="true">
      <div className="pagination-columns" ref={paginationRef}>
        <ResumePage resume={committedResume} design={committedDesign} />
      </div>
    </div>
    </>
  );
}

type ComposerProps = {
  targetId: string;
  path: Crumb[];
  quote: string | null;
  style: NodeStyle;
  onStyle: (patch: NodeStyle) => void;
  chips: string[];
  box: Rect;
  zoom: number;
  stageHeight: number;
  canvas: RefObject<HTMLDivElement | null>;
  leaving: boolean;
  draft: string;
  onDraft: (text: string) => void;
  manual: ManualDraft | null;
  manualError: string;
  onManual: () => void;
  onManualChange: (key: string, value: string) => void;
  onManualCancel: () => void;
  onManualSave: () => void;
  formatOpen: boolean;
  onFormatOpen: (open: boolean) => void;
  onPick: (id: string) => void;
  onClose: () => void;
  onSend: (text: string) => boolean;
};

const COMPOSER_W = 340;
const GAP = 10;
const EDGE = 8;
/** How far the selection ring reaches past its node, in page pixels: a 3px offset plus its 1.5px width, which Chrome
 * rounds down to whole device pixels (1px on a 1x screen). */
const ringReach = () => 3 + Math.max(1, Math.floor(1.5 * devicePixelRatio)) / devicePixelRatio;

const FORMAT = "h-[26px] min-w-7 px-0 text-muted-foreground data-[state=on]:bg-pen-soft data-[state=on]:text-pen";

const TEXT_COLORS = [{ id: "#B4351F", label: ["红色", "Red"] }, { id: "#1D4F91", label: ["蓝色", "Blue"] }, { id: "#1F6B45", label: ["绿色", "Green"] }] as const;

const ALIGNS: { id: Align; label: readonly [string, string]; Icon: typeof AlignLeft }[] = [
  { id: "left", label: ["左对齐", "Align left"], Icon: AlignLeft },
  { id: "center", label: ["居中", "Center"], Icon: AlignCenter },
  { id: "right", label: ["右对齐", "Align right"], Icon: AlignRight },
];

function Composer({ targetId, path, quote, style, onStyle, chips, box, zoom, stageHeight, canvas, leaving, draft, onDraft, manual, manualError, onManual, onManualChange, onManualCancel, onManualSave, formatOpen, onFormatOpen, onPick, onClose, onSend }: ComposerProps) {
  const { english, t } = useLanguage();
  const rootRef = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const [above, setAbove] = useState(false);
  const [width, setWidth] = useState(COMPOSER_W);
  // How far the composer stands off its natural spot so its edge doesn't cut a line of text in half.
  const [shift, setShift] = useState(0);
  // The composer's left edge continues the ring's, which also keeps it clear of the column's first glyphs.
  const RING = ringReach();
  const left = Math.max(8, Math.min((box.left - RING) * zoom, A4_W * zoom - width - 8));

  useLayoutEffect(() => {
    const scroller = canvas.current;
    if (!scroller) return;
    const size = () => setWidth(Math.min(COMPOSER_W, Math.max(240, scroller.clientWidth - EDGE * 2)));
    size();
    const observer = new ResizeObserver(size);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [canvas]);
  useEffect(() => {
    if (leaving) return;
    if (manual) {
      const target = manual.select ? rootRef.current?.querySelector<HTMLTextAreaElement | HTMLInputElement>(`[data-edit-field="${manual.select.key}"]`) : rootRef.current?.querySelector<HTMLTextAreaElement | HTMLInputElement>("[data-edit-field]");
      target?.focus({ preventScroll: true });
      if (manual.select) target?.setSelectionRange(manual.select.start, manual.select.end);
    } else ref.current?.focus({ preventScroll: true });
    // Re-focus only when entering the form, not after each keystroke.
  }, [targetId, quote, leaving, !!manual]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const scroller = canvas.current;
    if (leaving || !root?.parentElement || !scroller) return;
    const stage = root.parentElement.getBoundingClientRect();
    const view = scroller.getBoundingClientRect();
    const viewTop = view.top - stage.top + EDGE;
    const viewBottom = view.bottom - stage.top - EDGE;
    const h = root.offsetHeight;
    const lines = textLines(root.parentElement.querySelector(".page-live"), stage, left, left + width);
    const below = clearOfText(lines, box.bottom * zoom + GAP, 1);
    const aboveEdge = clearOfText(lines, box.top * zoom - GAP, -1);
    const fitsBelow = below >= viewTop && below + h <= viewBottom;
    const fitsAbove = aboveEdge - h >= viewTop && box.top * zoom <= viewBottom;
    const flip = !fitsBelow && fitsAbove;
    setAbove(flip);
    setShift(flip ? box.top * zoom - GAP - aboveEdge : below - box.bottom * zoom - GAP);
    if (!fitsBelow && !flip) {
      scroller.scrollBy({ top: below < viewTop ? box.top * zoom - viewTop : below + h - viewBottom });
    }
  }, [targetId, box.top, box.bottom, left, width, zoom, formatOpen, quote, draft, leaving, canvas, !!manual, manualError]);

  const send = (value = draft) => {
    if (value.trim()) onSend(value.trim());
  };
  const keys = (e: KeyboardEvent) => {
    // Enter during IME composition confirms the candidate; it must not send.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) {
      e.preventDefault();
      send();
    }
  };

  const position = above ? { bottom: stageHeight - box.top * zoom + GAP + shift } : { top: box.bottom * zoom + GAP + shift };

  return (
    <div ref={rootRef} className={cn("composer chrome", above && "above", leaving && "leaving")} style={{ ...position, left, width }}
      onKeyDown={(e) => { if (e.key === "Escape" && !e.nativeEvent.isComposing) onClose(); }}>
      <div className="composer-head">
        <nav className="crumbs" aria-label={t("批注范围", "Comment scope")}>
          {path.map((c, i) => (
            <Fragment key={c.id}>
              {i > 0 && <ChevronRight size={12} aria-hidden="true" />}
              {i < path.length - 1 ? <button onClick={() => onPick(c.id)}>{c.name}</button> : <span aria-current="true">{c.name}</span>}
            </Fragment>
          ))}
        </nav>
        {!manual && <button className="manual-entry" onClick={onManual}><Pencil size={12} />{t("直接改字", "Edit text")}</button>}
        {!manual && <IconButton size="icon-sm" label={formatOpen ? t("收起格式", "Hide formatting") : t("展开格式", "Show formatting")} aria-expanded={formatOpen} className={formatOpen ? "text-pen" : undefined}
          onClick={() => onFormatOpen(!formatOpen)}><Type size={14} /></IconButton>}
        <IconButton size="icon-sm" label={t("取消选中", "Clear selection")} onClick={onClose}><X size={14} /></IconButton>
      </div>
      {formatOpen && !manual && (
        <div className="format" role="toolbar" aria-label={t("组件格式", "Text formatting")}>
          {ALIGNS.map(({ id, label: name, Icon }) => (
            <Toggle key={id} className={FORMAT} size="sm" title={name[english ? 1 : 0]} aria-label={name[english ? 1 : 0]} pressed={style.align === id}
              onPressedChange={(on) => onStyle({ align: on ? id : undefined })}><Icon size={15} /></Toggle>
          ))}
          <i />
          <Toggle className={FORMAT} size="sm" title={t("加粗", "Bold")} aria-label={t("加粗", "Bold")} pressed={!!style.bold} onPressedChange={(bold) => onStyle({ bold })}><Bold size={15} /></Toggle>
          <Toggle className={FORMAT} size="sm" title={t("斜体", "Italic")} aria-label={t("斜体", "Italic")} pressed={!!style.italic} onPressedChange={(italic) => onStyle({ italic })}><Italic size={15} /></Toggle>
          <i />
          <button className={style.color ? "color-dot" : "color-dot on"} title={t("默认颜色", "Default color")} aria-label={t("默认颜色", "Default color")} aria-pressed={!style.color} onClick={() => onStyle({ color: "" })}><span style={{ background: "#2a2a2a" }} /></button>
          {TEXT_COLORS.map(({ id, label: name }) => (
            <button key={id} className={style.color?.toUpperCase() === id ? "color-dot on" : "color-dot"} title={name[english ? 1 : 0]} aria-label={name[english ? 1 : 0]} aria-pressed={style.color?.toUpperCase() === id}
              onClick={() => onStyle({ color: id })}><span style={{ background: id }} /></button>
          ))}
        </div>
      )}
      {manual ? <>
        <p className="manual-hint">{t("直接修改原文 · 无需 API Key", "Edit text directly · No API key required")}</p>
        <div className="manual-fields">
          {editableFields(manual.type, manual.payload, english).filter((f) => !manual.prose || f.key === "title" || f.key === "items.0.bullets.0").map((field) => <label key={field.key}>
            <span>{manual.prose && field.key === "items.0.bullets.0" ? t("正文", "Body text") : field.label}</span>
            {field.multiline ? <textarea data-edit-field={field.key} rows={manual.type === "bullet" || manual.type === "summary" || manual.type === "field" ? 4 : 2}
              value={field.value} onChange={(e) => onManualChange(field.key, e.target.value)} />
              : <input data-edit-field={field.key} value={field.value} onChange={(e) => onManualChange(field.key, e.target.value)} />}
          </label>)}
        </div>
        {manualError && <p className="manual-error" role="alert">{manualError}</p>}
        <div className="manual-actions"><button onClick={onManualCancel}>{t("取消", "Cancel")}</button><button className="manual-save" onClick={onManualSave}>{t("保存修改", "Save changes")}</button></div>
      </> : <>
      {quote && <p className="quote"><TextQuote size={13} /><span>{quote}</span></p>}
      <textarea
        ref={ref}
        rows={1}
        aria-label={quote ? t("选中文字的修改要求", "Edit request for selected text") : t("批注修改要求", "Edit request")}
        value={draft}
        placeholder={quote ? t("这几个字想怎么改？", "How should the selected text change?") : t("想怎么改？", "What would you like to change?")}
        onChange={(e) => onDraft(e.target.value)}
        onKeyDown={keys}
      />
      <div className="composer-foot">
        <div className="chips">
          {chips.map((c) => <button key={c} onClick={() => send(draft.trim() ? `${draft.trim()}${t("，", ", ")}${c}` : c)}>{c}</button>)}
        </div>
        <button className="send" disabled={!draft.trim()} onClick={() => send()} aria-label={t("发送", "Send")}><ArrowUp size={15} /></button>
      </div>
      </>}
    </div>
  );
}
