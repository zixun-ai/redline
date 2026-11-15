import { localizeError } from "@/lib/errorLocale";
import { useLanguage } from "@/lib/language";
import { ContentForm } from "./LeftPanel";
import type { ExportIssue } from "../lib/check";
import { createContext, useContext, useEffect, useId, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { AlertTriangle, ExternalLink, FileUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog as ShadDialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Resume } from "../lib/types";
import { AI_DEFAULTS, AiError, auditResume, checkInputText, MAX_INPUT_CHARS, structureResume, tailorResume, testKey, validateAiSettings, type AiSettings, type TailorResult } from "../lib/deepseek";
import { fileToText } from "../lib/files";
import { unsupportedClaims } from "../lib/check";
import { resumeText } from "../lib/nodes";

/** False while a dialog is on its way out; it stays mounted just long enough to animate. */
export const DialogOpen = createContext(true);

function Dialog({ title, onClose, children, wide = false, keepFocus = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; keepFocus?: boolean }) {
  const open = useContext(DialogOpen);
  return (
    <ShadDialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent aria-describedby={undefined} className={cn("dialog chrome", wide && "max-w-[1000px]")}
        onCloseAutoFocus={(e) => { if (keepFocus) e.preventDefault(); }}>
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div>{children}</div>
      </DialogContent>
    </ShadDialog>
  );
}

const message = (e: unknown) => (e instanceof AiError ? e.message : "出错了，请重试。");
const destination = (settings: AiSettings, english: boolean) => {
  try { return new URL(settings.baseUrl).host; }
  catch { return english ? "Invalid address" : "无效地址"; }
};

function ProgressNote({ chars }: { chars: number }) {
  const { t } = useLanguage();
  return <p className="dialog-note" role="status" aria-live="polite">{chars > 0 ? t(`正在接收回复 · 已收到 ${chars} 个字符。完成并核对格式后才生成建议。`, `Receiving response (${chars} characters so far). Suggestions appear after Redline receives and checks the full response.`) : t("正在连接 AI 服务，等待回复…", "Connecting to the AI service…")}</p>;
}

export function KeyDialog({ current, remember, settings = AI_DEFAULTS, onSave, onClose }: { current: string; remember: boolean; settings?: AiSettings; onSave: (key: string, remember: boolean, settings: AiSettings) => void; onClose: () => void }) {
  const { english, t } = useLanguage();
  const [key, setKey] = useState(current);
  const [config, setConfig] = useState(settings);
  const [rememberKey, setRememberKey] = useState(remember);
  const rememberId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const open = useContext(DialogOpen);
  const isOpen = useRef(open);
  isOpen.current = open;
  const request = useRef<AbortController | null>(null);
  const cancel = () => { request.current?.abort(); request.current = null; setBusy(false); };
  useEffect(() => {
    if (!open) cancel();
    return () => request.current?.abort();
  }, [open]);

  const save = async () => {
    if (!isOpen.current || !key.trim() || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    try {
      const checked = validateAiSettings(config);
      await testKey(key.trim(), controller.signal, checked);
      if (isOpen.current && request.current === controller && !controller.signal.aborted) onSave(key.trim(), rememberKey, checked);
    } catch (e) {
      if (!controller.signal.aborted) setError(message(e));
    } finally {
      if (request.current === controller) { request.current = null; setBusy(false); }
    }
  };

  return (
    <Dialog title={destination(config, english) === "api.deepseek.com" ? t("连接 DeepSeek", "Connect to DeepSeek") : t("连接 AI 服务", "Connect to an AI service")} onClose={() => { isOpen.current = false; cancel(); onClose(); }}>
      <p className="dialog-note">
        {t(
          `Key 默认只在当前页面使用，刷新后需重新填写。勾选“记住 API Key”后会保存在此浏览器，请勿在共用电脑上勾选。验证只发送极小的测试消息，不发送简历。当前目标：${destination(config, english)}。`,
          `The API key stays on this page until you reload. Select “Remember API key” to save it in this browser. Leave it unchecked on shared computers. Verification sends only a short test message. Destination: ${destination(config, english)}.`,
        )}
      </p>
      <label className="field"><span>Base URL</span>
        <Input type="url" value={config.baseUrl} maxLength={2048} autoCapitalize="none" spellCheck={false} placeholder="https://api.deepseek.com"
          onChange={(e) => { cancel(); setConfig({ ...config, baseUrl: e.target.value }); setKey(""); setRememberKey(false); setError(""); }} />
      </label>
      <p className="dialog-note">{t("支持兼容 OpenAI 的 Chat Completions 接口，可填写带 /v1 的地址。更改 Base URL 会清空 Key，请重新填写该服务的 Key；仅本机地址允许 HTTP。", "Use an OpenAI-compatible Chat Completions API. The URL can end in /v1. Changing the Base URL clears the key so you can enter one for the new service. Use HTTPS except for local addresses.")}</p>
      <label className="field"><span>{t("模型名称", "Model name")}</span>
        <Input value={config.model} maxLength={128} autoCapitalize="none" spellCheck={false}
          onChange={(e) => { cancel(); setConfig({ ...config, model: e.target.value }); setError(""); }} />
      </label>
      <label className="field">
        <span>API Key</span>
        <Input type="password" autoFocus value={key} placeholder="sk-…" autoComplete="off"
          onChange={(e) => { cancel(); setKey(e.target.value); setError(""); }} onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && void save()} />
      </label>
      <div className="flex items-center gap-2 text-sm">
        <input id={rememberId} type="checkbox" checked={rememberKey} className="size-4 accent-primary"
          onChange={(e) => { cancel(); setRememberKey(e.target.checked); }} />
        <label htmlFor={rememberId}>{t("记住 API Key", "Remember API key")}</label>
      </div>
      {error && <p className="dialog-error" role="alert">{localizeError(error, english)}</p>}
      <div className="dialog-foot">
        {destination(config, english) === "api.deepseek.com" && <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer">{t("获取 API Key", "Get an API key")}<ExternalLink size={12} /></a>}
        <span className="model">{config.model}</span>
        {current && <Button variant="outline" onClick={() => { cancel(); onSave("", false, settings); }}>{t("移除", "Remove")}</Button>}
        <Button disabled={!key.trim() || busy} onClick={() => void save()}>
          {busy && <Loader2 size={13} className="spin" />}{t("验证并保存", "Verify and save")}
        </Button>
      </div>
    </Dialog>
  );
}

/**
 * edit ──pick a file──▶ reading ──▶ edit
 * edit ──开始整理──▶ structuring ──▶ review | edit (with the error)
 * review ──返回──▶ edit
 */
type ImportPhase =
  | { at: "edit"; error: string }
  | { at: "reading" }
  | { at: "structuring" }
  | { at: "review"; resume: Resume; source: string; extra: string[] };

const review = (resume: Resume, source: string): ImportPhase =>
  ({ at: "review", resume, source, extra: unsupportedClaims(resumeText(resume), source) });

export function ImportDialog({ apiKey, settings = AI_DEFAULTS, onNeedKey, onImport, onClose, draft, onDraft, resumeRun, onResumed }: {
  apiKey: string; settings?: AiSettings; onNeedKey: () => void; onImport: (r: Resume) => void; onClose: () => void;
  draft: string; onDraft: (text: string) => void; resumeRun: boolean; onResumed: () => void;
}) {
  const { english, t } = useLanguage();
  const [text, setTextState] = useState(draft);
  const setText = (t: string) => { setTextState(t); onDraft(t); };
  const [phase, setPhase] = useState<ImportPhase>({ at: "edit", error: "" });
  const [fileName, setFileName] = useState("");
  const [chars, setChars] = useState(0);
  const textId = useId();
  const abort = useRef<AbortController | null>(null);
  const open = useContext(DialogOpen);
  const isOpen = useRef(open);
  isOpen.current = open;
  const close = () => {
    isOpen.current = false;
    abort.current?.abort();
    abort.current = null;
    if (phase.at === "reading" || phase.at === "structuring") setPhase({ at: "edit", error: "" });
    onClose();
  };
  useEffect(() => {
    if (!open) abort.current?.abort();
    return () => abort.current?.abort();
  }, [open]);

  const pickFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !isOpen.current || abort.current || phase.at !== "edit") return;
    const controller = new AbortController();
    abort.current = controller;
    setPhase({ at: "reading" });
    try {
      const text = await fileToText(file, controller.signal);
      if (!isOpen.current || abort.current !== controller || controller.signal.aborted) return;
      setText(text);
      setFileName(file.name);
      setPhase({ at: "edit", error: "" });
    } catch (err) {
      if (!controller.signal.aborted) setPhase({ at: "edit", error: message(err) });
    } finally {
      if (abort.current === controller) abort.current = null;
      e.target.value = "";
    }
  };

  const run = async () => {
    if (!isOpen.current || abort.current || phase.at !== "edit" || !text.trim()) return;
    try { checkInputText(text); } catch (e) { setPhase({ at: "edit", error: message(e) }); return; }
    if (!apiKey) return onNeedKey();
    // The review shows the text that was sent, even if the box is edited while DeepSeek works.
    const source = text;
    setPhase({ at: "structuring" });
    setChars(0);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const resume = await structureResume(apiKey, source, controller.signal, settings, (value) => {
        if (isOpen.current && abort.current === controller && !controller.signal.aborted) setChars(value);
      });
      if (isOpen.current && abort.current === controller && !controller.signal.aborted) setPhase(review(resume, source));
    } catch (e) {
      if (!controller.signal.aborted) setPhase({ at: "edit", error: message(e) });
    } finally {
      if (abort.current === controller) abort.current = null;
    }
  };

  useEffect(() => {
    if (!resumeRun) return;
    onResumed();
    if (text.trim()) void run();
  }, []);

  if (phase.at === "review") {
    const result = phase;
    const count = result.resume.sections.reduce((n, s) => n + (s.kind === "text" ? 0 : s.items.length), 0);
    return (
      <Dialog title={t("确认导入", "Confirm import")} onClose={close} wide>
        <p className="dialog-note">
          {t(
            `识别出 ${result.resume.basics.name || "未命名"}，${result.resume.sections.length} 个模块、${count} 个条目。导入后会替换当前内容并清空批注，可以用撤销一起恢复原内容和批注。`,
            `Found ${result.resume.basics.name || "an unnamed résumé"} with ${result.resume.sections.length} section(s) and ${count} item(s). Importing replaces the current résumé and clears its comments. Use Undo to restore both.`,
          )}
        </p>
        <div className="import-review">
          <label className="field"><span>{t("原文（只读）", "Source text (read-only)")}</span><Textarea aria-label={t("导入原文", "Imported source text")} readOnly value={result.source} /></label>
          <div><h3>{t("整理结果（可编辑）", "Structured result (editable)")}</h3><ContentForm resume={result.resume} selectedId={null} onChange={(resume) => setPhase(review(resume, result.source))} /></div>
        </div>
        {result.extra.length > 0 && (
          <div className="unsupported">
            <AlertTriangle size={13} />
            <div><b>{t("原文里没有这些内容，请核对", "Check these details. They do not appear in the source text.")}</b><p>{result.extra.map((u) => <code key={u}>{u}</code>)}</p></div>
          </div>
        )}
        <div className="dialog-foot">
          <span />
          <Button variant="outline" onClick={() => setPhase({ at: "edit", error: "" })}>{t("返回", "Back")}</Button>
          <Button onClick={() => onImport(result.resume)}>{t("替换当前简历", "Replace current résumé")}</Button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title={t("导入旧简历", "Import an existing résumé")} onClose={close}>
      <p className="dialog-note" id={`${textId}-help`}>{t(
        `上传 PDF 或 Word，或者粘贴全文。文件在浏览器里读取；点击“开始整理”后，全文（包括其中的联系方式）会发往 ${destination(settings, english)}，使用模型 ${settings.model} 整理结构。文件最多 10 MB，PDF 最多 20 页，文字最多 50000 字；扫描版请先转为可复制文字。`,
        `Choose a PDF or Word file, or paste the full text. Redline reads the file in your browser. When you select “Structure résumé,” it sends the full text, including contact details, to ${destination(settings, english)} using ${settings.model}. Limits: 10 MB per file, 20 PDF pages, and 50,000 characters. Run text recognition on scans first.`,
      )}</p>
      <label className="file-pick">
        <FileUp size={15} />{phase.at === "reading" ? t("正在读取", "Reading file…") : fileName || t("选择文件（.pdf、.docx、.txt）", "Choose a file (.pdf, .docx, .txt, .md)")}
        <input type="file" accept=".pdf,.docx,.txt,.md" disabled={phase.at !== "edit"} onChange={(e) => void pickFile(e)} />
      </label>
      <label htmlFor={textId}>{t("简历原文", "Résumé source text")}</label>
      <Textarea id={textId} className="import-text" rows={10} autoFocus value={text} maxLength={MAX_INPUT_CHARS} aria-describedby={`${textId}-help`} placeholder={t("或在这里粘贴简历全文", "Or paste your full résumé here")}
        onChange={(e) => { setText(e.target.value); if (phase.at === "edit" && phase.error) setPhase({ at: "edit", error: "" }); }} />
      {phase.at === "edit" && phase.error && <p className="dialog-error" role="alert">{localizeError(phase.error, english)}</p>}
      {phase.at === "structuring" && <ProgressNote chars={chars} />}
      <div className="dialog-foot">
        <span />
        {phase.at === "structuring" && <Button variant="outline" onClick={() => { abort.current?.abort(); abort.current = null; setPhase({ at: "edit", error: "已取消，未应用未完成结果。" }); }}>{t("取消本次请求", "Cancel request")}</Button>}
        <Button disabled={!text.trim() || phase.at !== "edit"} onClick={() => void run()}>
          {phase.at === "structuring" && <Loader2 size={13} className="spin" />}{phase.at === "structuring" ? t("正在整理", "Structuring résumé…") : t("开始整理", "Structure résumé")}
        </Button>
      </div>
    </Dialog>
  );
}

type ReviewProps = {
  apiKey: string; settings?: AiSettings; resume: Resume; onNeedKey: () => void;
  onDone: (result: TailorResult) => void; onClose: () => void;
  resumeRun: boolean; onResumed: () => void;
};
type ReviewDraft = { draft: string; onDraft: (text: string) => void };

export function TailorDialog(props: ReviewProps & ReviewDraft) { return <ReviewDialog {...props} mode="tailor" />; }
export function AuditDialog(props: ReviewProps) { return <ReviewDialog {...props} mode="audit" draft="" onDraft={() => {}} />; }

function ReviewDialog({ apiKey, settings = AI_DEFAULTS, resume, onNeedKey, onDone, onClose, draft, onDraft, resumeRun, onResumed, mode }: ReviewProps & ReviewDraft & { mode: "tailor" | "audit" }) {
  const { english, t } = useLanguage();
  const audit = mode === "audit";
  const [jd, setJdState] = useState(draft);
  const setJd = (t: string) => { setJdState(t); onDraft(t); };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [chars, setChars] = useState(0);
  const textId = useId();
  const open = useContext(DialogOpen);
  const isOpen = useRef(open);
  isOpen.current = open;
  const abort = useRef<AbortController | null>(null);
  const cancel = () => { abort.current?.abort(); abort.current = null; setBusy(false); };
  useEffect(() => {
    if (!open) cancel();
    return () => abort.current?.abort();
  }, [open]);

  const run = async () => {
    if (!isOpen.current || abort.current || !audit && !jd.trim()) return;
    try { checkInputText(jd); } catch (e) { setError(message(e)); return; }
    if (!apiKey) return onNeedKey();
    setBusy(true);
    setChars(0);
    setError("");
    const controller = new AbortController();
    abort.current = controller;
    try {
      const progress = (value: number) => { if (isOpen.current && abort.current === controller && !controller.signal.aborted) setChars(value); };
      const result = audit
        ? await auditResume(apiKey, resume, controller.signal, settings, progress)
        : await tailorResume(apiKey, resume, jd, controller.signal, settings, progress);
      if (isOpen.current && abort.current === controller && !controller.signal.aborted) onDone(result);
    } catch (e) {
      if (isOpen.current && abort.current === controller && !controller.signal.aborted) setError(message(e));
    } finally {
      if (abort.current === controller) { abort.current = null; setBusy(false); }
    }
  };
  useEffect(() => {
    if (!resumeRun) return;
    onResumed();
    if (audit || jd.trim()) void run();
  }, []);

  return (
    <Dialog title={audit ? t("简历体检", "Résumé check") : t("按岗位定制", "Tailor to a job")} onClose={() => { isOpen.current = false; cancel(); onClose(); }}>
      <p className="dialog-note" id={`${textId}-help`}>{audit
        ? t("无需岗位描述，只发送待审简历正文，检查表达和待补充信息。", "The review sends only résumé content to check wording and identify details to add. ")
        : t("岗位描述和简历正文将发送给 AI。", "Redline sends the job description and résumé content for review. ")}
        {t(
          `目标：${destination(settings, english)}，模型 ${settings.model}。不附带照片、基本联系字段或历史批注；正文中自行写入的信息仍会发送。建议会批注在相关段落上，由你逐条决定。`,
          `Destination: ${destination(settings, english)}. Model: ${settings.model}. The request excludes photos, contact fields, and previous comments. It includes any details you entered in the résumé body. Review each suggested change in the comments. `,
        )}
        {audit
          ? t("接受前正文不变。未提供完整时间线时，不判断工作空档或履历冲突。", "The résumé changes when you accept a suggestion. The review checks for employment gaps or conflicts only when it has a complete timeline.")
          : t("生成建议后会保留修改前版本。岗位描述最多 50000 字。", "Redline keeps a copy of the résumé before changes. The job description can contain up to 50,000 characters.")}</p>
      {!audit && <><label htmlFor={textId}>{t("岗位描述", "Job description")}</label>
      <Textarea id={textId} className="import-text" rows={12} autoFocus value={jd} maxLength={MAX_INPUT_CHARS} aria-describedby={`${textId}-help`} placeholder={t("粘贴岗位描述", "Paste the job description")}
        onChange={(e) => { setJd(e.target.value); setError(""); }} /></>}
      {error && <p className="dialog-error" role="alert">{localizeError(error, english)}</p>}
      {busy && <ProgressNote chars={chars} />}
      <div className="dialog-foot">
        <span />
        {busy && <Button variant="outline" onClick={() => { cancel(); setError("已取消，未应用未完成结果。"); }}>{t("取消本次请求", "Cancel request")}</Button>}
        <Button disabled={!audit && !jd.trim() || busy} onClick={() => void run()}>
          {busy && <Loader2 size={13} className="spin" />}{busy ? t("正在审阅", "Reviewing…") : audit ? t("开始体检", "Check résumé") : t("开始审阅", "Review résumé")}
        </Button>
      </div>
    </Dialog>
  );
}

export function ExportBlockDialog({ items, onClose, onLocate }: { items: ExportIssue[]; onClose: () => void; onLocate: (id: string) => void }) {
  const { t } = useLanguage();
  return (
    <Dialog title={t("还有内容没填", "Fix issues before export")} onClose={onClose} keepFocus>
      <p className="dialog-note">{t("请先处理以下问题，再导出。点击问题可定位到对应内容；内容过长时，也可以使用顶部的“压缩到一页”。", "Fix these issues before exporting. Select an issue to find it in the résumé. If the content is too long, you can also use “Fit to one page.”")}</p>
      <ul className="block-list">{items.map((item, i) => <li key={i}><Button variant="outline" className="h-auto min-h-8 whitespace-normal py-1 text-left" onClick={() => onLocate(item.targetId)}>{item.text}</Button></li>)}</ul>
      <div className="dialog-foot"><span /><Button onClick={onClose}>{t("知道了", "Got it")}</Button></div>
    </Dialog>
  );
}
