import { isDoc, isThreads, isVersions, isJob, revertStyle, styleStale, sameNodeStyle } from "./lib/storage";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/lib/language";
import { localizeError } from "@/lib/errorLocale";
import { IconButton } from "./components/IconButton";
import { AlertTriangle, Check, CheckCircle2, FileDown, FileUp, Minus, Plus, Redo2, ScanText, Target, Undo2 } from "lucide-react";
import type { Design, Doc, JobTarget, Message, NodeStyle, Payload, Proposal, Resume, Thread, Version } from "./lib/types";
import { applyManualPayload, applyPayload, findNode, flatten, getPayload, targetFacts, quoteOnlyEdit, setNodeStyle, subtitleId, uid } from "./lib/nodes";
import { exportIssues, unsupportedClaims } from "./lib/check";
import { CLOSED, dialogs, resuming } from "./lib/dialogs";
import { canMove, hasPending, safeJobProposals } from "./lib/threads";
import { AI_DEFAULTS, AiError, askForEdit, validateAiSettings, type AiSettings, type TailorResult } from "./lib/deepseek";
import { download, MAX_FILE_BYTES } from "./lib/files";
import type { EditorState, EditorStore } from "./lib/persistence";
import { useLinger } from "./lib/useLinger";
import { nextCompactDesign, normalizeDoc } from "./lib/design";
import { exportResume } from "./lib/export";
import { rememberJob, selectJob } from "./lib/jobs";
import { blankDoc, sampleDoc } from "./lib/sample";
import { A4_W, Canvas, clampZoom } from "./components/Canvas";
import { CommentPanel } from "./components/CommentPanel";
import { LeftPanel } from "./components/LeftPanel";
import { AuditDialog, DialogOpen, ExportBlockDialog, ImportDialog, KeyDialog, TailorDialog } from "./components/Dialogs";

const API_KEY = "redline.apiKey";
const CONNECTION_KEY = "redline.connection.v1";
const LEFT_KEY = "redline.leftPanel";
const WIDTHS_KEY = "redline.panelWidths";

type Snapshot = EditorState;
type Notice = { id: string; text: string; undo?: () => void };
const HISTORY_LIMIT = 80;
/** Widths the user dragged a panel to. A side that was never dragged follows the window. */
type Widths = { left?: number; right?: number };
/** Both side panels plus the canvas gutters. A collapsed left panel keeps only its 48px dock. The panels narrow with
 * a narrow window, as .workspace's clamp()s in styles.css say, so the page keeps more of it. */
const clampWidth = (min: number, share: number, max: number) => Math.min(max, Math.max(min, share * window.innerWidth));
const leftWidth = (w: Widths) => w.left ?? clampWidth(272, 0.22, 312);
const rightWidth = (w: Widths) => w.right ?? clampWidth(288, 0.24, 336);
const panelsWidth = (leftOpen: boolean, w: Widths) => (leftOpen ? leftWidth(w) : 48) + rightWidth(w) + 96;
const COALESCE_MS = 800;
/** Slightly longer than the redline animation in styles.css. */
const FLASH_MS = 1300;
/** Exit durations, matched in styles.css and ui/dialog.tsx. */
const DIALOG_EXIT_MS = 140;
const TOAST_EXIT_MS = 160;
const room = (leftOpen: boolean, w: Widths) => (window.innerWidth - (window.innerWidth < 1100 ? 32 : panelsWidth(leftOpen, w))) / A4_W;
const fitZoom = (leftOpen: boolean, w: Widths) => clampZoom(Math.floor(room(leftOpen, w) * 100) / 100);
/** Fit the sheet to the available width, up to 80% at the default zoom. */
const autoZoom = (leftOpen: boolean, w: Widths) => Math.min(0.8, fitZoom(leftOpen, w));
/** Who set the zoom. The layout's choice and the fit button's keep following the window and the panels; a number the user set stays. */
type ZoomBy = "layout" | "fit" | number;
const zoomFor = (by: ZoomBy, leftOpen: boolean, w: Widths) => (typeof by === "number" ? by : by === "fit" ? fitZoom(leftOpen, w) : autoZoom(leftOpen, w));
/** Matches .workspace.folding's transition in styles.css, plus a frame. */
const FOLD_MS = 180;
const onResize = (change: () => void) => {
  window.addEventListener("resize", change);
  return () => window.removeEventListener("resize", change);
};

function load<T>(key: string, fallback: () => T, valid: (v: unknown) => v is T): T {
  try {
    const raw = localStorage.getItem(key);
    const value: unknown = raw ? JSON.parse(raw) : undefined;
    if (valid(value)) return value;
    if (raw) localStorage.setItem(`${key}.invalid`, raw);
    return fallback();
  } catch {
    return fallback();
  }
}

/** Returns false when the browser refused to store it, so the user can be told. */
function save(key: string, value: string): boolean {
  const write = () => {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  };
  try {
    write();
    return true;
  } catch { return false; }
}

/** The threads whose component is still in the resume. A resume swapped for another one leaves the rest behind. */
const attached = (doc: Doc, threads: Thread[]) => threads.filter((t) => getPayload(doc.resume, t.targetId));

const aiMessage = (text: string, extra: Partial<Message> = {}): Message => ({
  id: uid("m"), role: "ai", text, at: Date.now(), ...extra,
});

export function App({ store }: { store: EditorStore }) {
  const { english, t, toggle } = useLanguage();
  const [doc, setDocState] = useState<Doc>(store.state.doc);
  const [threads, setThreadsState] = useState<Thread[]>(store.state.threads);
  const [connection] = useState(() => {
    try {
      const raw = localStorage.getItem(CONNECTION_KEY);
      if (raw) {
        const value = JSON.parse(raw);
        return { settings: validateAiSettings(value.settings), key: typeof value.key === "string" ? value.key : "" };
      }
      return { settings: AI_DEFAULTS, key: localStorage.getItem(API_KEY) ?? "" };
    } catch { return { settings: AI_DEFAULTS, key: "" }; }
  });
  const [apiKey, setApiKey] = useState(connection.key);
  const [rememberKey, setRememberKey] = useState(() => !!apiKey);
  const [aiSettings, setAiSettings] = useState<AiSettings>(connection.settings);
  const [theme, setTheme] = useState<"system" | "light" | "dark">(() => {
    try { const value = localStorage.getItem("redline.theme"); return value === "light" || value === "dark" ? value : "system"; } catch { return "system"; }
  });
  const [keySaveFailed, setKeySaveFailed] = useState(false);
  const [compactPanel, setCompactPanel] = useState<"content" | "comments" | null>(null);
  const [horizontalTargets, setHorizontalTargets] = useState<string[]>([]);
  const horizontalOverflow = horizontalTargets.length > 0;
  const setHorizontalOverflow = useCallback((ids: string[]) => setHorizontalTargets((old) => old.join("\0") === ids.join("\0") ? old : ids), []);
  const backupEpoch = useRef(0);
  const [photoEpoch, setPhotoEpoch] = useState(0);
  const [past, setPast] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  /** The threads DeepSeek is answering: always the keys of `requests`, kept as state so the page re-renders. */
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<Proposal | null>(null);
  const [overflow, setOverflow] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [leftOpen, setLeftOpen] = useState(() => {
    try { return localStorage.getItem(LEFT_KEY) !== "closed"; } catch { return true; }
  });
  const [widths, setWidths] = useState<Widths>(() => load(WIDTHS_KEY, () => ({}), (v): v is Widths => !!v && typeof v === "object"));
  const setWidth = (side: keyof Widths) => (px: number | null) => setWidths(({ [side]: _, ...rest }) => (px === null ? rest : { ...rest, [side]: px }));
  // The window's width feeds the panels' defaults, so they're read again when it changes.
  const panelWidths = useSyncExternalStore(onResize, () => `${leftWidth(widths)} ${rightWidth(widths)}`).split(" ").map(Number);
  const [folding, setFolding] = useState(false);
  const foldTimer = useRef(0);
  const openLeft = (open: boolean, animate = false) => {
    window.clearTimeout(foldTimer.current);
    setFolding(animate && !matchMedia("(prefers-reduced-motion: reduce)").matches);
    if (animate) foldTimer.current = window.setTimeout(() => setFolding(false), FOLD_MS);
    setLeftOpen(open);
  };
  const [hotThread, setHotThread] = useState<string | null>(null);
  const [zoomBy, setZoomBy] = useState<ZoomBy>("layout");
  // Worked out again whenever the window resizes, and only re-renders when the result changes.
  const zoom = useSyncExternalStore(onResize, () => zoomFor(zoomBy, leftOpen, widths));
  // Which dialog is open, and where the key dialog goes back to: see lib/dialogs.ts.
  const [flow, send] = useReducer(dialogs, CLOSED);
  const dialog = flow.open;
  const setDialog = (name: Exclude<typeof dialog, null> | null) => send(name ? { type: "open", name } : { type: "close" });
  // What was typed into import or tailoring survives the detour to the key dialog.
  const [drafts, setDrafts] = useState({ import: "", tailor: "" });
  const shownDialog = useLinger(dialog, DIALOG_EXIT_MS);
  const [versions, setVersionsState] = useState<Version[]>(store.state.versions);
  const [job, setJobState] = useState<JobTarget | null>(store.state.job);
  /** Squeezing the page onto one: running steps the design down until it fits, failed means it ran out of steps. */
  const [fit, setFit] = useState<"idle" | "running" | "failed">("idle");
  const fitBefore = useRef<Design | null>(null);
  const [storageFailed, setStorageFailed] = useState(store.failed);
  const [savedState, setSavedState] = useState<EditorState>(store.state);
  const saving = savedState.doc !== doc || savedState.threads !== threads || savedState.versions !== versions || savedState.job !== job;
  const temporaryChanges = store.temporary && (store.state.doc !== doc || store.state.threads !== threads || store.state.versions !== versions || store.state.job !== job);
  const [notice, setNotice] = useState<Notice | null>(null);
  const shownNotice = useLinger(notice, TOAST_EXIT_MS);
  const notify = (text: string, undo?: () => void) => setNotice({ id: uid("n"), text, undo });
  // The countdown stops while the toast is pointed at or focused, or the page is hidden, and then
  // resumes with the time it had left, so an undo can't vanish from under the pointer.
  const [holds, setHolds] = useState<{ pointer: Notice | null; focus: Notice | null }>({ pointer: null, focus: null });
  const [pageHidden, setPageHidden] = useState(() => document.hidden);
  const [flashIds, setFlashIds] = useState<string[]>([]);
  const [reveal, setReveal] = useState<{ id: string } | null>(null);
  // The thread the user just decided or undid. Its card stays in view until they go to another thread, so the
  // outcome, its undo and the way to the next one don't move out from under them.
  const [held, setHeld] = useState<string | null>(null);

  // One DeepSeek request per thread, from sending to settling. AI replies arrive later, so they must read the latest
  // state rather than the render that sent them. Undo, import and restores abort them quietly; the user's own cancel
  // leaves a line saying so.
  const requests = useRef(new Map<string, { controller: AbortController; byUser: boolean }>());
  const syncBusy = () => setBusy(new Set(requests.current.keys()));
  const cancelRequests = () => { requests.current.forEach((r) => r.controller.abort()); };
  const cancelRequest = (threadId: string) => {
    const r = requests.current.get(threadId);
    if (!r) return;
    r.byUser = true;
    r.controller.abort();
  };
  useEffect(() => () => cancelRequests(), []);
  const docRef = useRef(doc);
  const threadsRef = useRef(threads);
  const versionsRef = useRef(versions);
  const jobRef = useRef(job);
  const setVersions = (value: Version[] | ((v: Version[]) => Version[])) => {
    versionsRef.current = typeof value === "function" ? value(versionsRef.current) : value;
    setVersionsState(versionsRef.current);
  };
  const setJob = (value: JobTarget | null) => { jobRef.current = value; setJobState(value); };
  const coalesce = useRef({ key: "", at: 0 });

  const setDoc = (next: Doc) => { docRef.current = next; setDocState(next); };
  const setThreads = useCallback((fn: (t: Thread[]) => Thread[]) => {
    threadsRef.current = fn(threadsRef.current);
    setThreadsState(threadsRef.current);
  }, []);

  useEffect(() => {
    let current = true;
    const state = { doc, threads, versions, job };
    void store.save(state).then(() => {
      if (current) { setStorageFailed(false); setSavedState(state); }
    }, () => { if (current) setStorageFailed(true); });
    return () => { current = false; };
  }, [doc, threads, versions, job, store]);
  useEffect(() => {
    const saved = save(CONNECTION_KEY, JSON.stringify({ settings: aiSettings, key: rememberKey ? apiKey : "" }));
    // Keep credentials and their destination in one write; migrate only after it succeeds.
    setKeySaveFailed(!saved || !save(API_KEY, ""));
  }, [aiSettings, apiKey, rememberKey]);
  useEffect(() => {
    save("redline.theme", theme === "system" ? "" : theme);
    const system = matchMedia("(prefers-color-scheme: dark)");
    const sync = () => { document.documentElement.dataset.theme = theme === "system" ? system.matches ? "dark" : "light" : theme; };
    sync();
    system.addEventListener("change", sync);
    return () => system.removeEventListener("change", sync);
  }, [theme]);
  useEffect(() => {
    if (!saving && !storageFailed && !temporaryChanges) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [saving, storageFailed, temporaryChanges]);
  useEffect(() => { save(LEFT_KEY, leftOpen ? "" : "closed"); }, [leftOpen]);
  useEffect(() => { save(WIDTHS_KEY, Object.keys(widths).length ? JSON.stringify(widths) : ""); }, [widths]);

  useEffect(() => {
    const sync = () => setPageHidden(document.hidden);
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);
  const noticeLeft = useRef(0);
  useEffect(() => { if (notice) noticeLeft.current = notice.undo ? 8000 : 4000; }, [notice]);
  const noticeHeld = !!notice && (holds.pointer === notice || holds.focus === notice);
  useEffect(() => {
    if (!notice || noticeHeld || pageHidden) return;
    const started = Date.now();
    const t = setTimeout(() => setNotice(null), noticeLeft.current);
    return () => { clearTimeout(t); noticeLeft.current -= Date.now() - started; };
  }, [notice, noticeHeld, pageHidden]);

  // Each step waits for the page to be re-measured, so it stops as soon as the content fits.
  useEffect(() => {
    if (fit !== "running") return;
    const timer = setTimeout(() => {
      if (pageCount <= 1) { setFit("idle"); return; }
      const next = nextCompactDesign(docRef.current.design);
      if (next) setDoc({ ...docRef.current, design: next });
      else {
        if (fitBefore.current) setDoc({ ...docRef.current, design: fitBefore.current });
        setFit("failed");
        notify(t("无法压到一页，已恢复原版式。请精简内容，或在版式面板允许多页。", "Could not fit on one page. The previous layout was restored. Shorten the content or allow more pages in Layout.") );
      }
    }, 60);
    return () => clearTimeout(timer);
  }, [fit, pageCount, doc.design, t]);

  const snapshot = (): Snapshot => ({ doc: docRef.current, threads: threadsRef.current, versions: versionsRef.current, job: jobRef.current });
  const restoreSnapshot = (state: Snapshot) => {
    coalesce.current = { key: "", at: 0 };
    backupEpoch.current++;
    setFit("idle");
    setPhotoEpoch((e) => e + 1);
    cancelRequests();
    setDoc(state.doc);
    setThreads(() => state.threads);
    setVersions(state.versions);
    setJob(state.job);
    setPreview(null);
    setSelectedId(null);
    setActiveThreadId(null);
  };

  /** Goes back to a saved state from a toast. Can itself be undone, and ignores edits made since. */
  const revertTo = (state: Snapshot) => {
    const now = snapshot();
    setPast((p) => [...p.slice(-HISTORY_LIMIT + 1), now]);
    setFuture([]);
    restoreSnapshot(state);
  };

  const commit = (next: Doc, key = "") => {
    if (key !== "fit") setFit("idle");
    const now = Date.now();
    const same = key && key === coalesce.current.key && now - coalesce.current.at < COALESCE_MS;
    const before = snapshot();
    if (!same) setPast((p) => [...p.slice(-HISTORY_LIMIT + 1), before]);
    coalesce.current = { key, at: now };
    setFuture([]);
    setDoc(next);
  };

  const undo = () => {
    const prev = past[past.length - 1];
    if (!prev) return;
    setPast(past.slice(0, -1));
    setFuture([snapshot(), ...future]);
    restoreSnapshot(prev);
  };
  const redo = () => {
    const [next, ...rest] = future;
    if (!next) return;
    setFuture(rest);
    setPast([...past, snapshot()]);
    restoreSnapshot(next);
  };

  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).matches?.("input,textarea");
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !typing) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
      if (e.key === "Escape" && !typing) setSelectedId(null);
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  });

  /** Deciding a thread's last open proposal resolves it, unless DeepSeek is still answering. Undoing a decision reopens it. */
  const setStatus = (threadId: string, messageId: string, status: Proposal["status"], extra: Partial<Proposal> = {}) =>
    setThreads((ts) => ts.map((t) => {
      if (t.id !== threadId) return t;
      const messages = t.messages.map((m) => (m.id === messageId && m.proposal ? { ...m, proposal: { ...m.proposal, status, ...extra } as Proposal } : m));
      const left = requests.current.has(threadId) || messages.some((m) => m.proposal?.status === "pending");
      return { ...t, messages, resolved: status === "pending" ? false : t.resolved || !left };
    }));
  const reopen = (threadId: string) => setThreads((ts) => ts.map((t) => (t.id === threadId ? { ...t, resolved: false } : t)));

  const appendMessage = (threadId: string, m: Message) =>
    setThreads((ts) => ts.map((t) => (t.id === threadId ? { ...t, messages: [...t.messages, m] } : t)));

  const runAi = async (threadId: string) => {
    const thread = threadsRef.current.find((t) => t.id === threadId);
    if (!thread || requests.current.has(threadId)) return;
    const request = { controller: new AbortController(), byUser: false };
    const { signal } = request.controller;
    requests.current.set(threadId, request);
    syncBusy();
    const sent = docRef.current;
    try {
      const result = await askForEdit(apiKey, sent, thread, signal, aiSettings);
      if (signal.aborted) return;
      if (result.action === "ask") {
        appendMessage(threadId, aiMessage(result.reply, { options: result.options }));
      } else if (result.action === "style") {
        appendMessage(threadId, aiMessage(result.reply, {
          proposal: { id: uid("p"), kind: "style", status: "pending", why: result.why, patch: result.patch, beforeDesign: sent.design },
        }));
      } else if (result.action === "node_style") {
        const targetId = result.subtitle ? subtitleId(thread.targetId) : thread.targetId;
        appendMessage(threadId, aiMessage(result.reply, {
          proposal: {
            id: uid("p"), kind: "nodeStyle", status: "pending", why: result.why, targetId,
            patch: result.patch, beforeStyle: sent.resume.nodeStyles?.[targetId] ?? {},
          },
        }));
      } else {
        const node = findNode(sent.resume, thread.targetId);
        const before = getPayload(sent.resume, thread.targetId);
        if (!node || !before) throw new AiError("这个组件已经被删除了。");
        const quoted = [...thread.messages].reverse().find((m) => m.role === "user");
        if (quoted?.quote && !quoteOnlyEdit(before, result.after, quoted.quote, quoted.quoteRange)) {
          throw new AiError("AI 改动超出了选中的文字，这次结果没有采用，请重试。");
        }
        if (JSON.stringify(before) === JSON.stringify(result.after)) {
          appendMessage(threadId, aiMessage(t("这段内容不需要修改。", "This text does not need changes.")));
        } else {
          appendMessage(threadId, aiMessage(result.reply, {
            proposal: {
              id: uid("p"), kind: "content", status: "pending", why: result.why,
              targetId: thread.targetId, type: node.type,
              before: JSON.stringify(before), after: result.after,
              unsupported: unsupportedClaims(flatten(node.type, result.after), targetFacts(sent.resume, thread.targetId)),
            },
          }));
        }
      }
    } catch (e) {
      // Undo and import abort requests too, and those shouldn't leave a message behind.
      if (signal.aborted && !request.byUser) return;
      appendMessage(threadId, aiMessage(signal.aborted ? t("已取消，可重试。", "Canceled. You can retry.") : e instanceof AiError ? localizeError(e.message, english) : t("出错了，请重试。", "Something went wrong. Please retry."), { failed: true }));
      if (e instanceof AiError && e.needsKey) setDialog("key");
    } finally {
      if (requests.current.get(threadId) === request) requests.current.delete(threadId);
      syncBusy();
    }
  };

  /** Returns false when the comment wasn't sent, so the composer keeps the draft. */
  const comment = (targetId: string, text: string, quote?: string, quoteRange?: Message["quoteRange"]): boolean => {
    if (!apiKey) { setDialog("key"); return false; }
    const message: Message = { id: uid("m"), role: "user", text, at: Date.now(), quote, quoteRange };
    let thread = threadsRef.current.find((t) => t.targetId === targetId && !t.resolved && !t.jobId);
    if (thread) {
      if (requests.current.has(thread.id)) return false;
      appendMessage(thread.id, message);
    } else {
      thread = {
        id: uid("t"), targetId, resolved: false, messages: [message],
        label: findNode(docRef.current.resume, targetId)?.label ?? t("组件", "Component"),
      };
      const created = thread;
      setThreads((ts) => [...ts, created]);
    }
    const id = thread.id;
    setHeld((h) => (h === id ? h : null));
    setActiveThreadId(thread.id);
    setSelectedId(null);
    void runAi(thread.id);
    return true;
  };

  const reply = (threadId: string, text: string): boolean => {
    if (!apiKey) { setDialog("key"); return false; }
    if (requests.current.has(threadId)) return false;
    appendMessage(threadId, { id: uid("m"), role: "user", text, at: Date.now() });
    reopen(threadId);
    void runAi(threadId);
    return true;
  };

  const retry = (threadId: string, messageId: string) => {
    if (!apiKey) { setDialog("key"); return; }
    setThreads((ts) => ts.map((t) =>
      t.id === threadId ? { ...t, resolved: false, messages: t.messages.filter((m) => m.id !== messageId) } : t));
    void runAi(threadId);
  };

  const messageOf = (threadId: string, messageId: string) =>
    threadsRef.current.find((t) => t.id === threadId)?.messages.find((m) => m.id === messageId);

  /** Runs the redline over a component that just changed. */
  const flash = (id: string) => {
    setFlashIds((ids) => [...ids.filter((x) => x !== id), id]);
    setTimeout(() => setFlashIds((ids) => ids.filter((x) => x !== id)), FLASH_MS);
  };

  const accept = (threadId: string, messageId: string, editedAfter?: Payload, batch = "") => {
    const p = messageOf(threadId, messageId)?.proposal;
    if (!canMove(p, "accept")) return false;
    setPreview(null);
    const current = docRef.current;
    if (p.kind !== "content" && styleStale(current, p)) return false;
    if (p.kind === "style") {
      commit({ ...current, design: { ...current.design, ...p.patch } });
    } else if (p.kind === "nodeStyle") {
      commit({ ...current, resume: setNodeStyle(current.resume, p.targetId, p.patch) });
      flash(p.targetId);
    } else {
      const now = getPayload(current.resume, p.targetId);
      if (!now || JSON.stringify(now) !== p.before) return false;
      commit({ ...current, resume: applyPayload(current.resume, p.targetId, editedAfter ?? p.after) }, batch);
      flash(p.targetId);
    }
    setStatus(threadId, messageId, "accepted", editedAfter && p.kind === "content" ? { after: editedAfter, edited: true, unsupported: unsupportedClaims(flatten(p.type, editedAfter), targetFacts(current.resume, p.targetId)) } : {});
    if (!batch) setHeld(threadId);
    return true;
  };

  const reject = (threadId: string, messageId: string) => {
    if (!canMove(messageOf(threadId, messageId)?.proposal, "reject")) return;
    setPreview(null);
    setStatus(threadId, messageId, "rejected");
    setHeld(threadId);
  };

  const revert = (threadId: string, messageId: string) => {
    const p = messageOf(threadId, messageId)?.proposal;
    if (!canMove(p, "revert")) return;
    const current = docRef.current;
    if (p.kind === "style") {
      const design = revertStyle(current.design, p);
      if (!design) return;
      commit({ ...current, design });
    } else if (p.kind === "nodeStyle") {
      const now = current.resume.nodeStyles?.[p.targetId] ?? {};
      if (!sameNodeStyle(now, p.patch, p.patch)) return;
      const restore = Object.fromEntries(Object.keys(p.patch).map((k) => [k, p.beforeStyle[k as keyof NodeStyle]])) as NodeStyle;
      commit({ ...current, resume: setNodeStyle(current.resume, p.targetId, restore) });
    }
    else {
      if (JSON.stringify(getPayload(current.resume, p.targetId)) !== JSON.stringify(p.after)) return;
      commit({ ...current, resume: applyPayload(current.resume, p.targetId, JSON.parse(p.before) as Payload) });
    }
    setStatus(threadId, messageId, "pending");
    setHeld(threadId);
  };

  /** The check on a card. It puts the card away at once, unlike a decision, which leaves it in view. */
  const resolve = (threadId: string, resolved: boolean) => {
    setThreads((ts) => ts.map((t) => (t.id === threadId ? { ...t, resolved } : t)));
    setHeld((h) => (h === threadId ? null : h));
    if (resolved && activeThreadId === threadId) setActiveThreadId(null);
  };

  const activate = (t: Thread) => {
    if (window.innerWidth < 1100) setCompactPanel("comments");
    setActiveThreadId(t.id);
    setSelectedId(null);
    setHeld((h) => (h === t.id ? h : null));
    setReveal({ id: t.targetId });
  };

  const nextPending = useMemo(() => {
    const at = threads.findIndex((t) => t.id === held);
    if (at < 0 || hasPending(threads[at])) return null;
    const to = [...threads.slice(at + 1), ...threads.slice(0, at)].find((t) => !t.resolved && hasPending(t));
    return to ? { from: threads[at].id, to: to.id } : null;
  }, [threads, held]);

  const shown: Doc = useMemo(() => {
    if (!preview) return doc;
    if (preview.kind === "style") return { ...doc, design: { ...doc.design, ...preview.patch } };
    if (preview.kind === "nodeStyle") return { ...doc, resume: setNodeStyle(doc.resume, preview.targetId, preview.patch) };
    return { ...doc, resume: applyPayload(doc.resume, preview.targetId, preview.after) };
  }, [doc, preview]);

  const addVersion = (name: string) =>
    setVersions((v) => [{ id: uid("v"), name, at: Date.now(), doc: docRef.current, job: jobRef.current }, ...v]);

  const restoreVersion = (v: Version) => {
    replaceDoc(normalizeDoc(v.doc), t(`已恢复「${v.name}」`, `Restored “${v.name}”`), true);
    if (v.job !== undefined) setJob(v.job);
  };

  const renameVersion = (id: string, name: string) => {
    const value = name.trim();
    if (!value || value.length > 100 || !versionsRef.current.some((v) => v.id === id && v.name !== value)) return;
    commit(docRef.current);
    setVersions((list) => list.map((v) => v.id === id ? { ...v, name: value } : v));
  };

  const deleteVersion = (id: string) => {
    const gone = versions.find((x) => x.id === id);
    if (!gone) return;
    const before = snapshot();
    commit(docRef.current);
    setVersions((v) => v.filter((x) => x.id !== id));
    notify(t(`已删除「${gone.name}」`, `Deleted “${gone.name}”`), () => revertTo(before));
  };

  /** Swaps the whole resume. Comments on components the new one doesn't have go with the old one, and come back with it on undo. */
  const replaceDoc = (next: Doc, note: string, keepJob = false) => {
    backupEpoch.current++;
    setPhotoEpoch((e) => e + 1);
    const before = snapshot();
    cancelRequests();
    commit(next);
    setThreads((ts) => attached(next, ts));
    if (!keepJob) setJob(null);
    setSelectedId(null);
    setActiveThreadId(null);
    setPreview(null);
    setFit("idle");
    notify(note, () => revertTo(before));
  };

  const backup = () => {
    const name = doc.resume.basics.name || t("简历", "Resume");
    download(t(`${name}-Redline备份.json`, `${name}-Redline-backup.json`), JSON.stringify({ app: "redline", doc, threads, versions, job }));
  };

  const restoreBackup = async (file: File) => {
    const epoch = ++backupEpoch.current;
    const tooLarge = t("备份不能超过 10 MB", "The backup must be 10 MB or smaller.");
    const invalid = t("这个文件不是有效的 Redline 备份", "This file is not a valid Redline backup.");
    try {
      if (file.size > MAX_FILE_BYTES) throw new Error(tooLarge);
      const data = JSON.parse(await file.text()) as { doc?: unknown; threads?: Thread[]; versions?: Version[]; job?: unknown };
      if (epoch !== backupEpoch.current) return;
      if (!isDoc(data.doc) || (data.threads !== undefined && !isThreads(data.threads))
        || (data.versions !== undefined && !isVersions(data.versions))
        || (data.job !== undefined && !isJob(data.job))) throw new Error(invalid);
      const before = snapshot();
      commit(normalizeDoc(data.doc));
      restoreSnapshot({ doc: normalizeDoc(data.doc), threads: data.threads ?? [], versions: data.versions ?? [], job: data.job ?? null });
      notify(t("已从备份恢复", "Restored from backup"), () => revertTo(before));
    } catch (error) {
      if (epoch === backupEpoch.current) notify(error instanceof Error && error.message === tooLarge ? tooLarge : invalid);
    }
  };

  const applyTailor = (result: TailorResult, audit = false) => {
    commit(docRef.current);
    const jobId = uid("job");
    const targets = new Set<string>();
    if (!audit) addVersion(`${t("定制前", "Before tailoring")} · ${new Date().toLocaleDateString(t("zh-CN", "en"))}`);
    const current = docRef.current;
    const added = result.edits.flatMap((e): Thread[] => {
      const node = findNode(current.resume, e.targetId);
      const before = getPayload(current.resume, e.targetId);
      if (!node || !before || targets.has(e.targetId)) return [];
      targets.add(e.targetId);
      const after = { text: e.text };
      return [{
        id: uid("t"), jobId: audit ? undefined : jobId, targetId: e.targetId, label: node.label, resolved: false,
        messages: [
          { id: uid("m"), role: "user", text: t(`${audit ? "体检建议" : "岗位要求"}：${e.requirement}`, `${audit ? "Audit finding" : "Job requirement"}: ${e.requirement}`), at: Date.now(), fromJd: !audit },
          aiMessage(t("建议这样调整。", "Suggested change."), {
            fromJd: !audit,
            proposal: {
              id: uid("p"), kind: "content", status: "pending", why: e.why,
              targetId: e.targetId, type: node.type, before: JSON.stringify(before), after,
              unsupported: unsupportedClaims(e.text, targetFacts(current.resume, e.targetId)),
            },
          }),
        ],
      }];
    });
    setThreads((ts) => [...ts, ...added]);
    if (!audit) setJob(rememberJob(jobRef.current, { id: jobId, summary: result.summary, missing: result.missing, matched: result.matched }));
    else {
      const details = result.missing.length ? t(`另需核实：${result.missing.join("；")}`, `Verify: ${result.missing.join("; ")}`) : result.summary;
      notify(t(`体检完成，新增 ${added.length} 条批注。${details}`, `Audit complete. Added ${added.length} ${added.length === 1 ? "comment" : "comments"}. ${details}`));
    }
    setDrafts((d) => ({ ...d, tailor: "" }));
    // Folded comments only show their first line, so open the first new one: there is always a change in view to decide.
    setActiveThreadId(added[0]?.id ?? null);
    setDialog(null);
  };

  const safeProposals = useMemo(() => safeJobProposals(doc, threads, job), [threads, doc, job]);

  const acceptSafe = () => {
    const before = snapshot();
    const count = safeProposals.filter((s) => accept(s.threadId, s.messageId, undefined, "accept-safe")).length;
    notify(t(`已接受 ${count} 处，批注移到了「已解决」`, `Accepted ${count} ${count === 1 ? "change" : "changes"}. The comments moved to Resolved.`), () => revertTo(before));
  };

  const exportBlocks = exportIssues(doc.resume, overflow, doc.design.pageLimit, t);
  for (const targetId of horizontalTargets) {
    const label = findNode(doc.resume, targetId)?.label;
    exportBlocks.push({ targetId, text: t(
      `${label ?? "部分内容"}超出可用宽度，请缩短长文本或调整排版。`,
      `${label ?? "Some content"} exceeds the available width. Shorten the text or adjust the layout.`,
    ) });
  }
  const exportPdf = () => {
    const left = exportBlocks;
    if (left.length) { setDialog("block"); return; }
    const title = document.title;
    document.title = `${doc.resume.basics.name || t("简历", "Resume")}-${t("简历", "Resume")}`;
    window.print();
    document.title = title;
  };

  const importResume = (resume: Resume) => {
    backupEpoch.current++;
    setPreview(null);
    setFit("idle");
    setPhotoEpoch((e) => e + 1);
    setDrafts((d) => ({ ...d, import: "" }));
    cancelRequests();
    commit({ ...docRef.current, resume });
    setThreads(() => []);
    setJob(null);
    setSelectedId(null);
    setActiveThreadId(null);
    setDialog(null);
  };

  const changeResume = useCallback((resume: Resume, key: string) => commit({ ...docRef.current, resume }, key), []);
  const changeDesign = useCallback((design: Design, key: string) => commit({ ...docRef.current, design }, key), []);
  const startFit = () => {
    fitBefore.current = docRef.current.design;
    commit({ ...docRef.current, design: { ...docRef.current.design, pageLimit: 1 } }, "fit");
    setFit("running");
  };
  const closeDialog = useCallback(() => send({ type: "close" }), []);
  const resumed = useCallback(() => send({ type: "resumed" }), []);

  return (
    <div className="app">
      <header className="topbar chrome">
        <div className="brand-row">
          <div className="brand">
            <span>Redline</span>
            <svg viewBox="0 0 74 6" aria-hidden="true"><path pathLength="1" d="M1.5 3.6C14 1.6 26 4.6 38 2.9S61 1.7 72.5 3.4" /></svg>
          </div>
          {store.temporary ? <span className="save-state failed" title={t("关闭前请到版本页下载备份", "Download a backup from Versions before closing")}><AlertTriangle size={13} />{t("临时会话 · 未自动保存", "Temporary session · Autosave off")}</span> : storageFailed
            ? <span className="save-state failed"><AlertTriangle size={13} />{t("未能保存", "Save failed")}</span>
            : <span className="save-state" title={t("内容只存在这个浏览器里，换设备或清理浏览器数据前请下载备份", "Data stays in this browser. Download a backup before switching devices or clearing browser data.")}><Check size={13} />{saving ? t("正在保存…", "Saving…") : t("已保存在本机", "Saved on this device")}</span>}
        </div>
        <div className="tools">
          <IconButton label={t("撤销", "Undo")} tip={t("撤销 (⌘Z)", "Undo (⌘Z)")} onClick={undo} disabled={!past.length}><Undo2 size={16} /></IconButton>
          <IconButton label={t("重做", "Redo")} tip={t("重做 (⇧⌘Z)", "Redo (⇧⌘Z)")} onClick={redo} disabled={!future.length}><Redo2 size={16} /></IconButton>
          <span className="sep" />
          <IconButton label={t("缩小", "Zoom out")} onClick={() => setZoomBy(clampZoom(+(zoom - 0.1).toFixed(2)))}><Minus size={15} /></IconButton>
          <button className="zoom" title={t("点击切换 100% 和适合宽度", "Switch between 100% and fit to width")} aria-label={t(`缩放 ${Math.round(zoom * 100)}%，点击切换 100% 和适合宽度`, `Zoom ${Math.round(zoom * 100)}%. Switch between 100% and fit to width.`)}
            onClick={() => setZoomBy(Math.abs(zoom - 1) < 0.005 ? "fit" : 1)}>{Math.round(zoom * 100)}%</button>
          <IconButton label={t("放大", "Zoom in")} onClick={() => setZoomBy(clampZoom(+(zoom + 0.1).toFixed(2)))}><Plus size={15} /></IconButton>
          <span className="sep" />
          {overflow > 0
            ? (
              <>
                <span className="fit over"><AlertTriangle size={14} />{fit === "failed" ? t("无法压到一页，已恢复原版式", "Could not fit on one page. Layout restored.") : t(`超出${doc.design.pageLimit === 1 ? "一" : doc.design.pageLimit}页约 ${overflow} 行`, `About ${overflow} ${overflow === 1 ? "line" : "lines"} over the page limit`)}</span>
                {fit !== "failed" && <Button variant="outline" size="sm" className="ml-2" disabled={fit === "running"} onClick={startFit}>{t("压缩到一页", "Fit to one page")}</Button>}
              </>
            )
            : horizontalOverflow ? <span className="fit over"><AlertTriangle size={14} />{t("内容超出纸张宽度", "Content exceeds page width")}</span> : <>
              <span className="fit" title={pageCount > 1 ? t("按连续画布估算；浏览器会避开段落分页，请在打印预览核对最终页数", "This count is an estimate. Check the final page count in print preview.") : undefined}><CheckCircle2 size={14} />{pageCount > 1 ? t(`预计 ${pageCount} 页`, `About ${pageCount} pages`) : t("刚好一页", "One page")}</span>
              {pageCount > 1 && <Button variant="outline" size="sm" className="ml-2" disabled={fit === "running"} onClick={startFit}>{t("压缩到一页", "Fit to one page")}</Button>}
            </>}
        </div>
        <div className="actions-top">
          <Button variant="outline" onClick={toggle} title={t("切换到英文", "Switch to Chinese")}>
            <span lang={english ? "zh-CN" : "en"}>{t("English", "中文")}</span>
          </Button>
          <Button variant="outline" onClick={() => setDialog("import")}><FileUp size={14} />{t("导入", "Import")}</Button>
          <Button variant="outline" onClick={() => setDialog("audit")}><ScanText size={14} />{t("AI 体检", "AI audit")}</Button>
          <Button variant="outline" onClick={() => setDialog("tailor")}><Target size={14} />{t("按岗位定制", "Tailor to job")}</Button>
        </div>
        <Button className="export-pdf" variant={apiKey ? "default" : "outline"} onClick={exportPdf}><FileDown size={14} />{t("导出 PDF", "Export PDF")}</Button>
      </header>

      {Object.keys(store.recovery).length > 0 && <div className="recovery-notice chrome" role="status">{t("部分旧数据无法读取，已保留原件。", "Some old data could not be read. The original data is still available.")}<Button variant="ghost" onClick={() => download(t("Redline-恢复数据.json", "Redline-recovery-data.json"), JSON.stringify(store.recovery))}>{t("下载恢复数据", "Download recovery data")}</Button></div>}
      {keySaveFailed && <p className="chrome" role="alert">{t("API Key 保存失败，请重新设置；本页仍可使用。", "Could not save the API key. You can still use this page. Enter the key again to save it.")}</p>}
      <nav className="compact-nav chrome" aria-label={t("编辑区域", "Editing area")}>
        <button aria-pressed={compactPanel === null} onClick={() => setCompactPanel(null)}>{t("简历", "Resume")}</button>
        <button aria-pressed={compactPanel === "content"} onClick={() => { setCompactPanel("content"); openLeft(true); }}>{t("内容", "Content")}</button>
        <button aria-pressed={compactPanel === "comments"} onClick={() => setCompactPanel("comments")}>{t("批注", "Comments")}</button>
      </nav>
      <div data-panel={compactPanel ?? "canvas"} className={cn("workspace", !leftOpen && "left-closed", folding && "folding")}
        style={{ "--left-w": widths.left && `${widths.left}px`, "--right-w": widths.right && `${widths.right}px` } as CSSProperties}>
        <LeftPanel
          temporary={store.temporary}
          theme={theme}
          onThemeChange={setTheme}
          onRenameVersion={renameVersion}
          onExportText={(format) => download(`${doc.resume.basics.name || t("简历", "Resume")}.${format === "markdown" ? "md" : "txt"}`, exportResume(doc, format), `text/${format === "markdown" ? "markdown" : "plain"};charset=utf-8`)}
          open={leftOpen}
          onOpenChange={openLeft}
          width={panelWidths[0]}
          onWidth={setWidth("left")}
          doc={doc}
          selectedId={selectedId}
          photoEpoch={photoEpoch}
          onResume={changeResume}
          onDesign={changeDesign}
          versions={versions}
          onSaveVersion={(name) => { commit(docRef.current); addVersion(name); notify(store.temporary ? t(`已暂存「${name}」，关闭前请下载备份`, `Saved “${name}” for this session. Download a backup before closing.`) : t(`已保存「${name}」`, `Saved “${name}”`)); }}
          onRestoreVersion={restoreVersion}
          onDeleteVersion={deleteVersion}
          onNewBlank={() => replaceDoc(blankDoc(doc.design), t("已新建空白简历", "Created a blank resume"))}
          onLoadSample={() => replaceDoc(sampleDoc(), t("已载入示例", "Loaded sample resume"))}
          onBackup={backup}
          onRestoreBackup={(file) => void restoreBackup(file)}
        />
        <Canvas
          committedDoc={doc}
          onManualEdit={(id, payload) => { setPreview(null); commit({ ...docRef.current, resume: applyManualPayload(docRef.current.resume, id, payload) }); }}
          onPageCount={setPageCount}
          onHorizontalOverflow={setHorizontalOverflow}
          resume={shown.resume}
          design={shown.design}
          threads={threads}
          selectedId={selectedId}
          activeThreadId={activeThreadId}
          hotThreadId={hotThread}
          previewId={preview && preview.kind !== "style" ? preview.targetId : null}
          previewWhole={preview?.kind === "style"}
          busy={busy}
          flashIds={flashIds}
          zoom={zoom}
          reveal={reveal}
          onZoom={setZoomBy}
          onSelect={setSelectedId}
          onOpenThread={activate}
          onComment={comment}
          onNodeStyle={(id, patch) => commit({ ...docRef.current, resume: setNodeStyle(docRef.current.resume, id, patch) })}
          onOverflow={setOverflow}
        />
        <CommentPanel
          doc={doc}
          threads={threads}
          activeId={activeThreadId}
          reveal={reveal}
          heldId={held}
          busy={busy}
          onActivate={activate}
          onReply={reply}
          onRetry={retry}
          onCancel={cancelRequest}
          nextPending={nextPending}
          onNext={(id) => { const t = threads.find((x) => x.id === id); if (t) activate(t); }}
          onAccept={accept}
          onReject={reject}
          onRevert={revert}
          onResolve={resolve}
          onPreview={setPreview}
          onOption={reply}
          job={job}
          safeCount={safeProposals.length}
          onAcceptSafe={acceptSafe}
          onClearJob={() => { commit(docRef.current); setJob(null); }}
          onSelectJob={(id) => { const current = jobRef.current; if (!current) return; const next = selectJob(current, id); if (next === current) return; commit(docRef.current); setJob(next); }}
          hasKey={!!apiKey}
          onKey={() => setDialog("key")}
          onHover={setHotThread}
          width={panelWidths[1]}
          onWidth={setWidth("right")}
        />
      </div>

      {(shownNotice || storageFailed) && (
        // A new message replaces the old one with its own entrance, so it reads as new.
        <div key={storageFailed ? "storage" : shownNotice?.id} className={cn("toast chrome", storageFailed && "bad", !notice && !storageFailed && "leaving")} role="status"
          onPointerEnter={() => setHolds((h) => ({ ...h, pointer: notice }))} onPointerLeave={() => setHolds((h) => ({ ...h, pointer: null }))}
          onFocus={() => setHolds((h) => ({ ...h, focus: notice }))} onBlur={() => setHolds((h) => ({ ...h, focus: null }))}>
          <span>{storageFailed ? t("未能保存这次修改，已保留上次完整保存。请下载备份，或删除部分版本后重试。", "Could not save these changes. Your last saved copy is intact. Download a backup, or delete some versions and retry.") : shownNotice?.text}</span>
          {!storageFailed && shownNotice?.undo && <button onClick={() => { shownNotice.undo?.(); setNotice(null); }}>{t("撤销", "Undo")}</button>}
        </div>
      )}


      <DialogOpen.Provider value={dialog !== null}>
      {shownDialog === "key" && (
        <KeyDialog current={apiKey} remember={rememberKey} settings={aiSettings}
          onClose={() => send({ type: "keyClosed" })}
          onSave={(key, remember, settings) => { cancelRequests(); setApiKey(key); setRememberKey(remember); setAiSettings(settings); send({ type: "keySaved", key }); }} />
      )}
      {shownDialog === "import" && (
        <ImportDialog apiKey={apiKey} settings={aiSettings} onNeedKey={() => send({ type: "needKey", from: "import" })} onImport={importResume} onClose={closeDialog}
          draft={drafts.import} onDraft={(t) => setDrafts((d) => ({ ...d, import: t }))}
          resumeRun={resuming(flow, "import")} onResumed={resumed} />
      )}
      {shownDialog === "tailor" && (
        <TailorDialog apiKey={apiKey} settings={aiSettings} resume={doc.resume} onNeedKey={() => send({ type: "needKey", from: "tailor" })} onDone={applyTailor} onClose={closeDialog}
          draft={drafts.tailor} onDraft={(t) => setDrafts((d) => ({ ...d, tailor: t }))}
          resumeRun={resuming(flow, "tailor")} onResumed={resumed} />
      )}
      {shownDialog === "audit" && <AuditDialog apiKey={apiKey} settings={aiSettings} resume={doc.resume} onNeedKey={() => send({ type: "needKey", from: "audit" })}
        onDone={(result) => applyTailor(result, true)} onClose={closeDialog} resumeRun={resuming(flow, "audit")} onResumed={resumed} />}
      {shownDialog === "block" && <ExportBlockDialog items={exportBlocks} onClose={closeDialog} onLocate={(id) => { setDialog(null); setSelectedId(id); setReveal({ id }); }} />}
      </DialogOpen.Provider>
    </div>
  );
}
