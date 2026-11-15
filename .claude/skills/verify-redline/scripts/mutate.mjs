#!/usr/bin/env node
// Breaks one detail at a time in a copy of the app and checks that e2e/details.mjs, or a unit test, notices.
import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const work = `${root}/e2e/out/mut`;
const only = process.argv[2] ? new RegExp(process.argv[2]) : null;

// Each row: name, file, text that must occur exactly once, its replacement, and the check that should fail.
// A "unit: " check names a vitest test instead of a details.mjs line.
const M = [
  ["upgrade-generic-organization", "src/lib/check.ts", '!GENERIC_ORGANIZATION.test(org) && !evidence.includes(org)', '!evidence.includes(org)', "unit: does not label a generic organization as a new named institution"],
  ["upgrade-inline-offset", "src/lib/inline.ts", 'offset + start + 2, true', 'offset + start, true', "unit: renders emphasis and safe links while preserving source offsets"],
  ["upgrade-inline-credentials", "src/lib/inline.ts", ' && !url.username && !url.password', '', "unit: keeps placeholders intact, leaves unsafe URLs and HTML as plain text"],
  ["upgrade-job-history", "src/lib/jobs.ts", '.slice(0, 4)', '.slice(0, 3)', "unit: keeps five reviews and switches their summaries without losing the other recent reviews"],
  ["upgrade-text-export", "src/lib/export.ts", 'md ? value : plainInline(value)', 'value', "unit: exports a clean resume with Unicode text and all sections, without storage metadata"],
  ["template-priority", "src/lib/design.ts", 'priority: "education"', 'priority: "project"', "unit: prioritizes the chosen section without changing the document or dropping any module"],
  ["template-font", "src/lib/design.ts", 'templateFont === "serif" ? "var(--serif)"', 'templateFont === "serif" ? "var(--sans)"', "unit: uses a template font only when the user has not chosen one"],
  ["repair-empty-original", "src/lib/storage.ts", 'validatePayload(p.type, JSON.parse(p.before), true)', 'validatePayload(p.type, JSON.parse(p.before))', "unit: loads proposals whose original component was empty"],
  ["repair-salvage-threads", "src/lib/persistence.ts", 'state.threads = value.filter(isThread)', 'state.threads = []', "unit: recovers valid threads independently"],
  ["repair-style-prototype", "src/lib/storage.ts", 'Object.hasOwn(DESIGN_IDS, k)', 'k in DESIGN_IDS', "unit: isolates malformed style keys"],
  ["repair-quote-offset", "src/lib/nodes.ts", 'const start = range?.start ?? before.text.indexOf(quote);', 'const start = before.text.indexOf(quote);', "unit: checks the selected occurrence when a phrase repeats"],
  ["repair-contrast", "src/lib/design.ts", 'contrastOnWhite(hex) >= 4.5', 'contrastOnWhite(hex) >= 3', "unit: keeps filled headings readable at ordinary text sizes"],
  ["pdf-cancel-task", "src/lib/files.ts", 'signal?.addEventListener("abort", cancel, { once: true });', 'void cancel;', "unit: cancelling a pending PDF destroys its task once and releases its URL"],
  ["file-already-cancelled", "src/lib/files.ts", 'export async function fileToText(file: File, signal?: AbortSignal): Promise<string> {\n  signal?.throwIfAborted();', 'export async function fileToText(file: File, signal?: AbortSignal): Promise<string> {', "unit: does not start reading an already cancelled file"],
  ["base-outline", "src/styles.css", ".page-live [data-node] { outline: 1.5px solid transparent; outline-offset: 3px;", ".page-live [data-node] { outline-offset: 3px;", "a hover outline fades in from nothing"],
  ["roam-fades", "src/styles.css", ".page-live.roaming:focus [data-node] { transition: none; }", "", "arrow keys move the outline without a fade"],
  ["input-fades", "src/components/ui/input.tsx", "px-1.5 transition-[background-color] duration-100", "px-1.5 transition-colors duration-100", "a focused field turns ink at once"],
  ["red-focus", "src/styles.css", "--focus: var(--ink);", "--focus: var(--pen);", "a focused field turns ink at once"],
  ["control-shadow-black", "src/components/ui/input.tsx", 'py-1 shadow-xs"', 'py-1 shadow-sm"', "every shadow is the frame's warm stone"],
  ["theme-shadow-lost", "src/ui.css", "  --shadow-xs: 0 1px 2px 0 rgba(28, 25, 23, .06);\n", "", "every shadow is the frame's warm stone"],
  ["two-primaries", "src/App.tsx", 'variant={apiKey ? "default" : "outline"} onClick={exportPdf}', 'variant="default" onClick={exportPdf}', "without a key, the key is the one filled button"],
  ["msg-replays", "src/components/CommentPanel.tsx", 'cn("msg ai", isFresh(m.at) && "fresh", chain', 'cn("msg ai", "fresh", chain', "switching tabs doesn't replay them"],
  ["no-thread-stagger", "src/styles.css", "calc(var(--i, 0) * 40ms)", "0ms", "a batch of new cards arrives one after another"],
  ["no-pin-stagger", "src/components/Canvas.tsx", "left: left + i * 26, animationDelay: arrival ? `${arrival * 40}ms` : undefined", "left: left + i * 26, animationDelay: undefined", "and so do their pins, top to bottom"],
  ["toast-no-rekey", "src/App.tsx", 'key={storageFailed ? "storage" : shownNotice?.id} ', "", "a new notice replaces the old toast"],
  ["toast-ignores-pointer", "src/App.tsx", "if (!notice || noticeHeld || pageHidden) return;", "if (!notice || pageHidden) return;", "the toast waits while the pointer rests on it"],
  ["toast-ignores-hidden", "src/App.tsx", "if (!notice || noticeHeld || pageHidden) return;", "if (!notice || noticeHeld) return;", "and while the tab is in the background"],
  ["label-drift", "src/styles.css", ".seg-face { position: absolute; z-index: 2; inset: 2px;", ".seg-face { position: absolute; z-index: 2; inset: 0;", "the thumb redraws each label exactly over the real one"],
  ["face-lags", "src/styles.css", "transition: clip-path var(--base) var(--ease-out); }", "transition: clip-path 300ms var(--ease-out); }", "halfway through a switch the plate and the dark label"],
  ["toggle-moves", "src/styles.css", ".panel.left.docked .panel-head { flex-direction: column; gap: 0; padding: 10px;", ".panel.left.docked .panel-head { flex-direction: column; gap: 0; padding: 8px;", "the toggle stays where it was"],
  ["zoom-ignores-fold", "src/App.tsx", 'by === "fit" ? fitZoom(leftOpen, w) : autoZoom(leftOpen, w))', 'by === "fit" ? fitZoom(leftOpen, w) : autoZoom(true, w))', "the page takes the room"],
  ["dock-drops-focus", "src/components/LeftPanel.tsx", 'setTab(id); refocus.current = "tab";', "setTab(id);", "and hands focus to it"],
  ["tooltip-on-refocus", "src/components/LeftPanel.tsx", "if (e.currentTarget.dataset.quiet !== undefined) e.preventDefault();", "", "focus goes to the toggle without opening its tooltip"],
  ["fold-forgotten", "src/App.tsx", 'useEffect(() => { save(LEFT_KEY, leftOpen ? "" : "closed"); }, [leftOpen]);', "", "the fold survives a reload"],
  ["manual-zoom-lost", "src/App.tsx", '(typeof by === "number" ? by :', '(typeof by === "number" && false ? by :', "a zoom the user picked stays"],
  ["edge-always-on", "src/styles.css", ".panel-head { flex: none; padding: 8px 10px; transition: box-shadow var(--fast); }", ".panel-head { flex: none; padding: 8px 10px; transition: box-shadow var(--fast); box-shadow: 0 1px 0 var(--line); }", "with nothing scrolled under the tabs"],
  ["edge-never-on", "src/styles.css", ".panel-head:has(~ [data-scrolled]:not([hidden])) { box-shadow: 0 1px 0 var(--line); }", "", "scrolling the form draws it"],
  ["edge-timeline", "src/styles.css", ".panel-head:has(~ [data-scrolled]:not([hidden])) { box-shadow: 0 1px 0 var(--line); }", ".panel { timeline-scope: --under-head; } .form, .thread-list { scroll-timeline: --under-head block; } .panel-head { animation: edge linear both; animation-timeline: --under-head; animation-range: 0px 12px; } @keyframes edge { from { box-shadow: 0 1px 0 transparent; } to { box-shadow: 0 1px 0 var(--line); } }", "and a tab that starts at the top has none"],
  ["tooltip-prints", "src/resume.css", "[data-radix-popper-content-wrapper] { display: none !important; }", "", "an open tooltip never prints"],
  ["composer-cuts-lines", "src/lib/placement.ts", "  for (let hit = cut(edge); hit.length; hit = cut(edge)) {", "  for (let hit = cut(edge); false; hit = cut(edge)) {", "its edge runs through no line of text"],
  ["composer-no-air", "src/lib/placement.ts", "[past + away, past + away / 2, past]", "[past]", "unit: moves an edge that cuts a line to just past it"],
  ["composer-skips-boundary", "src/lib/placement.ts", "const clear = [past + away, past + away / 2, past].find((y) => !cut(y).length);", "const clear = [past + away, past + away / 2].find((y) => !cut(y).length); if (clear === undefined) return clearOfText(lines, past + away, away);", "unit: takes the boundary when the next line starts"],
  ["composer-first-cut-only", "src/lib/placement.ts", "    const past = away > 0 ?", "    return hit[0][1] + away; const past = away > 0 ?", "unit: clears every line the edge cuts at once"],
  ["composer-drifts", "src/lib/placement.ts", "    edge = past;", "    return edge;", "unit: finds a clear edge beyond the full staggered run"],
  ["composer-off-ring", "src/components/Canvas.tsx", "Math.min((box.left - RING) * zoom,", "Math.min(box.left * zoom,", "its left edge continues the selection ring's"],
  ["tab-remounts", "src/components/LeftPanel.tsx", '<ContentForm tabId={`${tabsId}-content`}', '<ContentForm key={tab} tabId={`${tabsId}-content`}', "coming back to a tab finds it where it was left"],
  ["reveal-misses-tab", "src/components/LeftPanel.tsx", "}, [selectedId, open, collapsed, hidden]);", "}, [selectedId, open, collapsed]);", "selecting on the page while another tab shows"],
  ["reveal-while-hidden", "src/components/LeftPanel.tsx", "reveal.current && !hidden ?", "reveal.current ?", "selecting on the page while another tab shows"],
  ["edge-sees-hidden", "src/styles.css", ".panel-head:has(~ [data-scrolled]:not([hidden]))", ".panel-head:has(~ [data-scrolled])", "and a tab that starts at the top has none"],
  ["zoom-ignores-window", "src/App.tsx", 'window.addEventListener("resize", change);', "", "the layout's zoom follows the window too"],
  ["fit-pins", "src/App.tsx", 'setZoomBy(Math.abs(zoom - 1) < 0.005 ? "fit" : 1)', 'setZoomBy(Math.abs(zoom - 1) < 0.005 ? zoomFor("fit", leftOpen, widths) : 1)', "fitting the width keeps fitting it"],
  ["zoom-guessed", "src/App.tsx", '(typeof by === "number" ? by :', '(typeof by === "number" && by !== autoZoom(true, w) && by !== autoZoom(false, w) ? by :', "and stays even when it matches the layout's own"],
  ["email-half-row", "src/styles.css", ".prop { display: grid; grid-template-columns: 76px", ".prop { display: grid; grid-template-columns: 160px", "a full email address shows whole"],
  ["field-touches-edge", "src/styles.css", ".form [data-form] { scroll-margin-block: 12px; }", "", "a field brought into view stops short of the panel's edge"],
  ["guide-orphan", "src/styles.css", "counter-increment: step; word-break: keep-all; overflow-wrap: anywhere; }", "counter-increment: step; }", "the first guide step wraps at its comma"],
  ["closing-stays", "src/lib/nodes.ts", "if (start < 0 || !titles.length || titles.some((i) => i > start)) return r;", "return r;", "unit: goes back to the end, under the heading it had"],
  ["closing-any-module", "src/lib/nodes.ts", "titles.some((i) => i > start)", "titles.every((i) => i > start)", "unit: leaves it where it is when any module comes after it"],
  ["closing-no-titles", "src/lib/nodes.ts", "if (start < 0 || !titles.length ||", "if (start < 0 ||", "unit: leaves it where it is when any module comes after it"],
  ["closing-spaced-heading", "src/lib/nodes.ts", '.replace(/\\s+/g, "").replace(/[：:]$/, "")', '.replace(/[：:]$/, "")', "unit: takes its heading from the same line, or from a letter-spaced one"],
  ["closing-content-heading", "src/lib/nodes.ts", ' && !resumeText(r).includes(heading) ? heading', " ? heading", "unit: is called 个人总结 when the line before it is the last module's content"],
  ["closing-not-wired", "src/lib/deepseek.ts", "return moveClosingSummary(resume, text);", "return resume;", "flow closing-summary: the review lists 个人总结 last and leaves 个人简介 empty, when the model files it as the summary"],
  ["prompt-no-text", "src/lib/deepseek.ts", '其他成段的文字，比如写在末尾的个人总结、自我评价，整理成 kind 为 text 的模块，标题用原文的。', "", "unit: is asked for as a text module"],
  ["text-import-dropped", "src/lib/nodes.ts", '    if (raw.kind === "text") {\n      // The prompt', '    if (raw.kind === "text" && false) {\n      // The prompt', "unit: import in place, whether the model answers"],
  ["text-round-trip", "src/lib/nodes.ts", "prose((p as SectionPayload).items.flatMap((ip) => ip.bullets))", "(p as SectionPayload).items.flatMap((ip) => ip.bullets).join(\"\")", "unit: go to the model as one entry and come back as paragraphs"],
  ["text-unsaved", "src/lib/storage.ts", 's.kind === "text" ? node(s.body) && typeof s.body.text === "string"', 's.kind === "text" ? true', "unit: are saved, checked before export and offered for tailoring"],
  ["text-unchecked", "src/lib/check.ts", "      check(section.body.id, section.body.text);\n", "", "unit: are saved, checked before export and offered for tailoring"],
  ["text-untailored", "src/lib/deepseek.ts", "      list.push({ id: s.body.id, label: s.title, text: s.body.text });\n", "", "unit: are saved, checked before export and offered for tailoring"],
  ["dialog-eases-width", "src/components/ui/dialog.tsx", "shadow-[var(--shadow-l)] transition-none ease-[var(--ease-out)]", "shadow-[var(--shadow-l)] ease-[var(--ease-out)]", "the dialog widens into the review in one step"],
  ["text-unrendered", "src/components/ResumePage.tsx", "        ? section.body.text && (", "        ? false && (", "flow closing-summary: a 个人总结 added from the panel shows its text at the end of the page"],
  ["decision-leaves-open", "src/App.tsx", 'resolved: status === "pending" ? false : t.resolved || !left', 'resolved: status === "pending" ? false : t.resolved', "flow resolve: accepting a comment's only suggestion resolves it"],
  ["held-card-vanishes", "src/components/CommentPanel.tsx", "t.resolved === showResolved || t.id === heldId", "t.resolved === showResolved", "flow resolve: the decided card stays where it was, marked resolved"],
  ["held-forever", "src/App.tsx", "setHeld((h) => (h === t.id ? h : null));", "", "flow resolve: moving on to the next comment puts the decided card away"],
  ["busy-resolves", "src/App.tsx", "const left = requests.current.has(threadId) || messages.some(", "const left = messages.some(", "flow resolve: a comment DeepSeek is still answering stays open"],
  ["reply-stays-resolved", "src/App.tsx", "reopen(threadId);", "", "flow resolve: replying reopens it"],
  ["undo-stays-resolved", "src/App.tsx", 'status === "pending" ? false :', 'status === "pending" ? t.resolved :', "flow resolve: undoing the decision reopens it in place"],
  ["check-spares-held", "src/App.tsx", "setHeld((h) => (h === threadId ? null : h));", "", "flow resolve: the check puts even the card just worked on away at once"],
  ["resolved-hint-gone", "src/components/CommentPanel.tsx", '<p className="hint">接受或拒绝方案后，批注会移到这里。<br />也可以点批注右上角的 ✓。</p>', "", "the 已解决 tab says how a comment gets there"],
  ["batch-unannounced", "src/App.tsx", "notify(`已接受 ${count} 处，批注移到了「已解决」`, () => revertTo(before));", "", "accepting the safe edits in one go says where their comments went"],
  ["labels-generic", "src/components/LeftPanel.tsx", 'education: { name: "学校名称", sub: "专业" },', 'education: { name: "学校名称", sub: "角色" },', "each kind of entry names its own fields"],
  ["name-repeated", "src/components/LeftPanel.tsx", "                    {fields.sub && (", "                    <Field label={fields.name}><Input value={it.title} readOnly /></Field>{fields.sub && (", "an open entry's name is not repeated as a field"],
  ["skill-unpreviewed", "src/components/LeftPanel.tsx", 'const sub = s.kind === "skill" ? it.bullets.map((b) => b.text).join(" ") : it.subtitle;', "const sub = it.subtitle;", "a folded skill shows its lines"],
  ["title-folds", "src/components/LeftPanel.tsx", "setOpen((o) => new Set(o).add(it.id)); ", "", "naming a new entry keeps it open"],
  ["skill-undotted", "src/resume.css", ".resume .item li::before, .resume .skill::before {", ".resume .item li::before {", "a skill row carries the same dot as the lines above it"],
  ["skill-lines-glued", "src/resume.css", ".resume .skill > span + span { margin-left: .8em; }", "", "a skill's lines don't run together"],
  ["skill-dot-gray", "src/resume.css", ".t-shujuan .item li::before, .t-shujuan .skill::before {", ".t-shujuan .item li::before {", "in 书卷 the skill dot takes the accent too"],
  ["skill-dot-alone", "src/resume.css", ".layout-sidebar aside .skill b { margin: 0; }", ".layout-sidebar aside .skill b { display: block; margin: 0; }", "in 分栏 a centered skill keeps its dot beside its label"],
  ["tooltip-at-edge", "src/components/ui/tooltip.tsx", "collisionPadding = 8", "collisionPadding = 0", "a tooltip pushed off the window's edge keeps 8px clear of it"],
  ["tooltip-arrowless", "src/components/ui/tooltip.tsx", "<TooltipPrimitive.Arrow asChild width={10} height={5}>\n        <svg viewBox=\"0 0 10 5\" overflow=\"visible\" className=\"fill-(--tip)\"><path d=\"M0-1h10v1L5.85 4.15a1.2 1.2 0 0 1-1.7 0L0 0Z\" /></svg>\n      </TooltipPrimitive.Arrow>", "", "and its arrow still points at its button"],
  ["tooltip-arrow-mismatch", "src/components/ui/tooltip.tsx", 'className="fill-(--tip)"', 'className="fill-primary"', "a tooltip's arrow is the color of its bubble"],
  ["tooltip-thin", "src/components/ui/tooltip.tsx", "text-xs font-medium", "text-xs", "a tooltip's text is medium weight and reads at 7:1 or better"],
  ["section-title-flat", "src/styles.css", ".group h3 { margin-bottom: 8px !important; color: var(--ink); font-size: 14px;", ".group h3 { margin-bottom: 8px !important; color: var(--ink); font-size: 13px;", "a section title is larger than the entries under it"],
  ["section-input-flat", "src/styles.css", "box-shadow: none !important; color: var(--ink); font-size: 14px;", "box-shadow: none !important; color: var(--ink); font-size: 13px;", "a section title is larger than the entries under it"],
  ["subgroup-as-label", "src/styles.css", ".basics-group h4 { margin: 0 0 6px; color: var(--ink);", ".basics-group h4 { margin: 0 0 6px; color: var(--muted);", "a subgroup heading stands apart from its field labels"],
  ["ghost-hover-invisible", "src/components/ui/button.tsx", "hover:bg-(--hover)", "hover:bg-transparent", "a quiet button shows its hover even over a hovered row"],
  ["key-detour-drops-draft", "src/components/Dialogs.tsx", "const [text, setTextState] = useState(draft);", "const [text, setTextState] = useState(\"\");", "closing the key dialog goes back to the import"],
  ["key-detour-stays-closed", "src/lib/dialogs.ts", "return s.back ? { open: s.back.to, resume: false } : CLOSED;", "return CLOSED;", "closing the key dialog goes back to the import"],
  ["optional-open", "src/components/LeftPanel.tsx", "const shown = !folds || unfolded.has(group);", "const shown = !folds || !unfolded.has(group);", "the optional groups start folded"],
  ["optional-no-summary", "src/components/LeftPanel.tsx", "filled.length ? filled.join(\" · \") : `${labels}，选填`", "`${labels}，选填`", "the optional groups start folded"],
  ["optional-toggle-all", "src/components/LeftPanel.tsx", "if (!n.delete(group)) n.add(group); return n;", "if (!n.delete(group)) OPTIONAL.forEach((g) => n.add(g)); return n;", "unfolding one opens its fields"],
  ["rewrite-inline", "src/components/CommentPanel.tsx", "if (isRewrite(segs)) {", "if (false) {", "a rewrite shows the new text whole"],
  ["rewrite-everything", "src/components/CommentPanel.tsx", "if (isRewrite(segs)) {", "if (segs.length) {", "a light edit stays marked inline"],
  ["rewrite-threshold", "src/lib/diff.ts", "same / longer < 0.5", "same / longer < 0.9", "unit: calls a long text mostly replaced a rewrite"],
  ["preview-unlabeled", "src/components/Canvas.tsx", "{(p.previewId || p.previewWhole) && (", "{false && (", "hovering a proposal says the page is a preview"],
  ["preview-bar-scrolls-away", "src/styles.css", ".preview-bar { position: sticky; top: 6px;", ".preview-bar { position: relative; top: 6px;", "hovering a proposal says the page is a preview"],
  ["preview-bar-lingers", "src/components/Canvas.tsx", "{(p.previewId || p.previewWhole) && (", "{(p.previewId || p.previewWhole || p.threads.length > 0) && (", "and the note goes when the preview does"],
  ["panels-fixed", "src/styles.css", "--left: var(--left-w, clamp(272px, 22vw, 312px)); --right: var(--right-w, clamp(288px, 24vw, 336px));", "--left: var(--left-w, 312px); --right: var(--right-w, 336px);", "a narrower window narrows the panels"],
  ["panels-zoom-unaware", "src/App.tsx", "(leftOpen ? leftWidth(w) : 48) + rightWidth(w) + 96", "(leftOpen ? 312 : 48) + 336 + 96", "a narrower window narrows the panels"],
  ["key-detour-drops-jd", "src/components/Dialogs.tsx", "const [jd, setJdState] = useState(draft);", "const [jd, setJdState] = useState(\"\");", "closing the key dialog goes back to the tailoring"],
  ["key-detour-tailor-no-resume", "src/components/Dialogs.tsx", "    if (!resumeRun) return;\n    onResumed();\n    if (audit || jd.trim()) void run();", "    if (!resumeRun) return;\n    onResumed();", "saving the key carries on with the tailoring"],
  ["key-detour-no-resume", "src/lib/dialogs.ts", "resume: s.back.run && !!e.key", "resume: false", "saving the key carries on with the import"],
  ["enter-no-split", "src/components/LeftPanel.tsx", 'if (e.key === "Enter" && !e.shiftKey) {', "if (false) {", "Enter splits a bullet at the caret"],
  ["backspace-no-join", "src/components/LeftPanel.tsx", '} else if (e.key === "Backspace" && a === 0 && z === 0 && i > 0) {', "} else if (false) {", "Backspace at a bullet's start joins it"],
  ["accept-key-unhinted", "src/components/CommentPanel.tsx", '接受"}{active && <kbd aria-hidden="true">↵</kbd>}', '接受"}', "the open card's accept button shows its key"],
  ["accept-key-dead", "src/components/CommentPanel.tsx", "      primary.click();", "      void primary;", "Enter accepts the open card's change"],
  ["card-pin-unlinked", "src/components/CommentPanel.tsx", "onMouseEnter={() => onHover(thread.id)} ", "", "pointing at a card lights its pin"],
  ["card-pin-sticks", "src/components/CommentPanel.tsx", " onMouseLeave={() => onHover(null)}", "", "and lets it go with the pointer"],
  ["roam-untagged", "src/components/Canvas.tsx", "const tagged = cursor && !selectedId ? cursor : null;", "const tagged = null as string | null;", "stepping with the keys tags the component"],
  ["tag-over-composer", "src/components/Canvas.tsx", "const tagged = cursor && !selectedId ? cursor : null;", "const tagged = selectedId ?? cursor;", "and the tag gives way to the composer's breadcrumb"],
  ["resize-dead", "src/components/ResizeHandle.tsx", "onWidth(clamp(d.w + (side === \"left\" ? dx : -dx)));", "onWidth(clamp(d.w));", "dragging the left panel's edge widens it"],
  ["resize-zoom-unaware", "src/App.tsx", "useSyncExternalStore(onResize, () => zoomFor(zoomBy, leftOpen, widths));", "useSyncExternalStore(onResize, () => zoomFor(zoomBy, leftOpen, {}));", "dragging the left panel's edge widens it"],
  ["resize-forgotten", "src/App.tsx", '  useEffect(() => { save(WIDTHS_KEY, Object.keys(widths).length ? JSON.stringify(widths) : ""); }, [widths]);\n', "", "the width survives a reload"],
  ["resize-no-reset", "src/components/ResizeHandle.tsx", "onDoubleClick={() => onWidth(null)}", "", "a double-click puts it back"],
  ["fold-never-slides", "src/components/LeftPanel.tsx", "onClick={() => onOpenChange(!open, true)}", "onClick={() => onOpenChange(!open)}", "a click folds the panel with a short slide"],
  ["fold-slides-from-keys", "src/components/LeftPanel.tsx", "      onOpenChange(!open);\n", "      onOpenChange(!open, true);\n", "unfolds it at once, with no slide"],
  ["card-lists-everything", "src/components/CommentPanel.tsx", "const shown = changed.length ? changed : given;", "const shown = given;", "a follow-up formatting card lists only what it changes"],
  ["card-never-folds", "src/components/CommentPanel.tsx", 'const revert = () => a.onRevert(threadId, messageId);\n    if (p.status !== "pending") {', 'const revert = () => a.onRevert(threadId, messageId);\n    if (false) {', "a decided formatting card folds to one line"],
  ["card-repeats-itself", "src/components/CommentPanel.tsx", 'const text = formatting ? m.text.match(/暂时做不到：.*$/)?.[0] ?? "" : m.text;', "const text = m.text;", "above a formatting card only what can't be done is said"],
  ["user-ink-badge", "src/styles.css", ".msg:not(.ai)::before { left: 3px; top: 7px; width: 7px; height: 7px; box-shadow: inset 0 0 0 1.5px var(--faint); }", '.msg:not(.ai)::before { content: "我"; background: var(--ink); color: #fff; font-size: 9px; }', "the user's turn sits on a quiet ring"],
  ["glow-never-stops", "src/components/Shockwave.tsx", "if (t >= 1 || !run.current) return stop();", "if (!run.current) return stop();", "after its second the glow is gone"],
  ["glow-over-composer", "src/styles.css", ".shockwave { position: fixed; z-index: 2;", ".shockwave { position: fixed; z-index: 9;", "opening the composer sweeps a glow over the canvas only"],
  ["glow-catches-pointer", "src/styles.css", ".shockwave { position: fixed; z-index: 2; pointer-events: none; }", ".shockwave { position: fixed; z-index: 2; }", "opening the composer sweeps a glow over the canvas only"],
  ["glow-flat", "src/components/Shockwave.tsx", "x.uniform1f(u.lens, shot ? 1 : 0);", "x.uniform1f(u.lens, 0);", "the glow tints the page and bends it"],
  ["glow-ignores-calm", "src/components/Shockwave.tsx", 'const [calm, setCalm] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);', 'const [calm, setCalm] = useState(false);', "with reduced motion the glow only fades in place"],
  ["glow-no-restart", "src/components/Shockwave.tsx", "    stop();\n    const zoom = zoomNow.current;", "    const zoom = zoomNow.current;", "opening the composer on another component restarts the sweep"],
  ["glow-prints", "src/components/Shockwave.tsx", 'className="shockwave chrome"', 'className="shockwave"', "the glow never prints"],
  ["glow-slow-start", "src/lib/shockwave.ts", "(1 - 2 ** (-9 * t))", "(1 - 2 ** (-3 * t))", "unit: grows fast out of its origin"],
  ["glow-wide-lens", "src/lib/shockwave.ts", "const z = x * 0.75;", "const z = x * 0.25;", "unit: bends like a lens"],
  ["key-removed-loops", "src/lib/dialogs.ts", "resume: s.back.run && !!e.key", "resume: s.back.run", "unit: removing the key on the detour goes back without running"],
  ["key-mid-step-strands", "src/lib/dialogs.ts", 'back: isStep(s.open) ? { to: s.open, run: false } : null', "back: null", "unit: a key asked for from inside a step comes back to it"],
  ["key-mid-step-runs", "src/lib/dialogs.ts", "{ to: s.open, run: false }", "{ to: s.open, run: true }", "unit: a key asked for from inside a step comes back to it"],
  ["revert-rejected", "src/lib/threads.ts", 'revert: { from: "accepted", to: "pending" }', 'revert: { from: "rejected", to: "pending" }', "unit: is decided only while pending"],
  ["asking-hidden-by-resolve", "src/lib/threads.ts", '  if (asking) return "asking";\n  if (t.resolved) return "resolved";', '  if (t.resolved) return "resolved";\n  if (asking) return "asking";', "unit: is asking while DeepSeek answers"],
  ["card-state-ignores-asking", "src/components/CommentPanel.tsx", "data-state={threadState(thread, busy)}", "data-state={threadState(thread, false)}", "a comment card says where it stands"],
  ["cancel-is-quiet", "src/App.tsx", "    r.byUser = true;\n", "", "a comment card says where it stands"],
];

async function one([name, file, from, to, expect]) {
  const dir = `${work}/${name}`;
  mkdirSync(dir, { recursive: true });
  for (const f of ["src", "index.html", "vite.config.ts", "tsconfig.json", "package.json"]) cpSync(`${root}/${f}`, `${dir}/${f}`, { recursive: true });
  symlinkSync(`${root}/node_modules`, `${dir}/node_modules`);
  const src = readFileSync(`${dir}/${file}`, "utf8");
  const hits = src.split(from).length - 1;
  if (hits !== 1) return `SETUP  ${name}: the text to change occurs ${hits} times in ${file}`;
  writeFileSync(`${dir}/${file}`, src.replace(from, to));
  if (expect.startsWith("unit: ")) {
    const out = await run("npx", ["vitest", "run", "--reporter", "verbose"], { cwd: dir, maxBuffer: 1 << 24 }).then((r) => r.stdout, (e) => `${e.stdout}${e.stderr}`);
    const failed = [...out.matchAll(/^\s*×\s+(.*?)(?:\s+\d+ms)?$/gm)].map((m) => m[1]);
    return `${failed.some((f) => f.includes(expect.slice(6))) ? "CAUGHT" : "MISSED"} ${name}: unit tests failed [${failed.join(" | ") || "none"}]`;
  }
  await run("npx", ["vite", "build", "--logLevel", "error"], { cwd: dir });
  const env = { ...process.env, REDLINE_HTML: `${dir}/dist/index.html`, VERIFY_OUT: `${dir}/verify` };
  // A "flow <journey>: " check names a core-flow.mjs check instead of a details.mjs one.
  const [, journey, check] = expect.match(/^flow (\S+): (.*)$/) ?? [null, null, expect];
  const script = journey ? [".claude/skills/verify-redline/scripts/core-flow.mjs", journey] : ["e2e/details.mjs"];
  const out = await run("node", script, { cwd: root, env, maxBuffer: 1 << 24 }).then((r) => `${r.stdout}${r.stderr}`, (e) => `${e.stdout}${e.stderr}`);
  const passed = journey ? out.includes(`PASSED ${journey}`) : out.includes("DETAILS PASSED");
  // details.mjs dies with "Error: FAIL: …" under the source line that threw; core-flow logs "  FAIL: …".
  const failed = out.match(/^(?:Error: | +)FAIL: (.*)/m)?.[1] ?? (passed ? "nothing" : out.split("\n").find((l) => /Error/.test(l)) ?? "?");
  return `${failed.includes(check) ? "CAUGHT" : "MISSED"} ${name}: failed at "${failed}"`;
}

rmSync(work, { recursive: true, force: true });
const queue = M.filter(([name]) => !only || only.test(name));
const results = [];
await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) results.push(await one(queue.shift())); }));
console.log(results.sort().join("\n"));
const caught = results.filter((r) => r.startsWith("CAUGHT")).length;
console.log(`MUTATIONS ${caught}/${results.length} CAUGHT`);
rmSync(work, { recursive: true, force: true });
process.exitCode = caught === results.length ? 0 : 1;
