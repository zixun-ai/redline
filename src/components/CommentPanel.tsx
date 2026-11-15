import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SegmentThumb } from "@/components/ui/segment-thumb";
import { Textarea } from "@/components/ui/textarea";
import { IconButton } from "./IconButton";
import { ResizeHandle } from "./ResizeHandle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLanguage } from "@/lib/language";
import { ENGLISH_DESIGN_OPTIONS, ENGLISH_TEMPLATES } from "@/lib/designLocale";
import { cn, isFresh, markScrolled, scrollMotion } from "@/lib/utils";
import { revertStyle, styleStale } from "../lib/storage";
import { memo, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { AlertTriangle, ArrowUp, Check, CheckCheck, CircleCheck, KeyRound, MessageSquareDashed, Pencil, RotateCcw, Target, TextQuote, Undo2, X } from "lucide-react";
import type { Align, Design, Doc, ItemPayload, JobTarget, Message, NodeStyle, NodeType, Payload, Proposal, SectionPayload, TemplateId, Thread } from "../lib/types";
import { editPayloadField, editableFields, findNode, flatten, getPayload, targetFacts, validatePayload } from "../lib/nodes";
import { unsupportedClaims } from "../lib/check";
import { diffChars, isRewrite } from "../lib/diff";
import { ALIGN_NAMES, DENSITIES, FONTS, HEADINGS, LATIN_FONTS, MARGINS, TEMPLATES } from "../lib/design";
import { changedRows, mergeRows } from "../lib/rows";
import { threadState } from "../lib/threads";
import "./editor-upgrades.css";

type Actions = {
  onCancel: (threadId: string) => void;
  onActivate: (t: Thread) => void;
  onReply: (threadId: string, text: string) => boolean;
  onRetry: (threadId: string, messageId: string) => void;
  onAccept: (threadId: string, messageId: string, after?: Payload) => void;
  onReject: (threadId: string, messageId: string) => void;
  onRevert: (threadId: string, messageId: string) => void;
  onResolve: (threadId: string, resolved: boolean) => void;
  onPreview: (p: Proposal | null) => void;
  onOption: (threadId: string, text: string) => void;
  onNext: (threadId: string) => void;
};

type Props = Actions & {
  doc: Doc; threads: Thread[]; activeId: string | null; heldId: string | null; busy: Set<string>;
  job: JobTarget | null; safeCount: number; onAcceptSafe: () => void; onClearJob: () => void;
  onSelectJob?: (id: string) => void;
  nextPending: { from: string; to: string } | null;
  reveal?: { id: string } | null;
  hasKey: boolean; onKey: () => void;
  /** The thread under the pointer, so the page can light its pin and component. */
  onHover: (threadId: string | null) => void;
  width: number; onWidth: (w: number | null) => void;
};

export function CommentPanel({ doc, threads, activeId, heldId, busy, job, safeCount, onAcceptSafe, onClearJob, onSelectJob, nextPending, reveal, hasKey, onKey, onHover, width, onWidth, ...actions }: Props) {
  const { t } = useLanguage();
  const [showResolved, setShowResolved] = useState(false);
  const tabsId = useId();
  useEffect(() => {
    const activated = threads.find((t) => t.id === activeId);
    if (activated) setShowResolved(activated.resolved);
    // Follow explicit activation, including a repeat click on the same pin, not a later status change.
  }, [activeId, reveal]);
  const open = threads.filter((t) => !t.resolved);
  const closed = threads.filter((t) => t.resolved);
  const list = threads.filter((t) => t.resolved === showResolved || t.id === heldId);
  const openLabel = <>{t("批注", "Comments")} {open.length > 0 && <em>{open.length}</em>}</>;
  const closedLabel = <>{t("已解决", "Resolved")} {closed.length > 0 && <em>{closed.length}</em>}</>;
  // Threads that land together (a tailoring pass) come in one after another, top to bottom.
  const arriving = list.filter((t) => isFresh(t.messages[0]?.at)).map((t) => t.id);

  // The job card only comes in when it's new, not every time this tab is shown again.
  const seenJob = useRef(job);
  useEffect(() => {
    const t = setTimeout(() => { seenJob.current = job; }, 400);
    return () => clearTimeout(t);
  }, [job]);

  const [announcement, setAnnouncement] = useState("");
  const wasBusy = useRef(busy);
  useEffect(() => {
    const before = wasBusy.current;
    wasBusy.current = busy;
    if ([...busy].some((id) => !before.has(id))) setAnnouncement(t("DeepSeek 正在修改", "DeepSeek is editing"));
    for (const id of before) {
      const thread = threads.find((x) => x.id === id);
      if (busy.has(id) || !thread) continue;
      const last = thread.messages.at(-1);
      const n = threads.filter((x) => !x.resolved).indexOf(thread) + 1;
      setAnnouncement(last?.failed ? last.text : last?.proposal
        ? t(`第 ${n} 条批注的方案已生成`, `Suggestion ready for comment ${n}`)
        : t(`第 ${n} 条批注有新回复`, `New reply to comment ${n}`));
    }
  }, [busy, threads, t]);

  return (
    <aside className="panel right chrome">
      <p className="sr-only" aria-live="polite">{announcement}</p>
      <div className="panel-head">
        <Tabs className="min-w-0 flex-1" value={showResolved ? "closed" : "open"} onValueChange={(v) => setShowResolved(v === "closed")}>
          <TabsList aria-label={t("批注状态", "Comment status")} className="grid w-full grid-flow-col auto-cols-fr">
            <SegmentThumb index={showResolved ? 1 : 0} labels={[openLabel, closedLabel]} />
            <TabsTrigger value="open" id={`${tabsId}-open`} aria-controls={`${tabsId}-open-panel`}>{openLabel}</TabsTrigger>
            <TabsTrigger value="closed" id={`${tabsId}-closed`} aria-controls={`${tabsId}-closed-panel`}>{closedLabel}</TabsTrigger>
          </TabsList>
        </Tabs>
        {hasKey ? (
          <Tooltip>
            <TooltipTrigger asChild><button className="key-pill" onClick={onKey}><i className="dot" />{t("已连接", "Connected")}</button></TooltipTrigger>
            <TooltipContent side="bottom">{t("DeepSeek 已连接，点击更换 Key", "DeepSeek is connected. Select to change the key.")}</TooltipContent>
          </Tooltip>
        ) : (
          <Button variant="attention" size="sm" onClick={onKey}><KeyRound size={13} />{t("填写 API Key", "Set API key")}</Button>
        )}
      </div>
      <div hidden role="tabpanel" id={`${tabsId}-${showResolved ? "open" : "closed"}-panel`} aria-labelledby={`${tabsId}-${showResolved ? "open" : "closed"}`} />
      <div className="thread-list" key={showResolved ? "closed" : "open"} role="tabpanel" id={`${tabsId}-${showResolved ? "closed" : "open"}-panel`} aria-labelledby={`${tabsId}-${showResolved ? "closed" : "open"}`} tabIndex={list.length ? undefined : 0} onScroll={markScrolled}>
        {job && !showResolved && (
          <div className={cn("job", job !== seenJob.current && "fresh")}>
            <div className="job-head">
              <Target size={14} /><b>{t("岗位匹配", "Job match")}</b>
              <IconButton size="icon-sm" label={t("关闭岗位匹配", "Close job match")} onClick={onClearJob}><X size={14} /></IconButton>
            </div>
            {!!job.history?.length && <div className="job-history" role="group" aria-label={t("岗位历史", "Job history")}>
              <span title={job.summary}>{t("当前：", "Current: ")}{job.summary || t("岗位匹配", "Job match")}</span>
              {job.history.map((past, i) => {
                const label = past.summary || t(`历史岗位 ${i + 1}`, `Past job ${i + 1}`);
                return past.id && <button key={past.id} title={past.summary} disabled={!onSelectJob}
                  onClick={() => onSelectJob?.(past.id!)} aria-label={t(`切换岗位：${label}`, `Switch to ${label}`)}>{label}</button>;
              })}
            </div>}
            {job.summary && <p>{job.summary}</p>}
            {!!job.matched?.length && <><b className="job-covered">{t("AI 认为已有依据，请核对", "Check the matches found by AI")}</b><ul>{job.matched.map((m, i) => <li key={`${i}-${m}`}>{m}</li>)}</ul></>}
            {job.missing.length > 0 && (
              <>
                <b className="job-gap">{t("简历没有覆盖，AI 不会替你写进去", "Requirements missing from the resume")}</b>
                <ul>{job.missing.map((m) => <li key={m}>{m}</li>)}</ul>
              </>
            )}
            {safeCount > 0 && (
              <Button variant="outline" size="sm" className="mt-2.5 h-auto min-h-7 w-full whitespace-normal py-1" onClick={onAcceptSafe}><CheckCheck size={13} />{t(`接受 ${safeCount} 处未发现明显风险的修改（仍需核对）`, `Accept ${safeCount} suggested edits (verify them first)`)}</Button>
            )}
          </div>
        )}
        {list.length === 0 && !job && (
          showResolved ? (
            <div className="empty">
              <MessageSquareDashed size={20} strokeWidth={1.5} />
              <p>{t("还没有已解决的批注", "No resolved comments yet")}</p>
              <p className="hint">{t("接受或拒绝方案后，批注会移到这里。", "Accept or reject a suggestion to move the comment here.")}<br />{t("也可以点批注右上角的 ✓。", "You can also select ✓ on a comment.")}</p>
            </div>
          ) : (
            <div className="empty guide">
              <svg viewBox="0 0 116 76" aria-hidden="true">
                <defs>
                  <linearGradient id="guide-fade-g" x1="0" x2="0" y1="0" y2="1">
                    <stop offset=".55" stopColor="#fff" />
                    <stop offset="1" stopColor="#fff" stopOpacity="0" />
                  </linearGradient>
                  <mask id="guide-fade"><rect width="116" height="76" fill="url(#guide-fade-g)" /></mask>
                </defs>
                <g className="fade">
                  <rect className="sheet" x=".5" y=".5" width="84" height="90" rx="2" />
                  <line className="ln strong" x1="9" x2="33" y1="10" y2="10" />
                  <line className="ln" x1="9" x2="52" y1="16" y2="16" />
                  <line className="ln" x1="9" x2="22" y1="26" y2="26" />
                  <line className="ln" x1="9" x2="76" y1="31.5" y2="31.5" />
                  <line className="ln" x1="9" x2="68" y1="38" y2="38" />
                  <line className="ln" x1="9" x2="72" y1="44.5" y2="44.5" />
                  <line className="ln" x1="9" x2="22" y1="56" y2="56" />
                  <line className="ln" x1="9" x2="74" y1="61.5" y2="61.5" />
                  <line className="ln" x1="9" x2="60" y1="68" y2="68" />
                </g>
                <path className="mark" pathLength="1" d="M7.5 41.2C22 39.8 36 41.6 50 40.5S64 40 70.5 41.4" />
                <path className="drop" d="M78 35.5a5.5 5.5 0 1 1 5.5 5.5H78z" />
              </svg>
              <h3>{t("圈出想改的地方", "Mark what you want to change")}</h3>
              <ol>
                <li>{t("点击简历上的一句话，或拖选几个字", "Click a line in the resume or select some text")}</li>
                <li>{t("写下想怎么改", "Describe the change you want")}</li>
                <li>{t("看过对比，再决定是否接受", "Review the changes before you accept them")}</li>
              </ol>
            </div>
          )
        )}
        {list.map((t) => (
          <ThreadCard
            key={t.id}
            thread={t}
            index={open.indexOf(t) + 1}
            doc={doc}
            active={t.id === activeId}
            held={t.id === heldId}
            busy={busy.has(t.id)}
            arrival={arriving.indexOf(t.id)}
            next={nextPending?.from === t.id ? nextPending.to : null}
            onHover={onHover}
            {...actions}
          />
        ))}
      </div>
      <ResizeHandle side="right" label={t("调整批注栏宽度", "Resize comments panel")} width={width} min={280} max={480} onWidth={onWidth} />
    </aside>
  );
}

function ThreadCard({ thread, index, doc, active, held, busy, arrival, next, onHover, ...a }: Actions & {
  thread: Thread; index: number; doc: Doc; active: boolean; held: boolean; busy: boolean; arrival: number; next: string | null;
  onHover: (threadId: string | null) => void;
}) {
  const { english, t } = useLanguage();
  const ref = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");
  const gone = !getPayload(doc.resume, thread.targetId);
  const label = english && findNode(doc.resume, thread.targetId)?.label === thread.label
    ? findNode(doc.resume, thread.targetId, true)?.label ?? thread.label : thread.label;

  // Enter accepts the open card's pending change, as its button's ↵ says, unless something else holds the key:
  // a field, a button, the page's own Enter.
  useEffect(() => {
    if (!active) return;
    const keys = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Enter" || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey || e.isComposing || e.keyCode === 229 || e.defaultPrevented) return;
      const at = e.target as HTMLElement;
      const free = at === document.body || (ref.current?.contains(at) && !at.closest("input, textarea, button, a, [role=checkbox], [tabindex]:not(.thread)"));
      if (!free || document.querySelector("[role=dialog]")) return;
      const primary = ref.current?.querySelector<HTMLButtonElement>(".proposal.pending [data-primary]:not(:disabled)");
      if (!primary) return;
      e.preventDefault();
      primary.click();
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [active]);

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest", behavior: scrollMotion() });
  }, [active]);

  const send = () => {
    if (!draft.trim() || busy) return;
    if (a.onReply(thread.id, draft.trim())) setDraft("");
  };
  const keys = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div ref={ref} data-thread={thread.id} data-state={threadState(thread, busy)} className={cn("thread", active && "on", arrival >= 0 && "fresh")}
      style={arrival > 0 ? { "--i": arrival } as CSSProperties : undefined} onClick={() => a.onActivate(thread)}
      onMouseEnter={() => onHover(thread.id)} onMouseLeave={() => onHover(null)}>
      <div className="thread-head">
        {thread.resolved
          ? <span className="num done"><Check size={11} strokeWidth={2.5} aria-hidden="true" /><span className="sr-only">{t("已解决", "Resolved")}</span></span>
          : index > 0 && <span className="num">{index}</span>}
        <button className="target" aria-expanded={active}>{label}{gone && t("（已删除）", " (deleted)")}</button>
        <IconButton
          size="icon-sm"
          label={thread.resolved ? t("重新打开", "Reopen") : t("标记为已解决", "Mark as resolved")}
          onClick={(e) => { e.stopPropagation(); a.onResolve(thread.id, !thread.resolved); }}
        >
          {/* The circle is the badge it turns into, which tells it apart from the check that accepts a suggestion. */}
          {thread.resolved ? <RotateCcw size={14} /> : <CircleCheck size={15} />}
        </IconButton>
      </div>
      {thread.messages.map((m, i) => (
        <MessageView key={m.id} thread={thread} message={m} doc={doc} last={i === thread.messages.length - 1} busy={busy} active={active} {...a} />
      ))}
      {next && (
        <Button variant="outline" size="sm" className="mt-2" autoFocus onClick={(e) => {
          e.stopPropagation();
          a.onNext(next);
          requestAnimationFrame(() => {
            const bar = `[data-thread="${next}"] .proposal.pending .actions`;
            (document.querySelector<HTMLElement>(`${bar} [data-primary]`) ?? document.querySelector<HTMLElement>(`${bar} button`))?.focus({ preventScroll: true });
          });
        }}>{t("下一条待处理 →", "Next pending comment →")}</Button>
      )}
      {busy && <p className="thinking"><span>{t("DeepSeek 正在修改", "DeepSeek is editing")}</span><Button variant="outline" size="sm" onClick={() => a.onCancel(thread.id)}>{t("取消", "Cancel")}</Button></p>}
      {active && (!thread.resolved || held) && !gone && (
        <div className="reply" onClick={(e) => e.stopPropagation()}>
          <textarea rows={1} value={draft} aria-label={t("继续回复批注", "Reply to comment")} placeholder={t("继续说", "Write a reply")} onChange={(e) => setDraft(e.target.value)} onKeyDown={keys} />
          <button className="send" disabled={!draft.trim() || busy} onClick={send} aria-label={t("发送", "Send")}><ArrowUp size={14} /></button>
        </div>
      )}
    </div>
  );
}

function MessageView({ thread, message: m, doc, last, busy, active, ...a }: Actions & {
  thread: Thread; message: Message; doc: Doc; last: boolean; busy: boolean; active: boolean;
}) {
  const { t } = useLanguage();
  // The rail runs on to the next message, and to the thinking line under the last one while DeepSeek works.
  const chain = !last || busy;
  if (m.role === "user") {
    return (
      <div className={cn("msg", chain && "chain")}>
        {m.quote && <p className="quote"><TextQuote size={12} /><span>{m.quote}</span></p>}
        <p className="user">{m.text}</p>
      </div>
    );
  }
  // A formatting card lists its own changes, so of the answer only what can't be done is left to say.
  const formatting = m.proposal?.kind === "nodeStyle" || m.proposal?.kind === "style";
  const text = formatting ? m.text.match(/暂时做不到：.*$/)?.[0] ?? "" : m.text;
  return (
    <div className={cn("msg ai", isFresh(m.at) && "fresh", chain && "chain", m.proposal && !m.failed && "lead")}>
      {text && <p className={m.failed ? "fail" : formatting ? "cant" : ""}>{text}</p>}
      {m.options && m.options.length > 0 && last && !busy && !thread.resolved && (
        <div className="options" onClick={(e) => e.stopPropagation()}>
          {m.options.map((o) => <button key={o} onClick={() => a.onOption(thread.id, o)}>{o}</button>)}
        </div>
      )}
      {m.failed && (
        <Button variant="outline" size="sm" onClick={() => a.onRetry(thread.id, m.id)}><RotateCcw size={12} />{t("重试", "Retry")}</Button>
      )}
      {m.proposal && <ProposalCard threadId={thread.id} messageId={m.id} proposal={m.proposal} doc={doc} active={active} {...a} />}
    </div>
  );
}

const STYLE_NAMES: Partial<Record<keyof Design, readonly [string, string]>> = {
  template: ["模板", "Template"], density: ["间距", "Spacing"], fontScale: ["字号", "Text size"], accent: ["强调色", "Accent color"],
  font: ["中文字体", "Chinese font"], latin: ["西文字体", "Latin font"], heading: ["标题样式", "Heading style"], margin: ["页边距", "Page margins"],
};

const NODE_STYLE_KEYS = ["align", "bold", "italic", "color"] as const;
type NodeStyleKey = (typeof NODE_STYLE_KEYS)[number];
const NODE_STYLE_NAMES: Record<NodeStyleKey, readonly [string, string]> = {
  align: ["对齐", "Alignment"], bold: ["加粗", "Bold"], italic: ["斜体", "Italic"], color: ["文字颜色", "Text color"],
};

function alignmentName(value: Align, english: boolean) {
  const name = ALIGN_NAMES[value];
  return english ? ENGLISH_DESIGN_OPTIONS[name] ?? name : name;
}

function nodeStyleValue(k: NodeStyleKey, v: NodeStyle[NodeStyleKey], english: boolean): ReactNode {
  if (k === "align") return v ? alignmentName(v as Align, english) : english ? "Default" : "默认";
  if (k === "color") return v ? <><i style={{ background: v as string }} />{(v as string).toUpperCase()}</> : english ? "Default" : "默认";
  return english ? v ? "On" : "Off" : v ? "开" : "关";
}

function nodeStyleSummary(k: NodeStyleKey, v: NodeStyle[NodeStyleKey], english: boolean): string {
  if (k === "align") return v ? alignmentName(v as Align, english) : english ? "Default alignment" : "默认对齐";
  const [zh, en] = NODE_STYLE_NAMES[k];
  if (k === "color") return v ? `${english ? en : zh} ${(v as string).toUpperCase()}` : english ? "Default color" : "默认颜色";
  return english ? v ? en : `Remove ${en.toLowerCase()}` : `${v ? "" : "取消"}${zh}`;
}

function styleValue(k: string, v: unknown, english: boolean): string {
  if (k === "fontScale") return `${Math.round((v as number) * 100)}%`;
  if (english && k === "template") return ENGLISH_TEMPLATES[v as TemplateId]?.name ?? String(v);
  const names: Record<string, { id: string; name: string }[]> = { template: TEMPLATES, density: DENSITIES, font: FONTS, latin: LATIN_FONTS, heading: HEADINGS, margin: MARGINS };
  const name = names[k]?.find((x) => x.id === v)?.name ?? String(v);
  return english ? ENGLISH_DESIGN_OPTIONS[name] ?? name : name;
}

function ProposalCard({ threadId, messageId, proposal: p, doc, active, ...a }: Actions & {
  threadId: string; messageId: string; proposal: Proposal; doc: Doc; active: boolean;
}) {
  const { english, t } = useLanguage();
  const [editing, setEditing] = useState(false);
  // A saved proposal is immutable. Editing the document should only recheck applicability.
  const content = useMemo(() => {
    if (p.kind !== "content") return null;
    const beforeValue = JSON.parse(p.before) as Payload;
    return { beforeValue, beforeText: flatten(p.type, beforeValue), afterText: flatten(p.type, p.after), rows: changedRows(p.type, beforeValue, p.after) };
  }, [p]);
  const stop = { onClick: (e: React.MouseEvent) => e.stopPropagation() };
  const preview = (on: boolean) => ({
    onMouseEnter: () => on && a.onPreview(p),
    onMouseLeave: () => a.onPreview(null),
    onFocusCapture: () => on && a.onPreview(p),
    onBlurCapture: () => a.onPreview(null),
  });

  if (p.kind === "nodeStyle") {
    const stale = styleStale(doc, p);
    const now = doc.resume.nodeStyles?.[p.targetId] ?? {};
    const applied = Object.entries(p.patch).every(([k, v]) => (now[k as keyof typeof now] || "") === (v || ""));
    const given = NODE_STYLE_KEYS.filter((k) => p.patch[k] !== undefined);
    // Only what this change actually changes: a follow-up that keeps the bold and the color lists just the alignment.
    const changed = given.filter((k) => (p.patch[k] || "") !== (p.beforeStyle[k] || ""));
    const shown = changed.length ? changed : given;
    const revert = () => a.onRevert(threadId, messageId);
    if (p.status !== "pending") {
      return (
        <div className={`proposal ${p.status} folded`} {...stop}>
          <Footer proposal={p} active={active} canAccept canRevert={applied} summary={shown.map((k) => nodeStyleSummary(k, p.patch[k], english)).join(t("、", ", "))}
            onAccept={() => {}} onReject={() => {}} onRevert={revert} />
        </div>
      );
    }
    return (
      <div className={`proposal ${p.status}`} {...stop} {...preview(!stale)}>
        <ul className="style-changes">
          {shown.map((k) => (
            <li key={k}>{t(...NODE_STYLE_NAMES[k])}<span className="color-value">
              {changed.length > 0 && <s>{nodeStyleValue(k, p.beforeStyle[k], english)} →</s>}{nodeStyleValue(k, p.patch[k], english)}
            </span></li>
          ))}
        </ul>
        {p.why && <p className="why">{p.why}</p>}
        {stale && <p className="stale">{t("这些格式已经改过了，这个方案不能再直接使用。", "The formatting has changed. This suggestion no longer applies.")}</p>}
        <Footer proposal={p} active={active} canAccept={!stale} canRevert={applied} onAccept={() => a.onAccept(threadId, messageId)}
          onReject={() => a.onReject(threadId, messageId)} onRevert={revert} />
      </div>
    );
  }

  if (p.kind === "style") {
    const stale = styleStale(doc, p);
    const entries = Object.entries(p.patch) as [keyof Design, unknown][];
    const styleName = (key: keyof Design) => {
      const name = STYLE_NAMES[key];
      return name ? t(...name) : key;
    };
    if (p.status !== "pending") {
      return (
        <div className={`proposal ${p.status} folded`} {...stop}>
          <Footer proposal={p} active={active} canAccept summary={entries.map(([k, v]) => `${styleName(k)} ${styleValue(k, v, english)}`).join(t("、", ", "))}
            onAccept={() => {}} onReject={() => {}} onRevert={() => a.onRevert(threadId, messageId)} canRevert={!!revertStyle(doc.design, p)} />
        </div>
      );
    }
    return (
      <div className={`proposal ${p.status}`} {...stop} {...preview(!stale)}>
        <ul className="style-changes">
          {entries.map(([k, v]) => (
            <li key={k}>{styleName(k)}<span>{styleValue(k, p.beforeDesign[k], english)} → {styleValue(k, v, english)}</span></li>
          ))}
        </ul>
        <p className="why">{t("作用于整份简历。", "Applies to the entire resume. ")}{p.why}</p>
        {stale && <p className="stale">{t("这些版式已经改过了，这个方案不能再直接使用。", "The layout has changed. This suggestion no longer applies.")}</p>}
        <Footer proposal={p} active={active} canAccept={!stale} onAccept={() => a.onAccept(threadId, messageId)}
          onReject={() => a.onReject(threadId, messageId)} onRevert={() => a.onRevert(threadId, messageId)} canRevert={!!revertStyle(doc.design, p)} />
      </div>
    );
  }

  const current = getPayload(doc.resume, p.targetId);
  const currentJson = current ? JSON.stringify(current) : "";
  const stale = p.status === "pending" && currentJson !== p.before;
  const canRevert = currentJson === JSON.stringify(p.after);
  const isText = p.type === "bullet" || p.type === "summary" || p.type === "field";
  const { beforeValue, beforeText, afterText, rows } = content!;
  const pending = p.status === "pending";

  if (pending && !stale && rows.length > 1) {
    return (
      <RowsCard
        rows={rows}
        type={p.type}
        before={beforeValue}
        initial={p.after}
        evidence={targetFacts(doc.resume, p.targetId)}
        why={p.why}
        onPreview={(after) => a.onPreview(after ? { ...p, after } : null)}
        active={active}
        onReject={() => a.onReject(threadId, messageId)}
        onAccept={(after) => a.onAccept(threadId, messageId, JSON.stringify(after) === JSON.stringify(p.after) ? undefined : after)}
      />
    );
  }

  return (
    <div className={`proposal ${p.status}`} {...stop} {...preview(pending && !stale)}>
      {editing ? (
        <EditBox
          initial={afterText}
          evidence={targetFacts(doc.resume, p.targetId)}
          onCancel={() => { setEditing(false); a.onPreview(null); }}
          onPreview={(text) => a.onPreview(text ? { ...p, after: { text } } : null)}
          onSave={(text) => { a.onPreview(null); setEditing(false); a.onAccept(threadId, messageId, { text }); }}
        />
      ) : (
        <>
          <Diff before={beforeText} after={afterText} />
          {p.why && pending && <p className="why">{p.why}</p>}
          {pending && p.unsupported.length > 0 && (
            <div className="unsupported">
              <AlertTriangle size={13} />
              <div>
                <b>{t("当前组件的原文未支持这些内容", "The original text does not support these details.")}</b>
                <p>{p.unsupported.map((u) => <code key={u}>{u}</code>)}</p>
              </div>
            </div>
          )}
          {stale && <p className="stale">{t("这段内容已经改过了，这个方案不能再直接使用。", "This text has changed. The suggestion no longer applies.")}</p>}
          <Footer proposal={p} active={active} canAccept={!stale} warned={p.unsupported.length > 0} canRevert={canRevert}
            onAccept={() => a.onAccept(threadId, messageId)} onReject={() => a.onReject(threadId, messageId)}
            onRevert={() => a.onRevert(threadId, messageId)}
            onEdit={isText && !stale ? () => setEditing(true) : undefined} />
        </>
      )}
    </div>
  );
}

/** A light edit is marked inline. A rewrite shows the new text whole, so it reads as a sentence, and the old one under it. */
const Diff = memo(function Diff({ before, after }: { before: string; after: string }) {
  const { t } = useLanguage();
  const segs = diffChars(before, after);
  if (isRewrite(segs)) {
    return (
      <span className="diff rewrite">
        <span className="diff-after">{after}</span>
        <span className="diff-before"><b>{t("原文", "Original")}</b>{before}</span>
      </span>
    );
  }
  return (
    <span className="diff">
      {segs.map((s, i) => s.t === "same" ? <span key={i}>{s.s}</span> : s.t === "add" ? <ins key={i}>{s.s}</ins> : <del key={i}>{s.s}</del>)}
    </span>
  );
});

function RowsCard({ rows, type, before, initial, evidence, why, onPreview, active, onAccept, onReject }: {
  rows: ReturnType<typeof changedRows>; type: NodeType; before: Payload; initial: Payload; evidence: string; why: string; active: boolean;
  onPreview: (after: Payload | null) => void; onAccept: (after: Payload) => void; onReject: () => void;
}) {
  const { english, t } = useLanguage();
  const [keep, setKeep] = useState(() => new Set(rows.map((r) => r.key)));
  const [after, setAfter] = useState(initial);
  const [editing, setEditing] = useState<{ key: string; type: NodeType; payload: Payload } | null>(null);
  const merged = mergeRows(type, before, after, keep);
  const valid = validatePayload(type, merged);
  const risky = unsupportedClaims(flatten(type, merged), evidence);
  const shown = new Map(changedRows(type, before, after).map((row) => [row.key, row.after]));
  const preview = (nextKeep = keep, nextAfter = after) => {
    const value = mergeRows(type, before, nextAfter, nextKeep);
    onPreview(nextKeep.size && validatePayload(type, value) ? value : null);
  };
  const flip = (key: string) => {
    const n = new Set(keep);
    if (!n.delete(key)) n.add(key);
    setKeep(n);
    preview(n);
  };
  const beginEdit = (key: string) => {
    if (type === "item") {
      const item = after as ItemPayload;
      setEditing(key === "head" ? { key, type: "item", payload: { ...item, bullets: [] } }
        : { key, type: "bullet", payload: { text: item.bullets[Number(key.slice(1))] ?? "" } });
    } else {
      const section = after as SectionPayload;
      setEditing(key === "title" ? { key, type: "field", payload: { text: section.title } }
        : { key, type: "item", payload: structuredClone(section.items[Number(key.slice(1))] ?? (before as SectionPayload).items[Number(key.slice(1))]) });
    }
  };
  const saveRow = () => {
    if (!editing) return;
    const value = validatePayload(editing.type, editing.payload);
    if (!value) return;
    const next = structuredClone(after);
    if (type === "item") {
      const item = next as ItemPayload;
      if (editing.key === "head") {
        const head = value as ItemPayload;
        item.title = head.title; item.subtitle = head.subtitle; item.period = head.period;
      } else item.bullets[Number(editing.key.slice(1))] = (value as { text: string }).text;
    } else {
      const section = next as SectionPayload;
      if (editing.key === "title") section.title = (value as { text: string }).text;
      else section.items[Number(editing.key.slice(1))] = value as ItemPayload;
    }
    const nextKeep = new Set(keep).add(editing.key);
    setAfter(next);
    setKeep(nextKeep);
    setEditing(null);
    preview(nextKeep, next);
  };
  return (
    <div className="proposal pending" onClick={(e) => e.stopPropagation()}
      onMouseEnter={() => preview()} onMouseLeave={() => onPreview(null)}
      onFocusCapture={() => preview()} onBlurCapture={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) onPreview(null); }}>
      {rows.map((r, i) => (
        <div key={r.key} className={cn("row proposal-row", !keep.has(r.key) && "off")}>
          <Checkbox aria-label={t(`接受第 ${i + 1} 处修改`, `Accept edit ${i + 1}`)} className="mt-1 data-[state=checked]:border-pen data-[state=checked]:bg-pen" checked={keep.has(r.key)} onCheckedChange={() => flip(r.key)} />
          <div className="row-content">
            {editing?.key === r.key ? <div className="row-editor">
              {editableFields(editing.type, editing.payload, english).map((field) => <label key={field.key}><span>{field.label}</span>
                <Textarea rows={field.multiline ? 3 : 1} value={field.value} autoFocus={field.key === editableFields(editing.type, editing.payload)[0].key}
                  onChange={(e) => setEditing({ ...editing, payload: editPayloadField(editing.type, editing.payload, field.key, e.target.value) })} />
              </label>)}
              <div className="actions"><Button variant="ghost" size="sm" onClick={() => setEditing(null)}>{t("取消微调", "Cancel adjustment")}</Button>
                <Button size="sm" disabled={!validatePayload(editing.type, editing.payload)} onClick={saveRow}>{t("保存这处微调", "Save adjustment")}</Button></div>
            </div> : <>
              <Diff before={r.before} after={shown.get(r.key) ?? r.before} />
              <button className="row-edit" onClick={() => beginEdit(r.key)} aria-label={t(`微调第 ${i + 1} 处修改`, `Adjust edit ${i + 1}`)}><Pencil size={11} />{t("改一下", "Adjust")}</button>
            </>}
          </div>
        </div>
      ))}
      {why && <p className="why">{why}</p>}
      {risky.length > 0 && (
        <div className="unsupported">
          <AlertTriangle size={13} />
          <div><b>{t("当前组件的原文未支持这些内容", "The original text does not support these details.")}</b><p>{risky.map((u) => <code key={u}>{u}</code>)}</p></div>
        </div>
      )}
      <div className="actions">
        <Button variant="outline" size="sm" onClick={onReject}>{t("全部拒绝", "Reject all")}</Button>
        <Button variant={risky.length ? "warn" : "default"} size="sm" data-primary disabled={keep.size === 0 || !!editing || !valid} onClick={() => valid && onAccept(valid)}>
          <Check size={13} />{risky.length ? t("我确认属实，", "I confirm the details. ") : ""}{t(`接受 ${keep.size}/${rows.length} 处`, `Accept ${keep.size}/${rows.length} edits`)}{active && <kbd aria-hidden="true">↵</kbd>}
        </Button>
      </div>
    </div>
  );
}

function EditBox({ initial, evidence, onCancel, onSave, onPreview }: {
  initial: string; evidence: string; onCancel: () => void; onSave: (t: string) => void; onPreview: (t: string | null) => void;
}) {
  const { t } = useLanguage();
  const [text, setText] = useState(initial);
  const risky = unsupportedClaims(text, evidence);
  return (
    <>
      <Textarea rows={4} value={text} aria-label={t("修改后的内容", "Edited text")} autoFocus onChange={(e) => { setText(e.target.value); onPreview(e.target.value.trim() || null); }} />
      {risky.length > 0 && <div className="unsupported"><AlertTriangle size={13} /><div><b>{t("当前组件的原文未支持这些内容", "The original text does not support these details.")}</b><p>{risky.map((u) => <code key={u}>{u}</code>)}</p></div></div>}
      <div className="actions">
        <Button variant="outline" size="sm" onClick={onCancel}>{t("取消", "Cancel")}</Button>
        <Button size="sm" variant={risky.length ? "warn" : "default"} disabled={!text.trim()} onClick={() => onSave(text.trim())}><Check size={13} />{risky.length ? t("我确认属实，接受修改后的版本", "Confirm details and accept the edited version") : t("接受修改后的版本", "Accept the edited version")}</Button>
      </div>
    </>
  );
}

function Footer({ proposal: p, active, canAccept, warned, canRevert, summary, onAccept, onReject, onRevert, onEdit }: {
  proposal: Proposal; active: boolean; canAccept: boolean; warned?: boolean; canRevert: boolean; summary?: string;
  onAccept: () => void; onReject: () => void; onRevert: () => void; onEdit?: () => void;
}) {
  const { t } = useLanguage();
  const what = summary && <b>· {summary}</b>;
  if (p.status === "accepted") {
    return (
      <div className="actions done">
        <span><Check size={13} className="flex-none" />{t("已接受", "Accepted")}{p.edited ? t("（你改过）", " (edited)") : ""}{what}</span>
        {canRevert && <Button variant="ghost" size="sm" onClick={onRevert}><Undo2 size={12} />{t("撤销", "Undo")}</Button>}
      </div>
    );
  }
  if (p.status === "rejected") return <div className="actions done"><span><X size={13} className="flex-none" />{t("已拒绝", "Rejected")}{what}</span></div>;
  return (
    <div className="actions">
      {onEdit && <Button variant="outline" size="sm" onClick={onEdit}>{t("改一下", "Adjust")}</Button>}
      <Button variant="outline" size="sm" onClick={onReject}>{t("拒绝", "Reject")}</Button>
      {canAccept && (
        <Button variant={warned ? "warn" : "default"} size="sm" data-primary onClick={onAccept}>
          <Check size={13} />{warned ? t("我确认属实，接受", "Confirm details and accept") : t("接受", "Accept")}{active && <kbd aria-hidden="true">↵</kbd>}
        </Button>
      )}
    </div>
  );
}
