import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SegmentThumb } from "@/components/ui/segment-thumb";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useLanguage } from "@/lib/language";
import { ENGLISH_DESIGN_OPTIONS, ENGLISH_TEMPLATES } from "@/lib/designLocale";
import { cn, markScrolled, scrollMotion } from "@/lib/utils";
import { IconButton } from "./IconButton";
import { BASICS, ENGLISH_BASICS, type BasicsKey } from "../lib/basics";
import { ArrowDown, ArrowUp, Briefcase, Cake, CalendarCheck, Check, ChevronRight, Download, FileDiff, FilePlus2, FileText, FileUser, Flag, GripVertical, Heart, History, Hourglass, House, ImagePlus, LayoutTemplate, Link2, Mail, MapPin, MessageCircle, PanelLeftClose, PanelLeftOpen, Pencil, Phone, Plus, RotateCcw, Save, Trash2, Upload, User, UserRound, Users, Wallet, X, type LucideIcon } from "lucide-react";
import type { Basics, Design, Doc, Item, ListSection, Resume, Section, SectionKind, TemplateId, Version } from "../lib/types";
import { ACCENTS, DENSITIES, FONTS, FONT_SCALE, HEADINGS, LATIN_FONTS, MARGINS, TEMPLATES, contrastOnWhite, fontInstalled, fontStack, getTemplate } from "../lib/design";
import { subtitleId, titleId, uid } from "../lib/nodes";
import { ResizeHandle } from "./ResizeHandle";
import { PhotoCropDialog } from "./PhotoCropDialog";
import { VersionCompareDialog } from "./VersionCompareDialog";
import "./leftpanel-upgrades.css";

type Props = {
  temporary?: boolean;
  open: boolean;
  /** `animate` is set when the pointer asked; the keyboard folds at once. */
  onOpenChange: (open: boolean, animate?: boolean) => void;
  width: number;
  onWidth: (w: number | null) => void;
  doc: Doc;
  selectedId: string | null;
  onResume: (r: Resume, key: string) => void;
  photoEpoch: number;
  onDesign: (d: Design, key: string) => void;
  versions: Version[];
  onSaveVersion: (name: string) => void;
  onRestoreVersion: (v: Version) => void;
  onDeleteVersion: (id: string) => void;
  onRenameVersion: (id: string, name: string) => void;
  onNewBlank: () => void;
  onLoadSample: () => void;
  onBackup: () => void;
  onRestoreBackup: (file: File) => void;
  onExportText: (format: "markdown" | "text") => void;
  theme: "system" | "light" | "dark";
  onThemeChange: (theme: "system" | "light" | "dark") => void;
};

const PANEL_TABS = [
  { id: "content", name: "内容", english: "Content", Icon: FileText },
  { id: "design", name: "版式", english: "Layout", Icon: LayoutTemplate },
  { id: "versions", name: "版本", english: "Versions", Icon: History },
] as const;
type PanelTab = (typeof PANEL_TABS)[number]["id"];

export function LeftPanel({ open, onOpenChange, width, onWidth, doc, selectedId, onResume, onDesign, photoEpoch, theme, onThemeChange, ...versions }: Props) {
  const { t } = useLanguage();
  const [tab, setTab] = useState<PanelTab>("content");
  const tabsId = useId();
  useEffect(() => { if (selectedId) setTab("content"); }, [selectedId]);

  // Folding the panel removes whatever had focus inside it. The toggle stays put in both shapes, so it
  // takes focus back, and a dock button hands it to the tab it opened.
  const root = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const tabList = useRef<HTMLDivElement>(null);
  const refocus = useRef<"toggle" | "tab" | null>(null);
  useEffect(() => {
    const to = refocus.current === "tab" ? tabList.current?.querySelector<HTMLElement>('[role="tab"][data-state="active"]') : refocus.current === "toggle" ? toggle.current : null;
    refocus.current = null;
    if (!to) return;
    to.dataset.quiet = "";
    to.focus();
    delete to.dataset.quiet;
  }, [open]);
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || (e.key !== "\\" && e.code !== "Backslash") || e.isComposing) return;
      e.preventDefault();
      if (root.current?.contains(document.activeElement) && document.activeElement !== toggle.current) refocus.current = "toggle";
      onOpenChange(!open);
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [open, onOpenChange]);
  const show = (id: PanelTab) => { setTab(id); refocus.current = "tab"; onOpenChange(true, true); };

  const toggleLabel = open ? t("收起左栏", "Collapse left panel") : t("展开左栏", "Expand left panel");

  return (
    <aside ref={root} className={cn("panel left chrome", !open && "docked")}>
      <div className="panel-head">
        <IconButton ref={toggle} label={toggleLabel} tip={`${toggleLabel} (⌘\\)`} side={open ? "bottom" : "right"}
          onClick={() => onOpenChange(!open, true)}
          // Focus handed back by the fold isn't a visit, so it doesn't open the tooltip.
          onFocus={(e) => { if (e.currentTarget.dataset.quiet !== undefined) e.preventDefault(); }}>
          {open ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        </IconButton>
        {open ? (
          <Tabs className="min-w-0 flex-1" value={tab} onValueChange={(v) => setTab(v as PanelTab)}>
            <TabsList ref={tabList} aria-label={t("简历编辑", "Resume editor")} className="grid w-full grid-flow-col auto-cols-fr">
              <SegmentThumb index={PANEL_TABS.findIndex((t) => t.id === tab)} labels={PANEL_TABS.map((tab) => t(tab.name, tab.english))} />
              {PANEL_TABS.map(({ id, name, english }) => <TabsTrigger key={id} value={id} id={`${tabsId}-${id}`} aria-controls={`${tabsId}-${id}-panel`}>{t(name, english)}</TabsTrigger>)}
            </TabsList>
          </Tabs>
        ) : (
          <nav className="dock" aria-label={t("左栏", "Left panel")}>
            {PANEL_TABS.map(({ id, name, english, Icon }) => (
              <IconButton key={id} label={t(name, english)} side="right" onClick={() => show(id)}><Icon size={16} /></IconButton>
            ))}
          </nav>
        )}
      </div>
      {/* Hidden rather than unmounted, so each tab keeps its scroll, its open entries and anything half typed. */}
      <ContentForm tabId={`${tabsId}-content`} hidden={!open || tab !== "content"} resume={doc.resume} selectedId={selectedId} onChange={onResume} photoEpoch={photoEpoch} template={doc.design.template} />
      <DesignForm tabId={`${tabsId}-design`} hidden={!open || tab !== "design"} doc={doc} onChange={onDesign} theme={theme} onThemeChange={onThemeChange} />
      <VersionsForm tabId={`${tabsId}-versions`} hidden={!open || tab !== "versions"} doc={doc} {...versions} />
      {open && <ResizeHandle side="left" label={t("调整左栏宽度", "Resize left panel")} width={width} min={248} max={440} onWidth={onWidth} />}
    </aside>
  );
}

/** A labelled value. `hide` keeps the name for screen readers only, where a placeholder already shows it. */
function Field({ label, className, hide, children }: { label: string; className?: string; hide?: boolean; children: ReactNode }) {
  return <label className={cn("field", className)}><span className={hide ? "sr-only" : undefined}>{label}</span>{children}</label>;
}

/** Each property row's mark, so the column of names can be scanned by shape as well as by word. */
const ICONS: Record<BasicsKey, LucideIcon> = {
  name: User, title: Briefcase, phone: Phone, email: Mail, wechat: MessageCircle, location: MapPin, website: Link2,
  gender: UserRound, birth: Cake, ethnicity: Users, hometown: House, politics: Flag, marital: Heart,
  years: Hourglass, salary: Wallet, availability: CalendarCheck,
};
/** Asked for by some employers and left out by most resumes, so they start folded under a line saying what they hold. */
const OPTIONAL = ["个人情况", "求职意向"];
const ENGLISH_GROUPS = { 身份: "Identity", 联系方式: "Contact", 个人情况: "Personal details", 求职意向: "Job preferences" };
const ENGLISH_HINTS: Partial<Record<BasicsKey, string>> = {
  gender: "Male / Female", birth: "1996.05", ethnicity: "Han Chinese", hometown: "Hangzhou, Zhejiang",
  politics: "e.g. CCP member", marital: "Single / Married", years: "5 years", salary: "25-30K", availability: "Within one month",
};

/** A textarea that grows with its content, so a long bullet is readable while it's edited. Quiet, like the rows above it. */
function AutoText({ value, onChange, label, placeholder, className, onKeyDown }: {
  value: string; onChange: (v: string) => void; label: string; placeholder?: string; className?: string; onKeyDown?: (e: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || CSS.supports("field-sizing", "content")) return;
    const fit = () => {
      if (!el.clientWidth) return;
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight + 2}px`;
    };
    fit();
    // Hidden forms report zero width; observing width also catches their return and sidebar resizing.
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (width === el.clientWidth) return;
      width = el.clientWidth;
      fit();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [value]);
  return <Textarea ref={ref} quiet className={cn("auto-text min-h-0 resize-none", className)} rows={1} value={value} aria-label={label} placeholder={placeholder}
    onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} />;
}

const move = <T,>(list: T[], i: number, by: number): T[] => {
  const next = [...list];
  const [x] = next.splice(i, 1);
  next.splice(i + by, 0, x);
  return next;
};

const KIND_TITLES: Record<SectionKind, string> = { experience: "工作经历", project: "项目经历", education: "教育经历", skill: "专业技能", other: "其他经历", text: "个人总结" };
const ENGLISH_KIND_TITLES: Record<SectionKind, string> = {
  experience: "Work experience", project: "Projects", education: "Education", skill: "Skills", other: "Other experience", text: "Personal profile",
};

const newSection = (kind: SectionKind): Section => kind === "text"
  ? { id: uid("s"), kind, title: KIND_TITLES[kind], body: { id: uid("txt"), text: "" } }
  : { id: uid("s"), kind, title: KIND_TITLES[kind], items: [] };

const entriesOf = (s: Section | undefined) => (s && s.kind !== "text" ? s.items : []);

/** What each kind calls an entry's fields. A skill is a label and its lines, so it has no subtitle or time. */
const ENTRY_FIELDS: Record<ListSection["kind"], { name: string; sub?: string }> = {
  experience: { name: "公司名称", sub: "职位" },
  project: { name: "项目名称", sub: "角色" },
  education: { name: "学校名称", sub: "专业" },
  skill: { name: "技能类别" },
  other: { name: "名称", sub: "说明" },
};
const ENGLISH_ENTRY_FIELDS: typeof ENTRY_FIELDS = {
  experience: { name: "Company", sub: "Job title" },
  project: { name: "Project name", sub: "Role" },
  education: { name: "School", sub: "Field of study" },
  skill: { name: "Skill category" },
  other: { name: "Name", sub: "Description" },
};

export function ContentForm({ hidden = false, tabId, resume, selectedId, onChange, photoEpoch = 0, template }: { hidden?: boolean; tabId?: string; photoEpoch?: number; template?: TemplateId; resume: Resume; selectedId: string | null; onChange: (r: Resume, key: string) => void }) {
  const { english, t } = useLanguage();
  const root = useRef<HTMLDivElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(() => new Set(entriesOf(resume.sections[0]).slice(0, 1).map((it) => it.id)));
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) => setOpen((o) => {
    const n = new Set(o);
    if (!n.delete(id)) n.add(id);
    return n;
  });

  // Selecting something on the page opens the entry it belongs to.
  useEffect(() => {
    if (!selectedId) return;
    const owner = resume.sections.flatMap(entriesOf)
      .find((it) => it.id === selectedId || titleId(it.id) === selectedId || subtitleId(it.id) === selectedId || it.bullets.some((b) => b.id === selectedId));
    if (owner) setOpen((o) => new Set(o).add(owner.id));
    const section = resume.sections.find((s) => s.id === selectedId || (s.kind === "text" ? s.body.id === selectedId : s.items.some((it) => it.id === owner?.id)));
    if (section) setCollapsed((previous) => { const next = new Set(previous); next.delete(section.id); return next; });
  }, [selectedId]);

  // A new selection is brought into view once its entry is open and this tab is showing, then let go, so
  // switching tabs or opening other entries leaves the form where the user left it.
  const reveal = useRef<string | null>(null);
  useEffect(() => { reveal.current = selectedId; }, [selectedId]);
  useEffect(() => {
    const el = reveal.current && !hidden ? root.current?.querySelector(`[data-form="${reveal.current}"]`) : null;
    if (!el) return;
    el.scrollIntoView({ block: "nearest", behavior: scrollMotion() });
    reveal.current = null;
  }, [selectedId, open, collapsed, hidden]);

  const [unfolded, setUnfolded] = useState<Set<string>>(() => new Set());
  const [photoDraft, setPhotoDraft] = useState<{ file: File; request: number; epoch: number } | null>(null);
  const latestResume = useRef(resume);
  latestResume.current = resume;
  const photoRequest = useRef(0);
  useLayoutEffect(() => { setPhotoDraft(null); return () => { photoRequest.current++; }; }, [photoEpoch]);
  const pickPhoto = (input: HTMLInputElement) => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    const request = ++photoRequest.current;
    setPhotoDraft({ file, request, epoch: photoEpoch });
  };

  type SortKind = "section" | "item" | "bullet";
  const drag = useRef<{ kind: SortKind; parent: string; id: string; resume: Resume } | null>(null);
  const [dragToken] = useState(() => uid("drag"));
  const [dropId, setDropId] = useState<string | null>(null);
  const [sortMessage, setSortMessage] = useState("");
  const sortFocus = useRef<{ id: string; label: string | null } | null>(null);
  useLayoutEffect(() => {
    const target = sortFocus.current;
    sortFocus.current = null;
    if (!target) return;
    const row = root.current?.querySelector<HTMLElement>(`[data-form="${target.id}"]`);
    const original = target.label && row?.querySelector<HTMLButtonElement>(`button[aria-label="${CSS.escape(target.label)}"]:not(:disabled)`);
    (original || row?.querySelector<HTMLButtonElement>("[data-sort-step]:not(:disabled), [data-sort-handle]"))?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [resume]);
  const reorder = <T extends { id: string },>(list: T[], from: number, to: number, commit: (list: T[]) => void, label: string) => {
    if (from === to || from < 0 || to < 0 || to >= list.length) return;
    const active = document.activeElement;
    sortFocus.current = { id: list[from].id, label: active instanceof HTMLElement ? active.getAttribute("aria-label") : null };
    commit(move(list, from, to - from));
    setSortMessage(t(`${label}已移到第 ${to + 1} 位，共 ${list.length} 项。`, `${label} moved to position ${to + 1} of ${list.length}.`));
  };
  const accepts = (kind: SortKind, parent: string) => drag.current?.kind === kind && drag.current.parent === parent && drag.current.resume === latestResume.current;
  const dropTarget = (kind: SortKind, parent: string, id: string, apply: (source: string) => void) => ({
    "data-drop-target": dropId === id || undefined,
    onDragOver: (e: ReactDragEvent) => { if (accepts(kind, parent)) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move"; setDropId(id === drag.current?.id ? null : id); } },
    onDrop: (e: ReactDragEvent) => {
      if (!accepts(kind, parent)) return;
      e.preventDefault(); e.stopPropagation();
      if (e.dataTransfer.getData("application/x-redline-sort") === dragToken) apply(drag.current!.id);
      drag.current = null; setDropId(null);
    },
  });
  const grip = (kind: SortKind, parent: string, id: string, label: string) => <IconButton size="icon-sm" className="sort-grip" label={t(`拖动${label}`, `Drag ${label}`)} tip={t(`拖动${label}调序，也可用上下按钮`, `Drag ${label} to reorder, or use the up and down buttons`)} data-sort-handle draggable
    onDragStart={(e) => { e.stopPropagation(); drag.current = { kind, parent, id, resume }; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("application/x-redline-sort", dragToken); }}
    onDragEnd={() => { drag.current = null; setDropId(null); }}><GripVertical size={13} /></IconButton>;

  const setBasics = (k: keyof Basics, v: string) => onChange({ ...resume, basics: { ...resume.basics, [k]: v } }, `basics.${k}`);
  const setSection = (next: Section, key: string) =>
    onChange({ ...resume, sections: resume.sections.map((x) => (x.id === next.id ? next : x)) }, key);
  const setItem = (s: ListSection, it: Item, next: Partial<Item>, key: string) =>
    setSection({ ...s, items: s.items.map((x) => (x.id === it.id ? { ...x, ...next } : x)) }, key);

  // Bullets edit as one run of blocks: Enter splits a line at the caret, Backspace at a line's start joins it to the
  // one above, and the arrows step across the seams. The caret lands after the render that made the change.
  const focusNext = useRef<{ id: string; at: number } | null>(null);
  /** Puts the caret in a bullet; a negative `at` means its end. */
  const place = (id: string, at: number) => {
    const el = root.current?.querySelector<HTMLTextAreaElement>(`[data-form="${id}"] textarea`);
    if (!el) return;
    el.focus();
    const to = at < 0 ? el.value.length : at;
    el.setSelectionRange(to, to);
  };
  useLayoutEffect(() => {
    const want = focusNext.current;
    focusNext.current = null;
    if (want) place(want.id, want.at);
  });
  const blockKeys = (e: ReactKeyboardEvent<HTMLTextAreaElement>, s: ListSection, it: Item, i: number) => {
    if (e.nativeEvent.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
    const el = e.currentTarget;
    const { selectionStart: a, selectionEnd: z, value } = el;
    const bullets = it.bullets;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const id = uid("b");
      const next = [...bullets];
      next.splice(i, 1, { ...bullets[i], text: value.slice(0, a).trimEnd() }, { id, text: value.slice(z).trimStart() });
      focusNext.current = { id, at: 0 };
      setItem(s, it, { bullets: next }, "");
    } else if (e.key === "Backspace" && a === 0 && z === 0 && i > 0) {
      e.preventDefault();
      const prev = bullets[i - 1];
      focusNext.current = { id: prev.id, at: prev.text.length };
      setItem(s, it, { bullets: bullets.flatMap((x, k) => (k === i ? [] : k === i - 1 ? [{ ...x, text: x.text + value }] : [x])) }, "");
    } else if (e.key === "Backspace" && !value && i === 0 && bullets.length > 1) {
      e.preventDefault();
      focusNext.current = { id: bullets[1].id, at: 0 };
      setItem(s, it, { bullets: bullets.slice(1) }, "");
    } else if (e.key === "ArrowUp" && !e.shiftKey && a === 0 && z === 0 && i > 0) {
      e.preventDefault();
      place(bullets[i - 1].id, -1);
    } else if (e.key === "ArrowDown" && !e.shiftKey && a === value.length && z === a && i < bullets.length - 1) {
      e.preventDefault();
      place(bullets[i + 1].id, 0);
    }
  };

  return (
    <div className="form content-upgrades" ref={root} hidden={hidden} id={tabId && `${tabId}-panel`} role={tabId ? "tabpanel" : undefined} aria-labelledby={tabId} onScroll={markScrolled}>
      <div className="content-fold-actions">
        <Button variant="ghost" size="sm" onClick={() => { setOpen(new Set(resume.sections.flatMap(entriesOf).map((it) => it.id))); setCollapsed(new Set()); setUnfolded(new Set(OPTIONAL)); }}>{t("全部展开", "Expand all")}</Button>
        <Button variant="ghost" size="sm" onClick={() => { setOpen(new Set()); setCollapsed(new Set(resume.sections.map((s) => s.id))); setUnfolded(new Set()); }}>{t("全部收起", "Collapse all")}</Button>
      </div>
      <p className="sr-only" role="status">{sortMessage}</p>
      <section className={selectedId === "basics" ? "group on" : "group"} data-form="basics">
        <h3>{t("个人信息", "Personal information")}</h3>
        {[...new Set(BASICS.map((f) => f.group))].map((group, i) => {
          const fields = BASICS.filter((f) => f.group === group);
          const folds = OPTIONAL.includes(group);
          const shown = !folds || unfolded.has(group);
          const filled = fields.map((f) => resume.basics[f.key].trim()).filter(Boolean);
          const groupName = t(group, ENGLISH_GROUPS[group]);
          const labels = fields.slice(0, 3).map((f) => t(f.label, ENGLISH_BASICS[f.key])).join(t("、", ", "));
          const optionalDetails = t(
            `${labels}${fields.length > 3 ? "等" : ""}，选填`,
            `${labels}${fields.length > 3 ? ", and more" : ""} (optional)`,
          );
          return (
            <div key={group} className="basics-group">
              {i > 0 && (folds ? (
                <h4>
                  <button type="button" className="basics-toggle" aria-expanded={shown}
                    onClick={() => setUnfolded((u) => { const n = new Set(u); if (!n.delete(group)) n.add(group); return n; })}>
                    <span>{groupName}</span>
                    {!shown && <span className="basics-sum">{filled.length ? filled.join(" · ") : optionalDetails}</span>}
                    <ChevronRight size={14} className={cn("chev", shown && "open")} />
                  </button>
                </h4>
              ) : <h4>{groupName}</h4>)}
              {shown && (
                <div className="props">
                  {fields.map((f) => {
                    const Icon = ICONS[f.key];
                    return (
                      <label key={f.key} className="field prop" style={english ? { gridTemplateColumns: "112px minmax(0, 1fr)" } : undefined}>
                        <span><Icon size={13} aria-hidden="true" />{t(f.label, ENGLISH_BASICS[f.key])}</span>
                        <Input quiet value={resume.basics[f.key]} placeholder={t("hint" in f ? f.hint : "空", ENGLISH_HINTS[f.key] ?? "Empty")} onChange={(e) => setBasics(f.key, e.target.value)} />
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        <div className="photo-row">
          {resume.photo && <img src={resume.photo} alt={t("证件照", "Profile photo")} />}
          <button type="button" className="add" onClick={() => photoInput.current?.click()}>
            <ImagePlus size={12} />{resume.photo ? t("更换证件照", "Replace photo") : t("添加证件照", "Add photo")}
          </button>
          <input ref={photoInput} type="file" accept="image/*" hidden onChange={(e) => void pickPhoto(e.target)} />
          {resume.photo && <button className="add" onClick={() => { photoRequest.current++; setPhotoDraft(null); onChange({ ...resume, photo: undefined }, ""); }}>{t("移除", "Remove")}</button>}
          {photoDraft && photoDraft.epoch === photoEpoch && <PhotoCropDialog key={photoDraft.request} file={photoDraft.file}
            onClose={() => { photoRequest.current++; setPhotoDraft(null); }}
            onSave={(photo) => { if (photoDraft.request === photoRequest.current) { onChange({ ...latestResume.current, photo }, ""); setPhotoDraft(null); } }} />}
        </div>
      </section>

      <section className={selectedId === resume.summary.id ? "group on" : "group"} data-form={resume.summary.id}>
        <h3>{t("个人简介", "Summary")}</h3>
        <AutoText label={t("个人简介", "Summary")} value={resume.summary.text} onChange={(text) => onChange({ ...resume, summary: { ...resume.summary, text } }, "summary")} />
      </section>

      {resume.sections.map((s, si) => (
        <section key={s.id} className={selectedId === s.id || s.kind === "text" && selectedId === s.body.id ? "group on" : "group"} data-form={s.id}
          {...dropTarget("section", "sections", s.id, (source) => reorder(resume.sections, resume.sections.findIndex((x) => x.id === source), si, (sections) => onChange({ ...resume, sections }, ""), t("模块", "Section")))}>
          <div className="group-head">
            {grip("section", "sections", s.id, t(`模块 ${s.title}`, `Section ${s.title}`))}
            <IconButton size="icon-sm" className="section-fold" label={t(`${collapsed.has(s.id) ? "展开" : "收起"}模块 ${s.title}`, `${collapsed.has(s.id) ? "Expand" : "Collapse"} section ${s.title}`)} aria-expanded={!collapsed.has(s.id)}
              onClick={() => setCollapsed((previous) => { const next = new Set(previous); if (!next.delete(s.id)) next.add(s.id); return next; })}><ChevronRight size={13} className={cn("chev", !collapsed.has(s.id) && "open")} /></IconButton>
            <input className="group-title" value={s.title} aria-label={t("模块名称", "Section title")} onChange={(e) => setSection({ ...s, title: e.target.value }, `sec.${s.id}`)} />
            <IconButton size="icon-sm" label={t("上移模块", "Move section up")} data-sort-step="up" disabled={si === 0} onClick={() => reorder(resume.sections, si, si - 1, (sections) => onChange({ ...resume, sections }, ""), s.title)}><ArrowUp size={13} /></IconButton>
            <IconButton size="icon-sm" label={t("下移模块", "Move section down")} data-sort-step="down" disabled={si === resume.sections.length - 1} onClick={() => reorder(resume.sections, si, si + 1, (sections) => onChange({ ...resume, sections }, ""), s.title)}><ArrowDown size={13} /></IconButton>
            <IconButton size="icon-sm" label={t("删除模块", "Delete section")} onClick={() => onChange({ ...resume, sections: resume.sections.filter((x) => x.id !== s.id) }, "")}><Trash2 size={13} /></IconButton>
          </div>

          {!collapsed.has(s.id) && <>
          {template && getTemplate(template).layout?.startsWith("sidebar") && <label className="section-placement">{t("显示位置", "Position")}
            <select aria-label={t(`${s.title}显示位置`, `Position of ${s.title}`)} value={resume.sectionPlacement?.[s.id] ?? ""} onChange={(e) => {
              const sectionPlacement = { ...resume.sectionPlacement };
              if (e.target.value) sectionPlacement[s.id] = e.target.value as "main" | "side";
              else delete sectionPlacement[s.id];
              onChange({ ...resume, sectionPlacement }, "");
            }}><option value="">{t("跟随模板", "Template default")}</option><option value="main">{t("主栏", "Main column")}</option><option value="side">{t("侧栏", "Sidebar")}</option></select>
          </label>}
          {s.kind === "text" ? (
            <div data-form={s.body.id}>
              <AutoText label={s.title || t("正文", "Body text")} value={s.body.text} onChange={(text) => setSection({ ...s, body: { ...s.body, text } }, `txt.${s.body.id}`)} />
            </div>
          ) : <>
          {s.items.map((it, ii) => {
            const expanded = open.has(it.id) || !it.title;
            const fields = (english ? ENGLISH_ENTRY_FIELDS : ENTRY_FIELDS)[s.kind];
            // A skill has no subtitle, so its lines stand in for one while it's folded.
            const sub = s.kind === "skill" ? it.bullets.map((b) => b.text).join(" ") : it.subtitle;
            return (
              <div key={it.id} className={selectedId === it.id ? "entry on" : "entry"} data-form={it.id}
                {...dropTarget("item", s.id, it.id, (source) => reorder(s.items, s.items.findIndex((x) => x.id === source), ii, (items) => setSection({ ...s, items }, ""), t("条目", "Entry")))}>
                <div className="entry-row">
                  {grip("item", s.id, it.id, t(`条目 ${it.title || fields.name}`, `Entry ${it.title || fields.name}`))}
                  <button className="entry-toggle" aria-expanded={expanded} aria-label={expanded ? it.title || fields.name : undefined} onClick={() => toggle(it.id)}>
                    <ChevronRight size={13} className={expanded ? "chev open" : "chev"} />
                    {!expanded && <><span className="entry-name">{it.title}</span>{sub && <span className="entry-sub">{sub}</span>}</>}
                  </button>
                  {/* An open entry's name is edited where it's shown rather than repeated as a field. Typing keeps it
                      open, since an entry with no name is held open and would fold at the first letter. */}
                  {expanded && (
                    <input className="entry-title" data-form={titleId(it.id)} value={it.title} placeholder={fields.name} aria-label={fields.name}
                      onChange={(e) => { setOpen((o) => new Set(o).add(it.id)); setItem(s, it, { title: e.target.value }, `it.${it.id}.t`); }} />
                  )}
                  <div className="entry-tools">
                    <IconButton size="icon-sm" label={t("上移", "Move up")} data-sort-step="up" disabled={ii === 0} onClick={() => reorder(s.items, ii, ii - 1, (items) => setSection({ ...s, items }, ""), it.title || t("条目", "Entry"))}><ArrowUp size={12} /></IconButton>
                    <IconButton size="icon-sm" label={t("下移", "Move down")} data-sort-step="down" disabled={ii === s.items.length - 1} onClick={() => reorder(s.items, ii, ii + 1, (items) => setSection({ ...s, items }, ""), it.title || t("条目", "Entry"))}><ArrowDown size={12} /></IconButton>
                    <IconButton size="icon-sm" label={t("删除条目", "Delete entry")} onClick={() => setSection({ ...s, items: s.items.filter((x) => x.id !== it.id) }, "")}><Trash2 size={12} /></IconButton>
                  </div>
                </div>
                {expanded && (
                  <div className="entry-body">
                    {fields.sub && (
                      <div className="entry-meta">
                        <Field label={fields.sub} hide><Input quiet value={it.subtitle} placeholder={fields.sub} onChange={(e) => setItem(s, it, { subtitle: e.target.value }, `it.${it.id}.s`)} /></Field>
                        <i aria-hidden="true">·</i>
                        <Field label={t("时间", "Dates")} className="period" hide><Input quiet value={it.period} placeholder={t("时间", "Dates")} onChange={(e) => setItem(s, it, { period: e.target.value }, `it.${it.id}.p`)} /></Field>
                      </div>
                    )}
                    <div className="bullets">
                      {it.bullets.map((b, bi) => (
                        <div key={b.id} className={selectedId === b.id ? "bullet on" : "bullet"} data-form={b.id}
                          {...dropTarget("bullet", it.id, b.id, (source) => reorder(it.bullets, it.bullets.findIndex((x) => x.id === source), bi, (bullets) => setItem(s, it, { bullets }, ""), t("要点", "Bullet")))}>
                          {grip("bullet", it.id, b.id, t(`要点 ${bi + 1}`, `Bullet ${bi + 1}`))}
                          <AutoText label={t(`${it.title || fields.name}，第 ${bi + 1} 条`, `${it.title || fields.name}, bullet ${bi + 1}`)} className={cn(selectedId === b.id && "bg-pen-soft")} value={b.text} placeholder={t("回车另起一条", "Press Enter for a new bullet")} onChange={(text) =>
                            setItem(s, it, { bullets: it.bullets.map((x) => (x.id === b.id ? { ...x, text } : x)) }, `b.${b.id}`)}
                            onKeyDown={(e) => blockKeys(e, s, it, bi)} />
                          <div className="bullet-tools">
                            <IconButton size="icon-sm" label={t("上移要点", "Move bullet up")} data-sort-step="up" disabled={bi === 0} onClick={() => reorder(it.bullets, bi, bi - 1, (bullets) => setItem(s, it, { bullets }, ""), t("要点", "Bullet"))}><ArrowUp size={12} /></IconButton>
                            <IconButton size="icon-sm" label={t("下移要点", "Move bullet down")} data-sort-step="down" disabled={bi === it.bullets.length - 1} onClick={() => reorder(it.bullets, bi, bi + 1, (bullets) => setItem(s, it, { bullets }, ""), t("要点", "Bullet"))}><ArrowDown size={12} /></IconButton>
                            <IconButton size="icon-sm" label={t("删除这一条", "Delete bullet")} onClick={() => setItem(s, it, { bullets: it.bullets.filter((x) => x.id !== b.id) }, "")}><Trash2 size={12} /></IconButton>
                          </div>
                        </div>
                      ))}
                    </div>
                    <button className="add" onClick={() => { const id = uid("b"); focusNext.current = { id, at: 0 }; setItem(s, it, { bullets: [...it.bullets, { id, text: "" }] }, ""); }}><Plus size={12} />{t("添加一条", "Add bullet")}</button>
                  </div>
                )}
              </div>
            );
          })}
          <button className="add" onClick={() => setSection({ ...s, items: [...s.items, { id: uid("it"), title: "", subtitle: "", period: "", bullets: [] }] }, "")}><Plus size={12} />{t("添加条目", "Add entry")}</button>
          </>}
          </>}
        </section>
      ))}

      <div className="add-section">
        {(Object.keys(KIND_TITLES) as SectionKind[]).map((kind) => (
          <button key={kind} className="add" onClick={() => onChange({ ...resume, sections: [...resume.sections, newSection(kind)] }, "")}>
            <Plus size={12} />{t(KIND_TITLES[kind], ENGLISH_KIND_TITLES[kind])}
          </button>
        ))}
      </div>
    </div>
  );
}

const when = (at: number, locale: string) =>
  new Date(at).toLocaleString(locale, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

function VersionsForm({ hidden, tabId, doc, versions, temporary, onSaveVersion, onRestoreVersion, onDeleteVersion, onRenameVersion, onNewBlank, onLoadSample, onBackup, onRestoreBackup, onExportText }: { hidden: boolean; tabId: string } & Omit<Props, "open" | "onOpenChange" | "width" | "onWidth" | "selectedId" | "onResume" | "onDesign" | "photoEpoch" | "theme" | "onThemeChange">) {
  const { t } = useLanguage();
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [compareId, setCompareId] = useState<string | null>(null);
  const compare = versions.find((version) => version.id === compareId);
  const root = useRef<HTMLDivElement>(null);
  const renameFocus = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (renaming || !renameFocus.current) return;
    root.current?.querySelector<HTMLButtonElement>(`[data-version="${renameFocus.current}"] [data-version-rename]`)?.focus();
    renameFocus.current = null;
  }, [renaming]);
  const backupInput = useRef<HTMLInputElement>(null);
  const save = () => { onSaveVersion(name.trim() || t("未命名版本", "Untitled version")); setName(""); };
  const endRename = () => { renameFocus.current = renaming?.id ?? null; setRenaming(null); };
  const rename = () => { if (renaming?.name.trim()) { onRenameVersion(renaming.id, renaming.name.trim()); endRename(); } };
  return (
    <div ref={root} className="form" hidden={hidden} id={`${tabId}-panel`} role="tabpanel" aria-labelledby={tabId} onScroll={markScrolled}>
      <section className="group">
        <h3>{t("保存当前版本", "Save current version")}</h3>
        <div className="save-row">
          <Input value={name} aria-label={t("版本名称", "Version name")} placeholder={t("比如：投字节 · 产品岗", "e.g. Product manager application")} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && save()} />
          <Button variant="outline" onClick={save}><Save size={13} />{t("保存", "Save")}</Button>
        </div>
      </section>
      <section className="group">
        <h3>{temporary ? t("本页暂存", "Temporary versions") : t("已保存", "Saved versions")} {versions.length > 0 && <small>{versions.length}</small>}</h3>
        {versions.length === 0 && <p className="hint">{t("同一份简历投不同岗位时，可以各存一版。", "Save a version for each job application.")}</p>}
        {versions.map((v) => (
          <div className="version version-upgraded" key={v.id} data-version={v.id}>
            <div><b>{v.name}</b><span>{when(v.at, t("zh-CN", "en"))}</span></div>
            <div className="version-actions">
              <IconButton size="icon-sm" data-version-rename label={t(`重命名 ${v.name}`, `Rename ${v.name}`)} onClick={() => setRenaming({ id: v.id, name: v.name })}><Pencil size={13} /></IconButton>
              <IconButton size="icon-sm" label={t(`对比 ${v.name}`, `Compare ${v.name}`)} onClick={() => setCompareId(v.id)}><FileDiff size={13} /></IconButton>
              <IconButton size="icon-sm" label={t(`恢复 ${v.name}`, `Restore ${v.name}`)} onClick={() => onRestoreVersion(v)}><RotateCcw size={13} /></IconButton>
              <IconButton size="icon-sm" label={t(`删除 ${v.name}`, `Delete ${v.name}`)} onClick={() => onDeleteVersion(v.id)}><Trash2 size={13} /></IconButton>
            </div>
            {renaming?.id === v.id && <div className="version-rename">
              <Input autoFocus aria-label={t("新的版本名称", "New version name")} maxLength={100} value={renaming.name} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
                onKeyDown={(e) => { if (e.nativeEvent.isComposing) return; if (e.key === "Enter") rename(); if (e.key === "Escape") endRename(); }} />
              <IconButton label={t("确认重命名", "Confirm rename")} size="icon-sm" disabled={!renaming.name.trim()} onClick={rename}><Check size={13} /></IconButton>
              <IconButton label={t("取消重命名", "Cancel rename")} size="icon-sm" onClick={endRename}><X size={13} /></IconButton>
            </div>}
          </div>
        ))}
      </section>
      <section className="group">
        <h3>{t("文件", "Files")}</h3>
        <div className="file-actions [&>button]:h-auto [&>button]:min-h-7 [&>button]:min-w-0 [&>button]:whitespace-normal [&>button]:py-1">
          <Button variant="outline" size="sm" onClick={onNewBlank}><FilePlus2 size={13} />{t("新建空白简历", "New blank resume")}</Button>
          <Button variant="outline" size="sm" onClick={onLoadSample}><FileUser size={13} />{t("载入示例", "Load sample")}</Button>
          <Button variant="outline" size="sm" onClick={onBackup}><Download size={13} />{t("下载备份", "Download backup")}</Button>
          <Button variant="outline" size="sm" onClick={() => backupInput.current?.click()}><Upload size={13} />{t("从备份恢复", "Restore backup")}</Button>
          <Button variant="outline" size="sm" onClick={() => onExportText("markdown")}><Download size={13} />{t("导出 Markdown", "Export Markdown")}</Button>
          <Button variant="outline" size="sm" onClick={() => onExportText("text")}><Download size={13} />{t("导出纯文本", "Export plain text")}</Button>
              <input ref={backupInput} type="file" accept=".json" hidden onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) onRestoreBackup(file);
              }} />
        </div>
        <p className="hint">{t("内容只存在这个浏览器里。换设备或清理浏览器数据前，请先下载备份。备份不包含 API Key。", "This browser stores your work. Download a backup before switching devices or clearing browser data. Backups exclude the API key.")}</p>
      </section>
      {compare && <VersionCompareDialog version={compare} current={doc} onClose={() => setCompareId(null)} />}
    </div>
  );
}

const SEGMENT = "relative z-[1] h-[26px] min-w-0 px-0 text-[13px] font-normal text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-transparent data-[state=on]:font-medium data-[state=on]:text-foreground";

function Segments<T extends string>({ value, options, onPick, label }: { value: T; options: { id: T; name: string }[]; onPick: (v: T) => void; label?: string }) {
  const { t } = useLanguage();
  const name = (option: (typeof options)[number]) => t(option.name, ENGLISH_DESIGN_OPTIONS[option.name] ?? option.name);
  return (
    <ToggleGroup type="single" aria-label={label} className="segmented grid items-stretch gap-0" style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}
      value={value} onValueChange={(v) => v && onPick(v as T)}>
      <SegmentThumb index={options.findIndex((o) => o.id === value)} labels={options.map(name)} />
      {options.map((o) => <ToggleGroupItem key={o.id} value={o.id} className={SEGMENT}>{name(o)}</ToggleGroupItem>)}
    </ToggleGroup>
  );
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function DesignForm({ hidden, tabId, doc, onChange, theme, onThemeChange }: { hidden: boolean; tabId: string; doc: Doc; onChange: (d: Design, key: string) => void } & Pick<Props, "theme" | "onThemeChange">) {
  const { english, t } = useLanguage();
  const d = doc.design;
  const custom = !ACCENTS.some((c) => same(c.hex, d.accent));
  const [hex, setHex] = useState(d.accent);
  const [category, setCategory] = useState("全部");
  const [query, setQuery] = useState("");
  const designLabel = (label: string) => t(label, ENGLISH_DESIGN_OPTIONS[label] ?? label);
  const templates = TEMPLATES.filter((template) => {
    if (category !== "全部" && template.category !== category) return false;
    const translated = ENGLISH_TEMPLATES[template.id];
    const terms = [template.name, template.note, template.category, template.id];
    if (english) terms.push(translated.name, translated.note, ENGLISH_DESIGN_OPTIONS[template.category]);
    return terms.join(" ").toLowerCase().includes(query.trim().toLowerCase());
  });
  const currentTemplate = getTemplate(d.template);
  const currentName = t(currentTemplate.name, ENGLISH_TEMPLATES[currentTemplate.id].name);
  useEffect(() => setHex(d.accent), [d.accent]);
  return (
    <div className="form" hidden={hidden} id={`${tabId}-panel`} role="tabpanel" aria-labelledby={tabId} onScroll={markScrolled}>
      <section className="group">
        <h3>{t("界面外观", "Appearance")}</h3>
        <Segments label={t("界面外观", "Appearance")} value={theme} options={[{ id: "system", name: t("跟随系统", "System") }, { id: "light", name: t("浅色", "Light") }, { id: "dark", name: t("深色", "Dark") }]} onPick={onThemeChange} />
      </section>
      <section className="group">
        <h3>{t("模板", "Templates")} <small>{t(`${TEMPLATES.length} 款`, String(TEMPLATES.length))}</small></h3>
        <Input className="template-search" aria-label={t("搜索模板", "Search templates")} placeholder={t("搜索模板或用途", "Search by name or use")} value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="template-filters" role="group" aria-label={t("模板分类", "Template categories")}>
          {["全部", ...new Set(TEMPLATES.map((t) => t.category))].map((name) => <button type="button" key={name} aria-pressed={category === name} onClick={() => setCategory(name)}>{designLabel(name)}</button>)}
        </div>
        <p className="template-current">{t(`当前：${currentName} · ${templates.length} 款可选`, `Current: ${currentName} · ${templates.length} available`)}</p>
        <div className="templates">
          {templates.map((t) => (
            <button type="button" key={t.id} data-template={t.id} aria-pressed={d.template === t.id} className={d.template === t.id ? "tpl on" : "tpl"} onClick={() => onChange({ ...d, template: t.id }, "")}>
              <div className="thumb" style={{ "--accent": d.accent } as CSSProperties}><Skeleton template={t.id} /></div>
              <b>{english ? ENGLISH_TEMPLATES[t.id].name : t.name}</b><span>{english ? ENGLISH_TEMPLATES[t.id].note : t.note}</span>
            </button>
          ))}
        </div>
        {!templates.length && <p className="hint" role="status">{t("没有匹配的模板，请换个关键词或分类。", "No matching templates. Try another search or category.")}</p>}
        <p className="hint">{t("切换模板会保留正文和批注。侧重点模板只调整显示顺序。网申可优先选简素；请以招聘系统的预览为准。", "Switch templates to change the layout and keep your text and comments. Focused templates reorder sections on the page. For online applications, try Plain Text and check the preview in the recruitment system.")}</p>
      </section>
      <section className="group">
        <h3>{t("页数限制", "Page limit")}</h3>
        <Segments label={t("页数限制", "Page limit")} value={String(d.pageLimit)} options={[{ id: "1", name: t("1 页", "1 page") }, { id: "2", name: t("2 页", "2 pages") }, { id: "0", name: t("不限", "No limit") }]} onPick={(value) => onChange({ ...d, pageLimit: Number(value) as Design["pageLimit"] }, "")} />
        <p className="hint">{t("超出限制时会提示，不会删除正文。打印页数以导出预览为准。", "Redline warns you if the resume exceeds the limit and keeps all your text. Check the export preview for the final page count.")}</p>
      </section>
      <section className="group">
        <h3>{t("简历标签语言", "Resume label language")}</h3>
        <Segments label={t("简历标签语言", "Resume label language")} value={d.language} options={[{ id: "zh", name: "中文" }, { id: "en", name: "English" }]} onPick={(language) => onChange({ ...d, language }, "")} />
        <p className="hint">{t("只切换简历内置标签。姓名、模块标题和正文请自行翻译。", "This setting changes built-in resume labels. Translate names, section titles, and body text yourself.")}</p>
      </section>
      <section className="group">
        <h3>{t("照片形状", "Photo shape")}</h3>
        <Segments label={t("照片形状", "Photo shape")} value={d.photoShape} options={[{ id: "square", name: t("方角", "Square") }, { id: "rounded", name: t("圆角", "Rounded") }, { id: "circle", name: t("圆形", "Circle") }]} onPick={(photoShape) => onChange({ ...d, photoShape }, "")} />
      </section>
      <section className="group">
        <h3>{t("强调色", "Accent color")}</h3>
        <div className="swatches">
          {ACCENTS.map((c) => (
            <button key={c.hex} className={same(d.accent, c.hex) ? "on" : ""} style={{ background: c.hex }} title={designLabel(c.name)} aria-label={t(`强调色 ${c.name}`, `Accent color: ${designLabel(c.name)}`)} onClick={() => onChange({ ...d, accent: c.hex }, "")} />
          ))}
        </div>
        <div className="custom-color">
          <label className={custom ? "picker on" : "picker"} style={{ background: d.accent }}>
            <input type="color" aria-label={t("自选颜色", "Custom color")} value={d.accent.toLowerCase()} onChange={(e) => onChange({ ...d, accent: e.target.value.toUpperCase() }, "accent")} />
          </label>
          <span>{t("自选颜色", "Custom color")}</span>
          <Input
            className="hex ml-auto w-24"
            aria-label={t("颜色色值", "Hex color")}
            spellCheck={false}
            maxLength={7}
            value={hex}
            onChange={(e) => {
              const value = e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`;
              setHex(value);
              if (/^#[0-9a-fA-F]{6}$/.test(value)) onChange({ ...d, accent: value.toUpperCase() }, "accent");
            }}
            onBlur={() => setHex(d.accent)}
          />
        </div>
        {contrastOnWhite(d.accent) < 4.5 && <p className="hint warn-text">{t("这个颜色偏浅，普通字号文字在白纸上可能看不清。", "This color may be difficult to read at regular text sizes on a white page.")}</p>}
      </section>
      <section className="group">
        <h3>{t("中文字体", "Chinese font")}</h3>
        <div className="font-grid">
          {FONTS.map((f) => {
            const installed = fontInstalled(f.families);
            return (
              <button
                key={f.id}
                className={d.font === f.id ? "font on" : "font"}
                disabled={!installed}
                title={installed ? designLabel(f.note) : t("本机没有这个字体", "Font unavailable on this device")}
                onClick={() => onChange({ ...d, font: f.id }, "")}
              >
                <b aria-hidden="true" style={{ fontFamily: fontStack({ ...d, font: f.id, latin: "auto" }) }}>永 Aa</b>
                <span>{designLabel(f.name)}{!installed && t(" · 本机没有", " · Unavailable")}</span>
              </button>
            );
          })}
        </div>
      </section>
      <section className="group">
        <h3>{t("西文和数字字体", "Latin and numeral font")}</h3>
        <Segments value={d.latin} options={LATIN_FONTS} onPick={(latin) => onChange({ ...d, latin }, "")} />
      </section>
      <section className="group">
        <h3>{t("标题样式", "Heading style")}</h3>
        <Segments value={d.heading} options={HEADINGS} onPick={(heading) => onChange({ ...d, heading }, "")} />
      </section>
      <section className="group">
        <h3>{t("间距", "Spacing")}</h3>
        <Segments value={d.density} options={DENSITIES} onPick={(density) => onChange({ ...d, density }, "")} />
      </section>
      <section className="group">
        <h3>{t("页边距", "Margins")}</h3>
        <Segments value={d.margin} options={MARGINS} onPick={(margin) => onChange({ ...d, margin }, "")} />
      </section>
      <section className="group">
        <h3>{t("字号", "Font size")} <small>{Math.round(d.fontScale * 100)}%</small></h3>
        <Slider value={d.fontScale} onChange={(fontScale) => onChange({ ...d, fontScale }, "font")} />
      </section>
    </div>
  );
}

const SIZES = [FONT_SCALE.min, 1, FONT_SCALE.max];
const share = (v: number) => (v - FONT_SCALE.min) / (FONT_SCALE.max - FONT_SCALE.min);

/** The font size: a native range for keys and screen readers, drawn fine, with the common sizes marked under it.
 * A drag catches on 100% as it passes; the arrow keys still step one percent at a time. */
function Slider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const { t } = useLanguage();
  const dragging = useRef(false);
  return (
    <div className="slider">
      <input type="range" min={FONT_SCALE.min} max={FONT_SCALE.max} step={0.01} value={value} aria-label={t("字号", "Font size")} style={{ "--pct": `calc(7px + (100% - 14px) * ${share(value)})` } as CSSProperties}
        onPointerDown={() => { dragging.current = true; }} onPointerUp={() => { dragging.current = false; }}
        onChange={(e) => {
          const v = Number(e.target.value);
          onChange(dragging.current && Math.abs(v - 1) < 0.015 ? 1 : v);
        }} />
      <div className="ticks">
        {SIZES.map((s) => (
          <button key={s} type="button" tabIndex={-1} className={Math.abs(value - s) < 0.005 ? "on" : undefined} style={{ left: `${share(s) * 100}%` }}
            onClick={() => onChange(s)}>{Math.round(s * 100)}%</button>
        ))}
      </div>
    </div>
  );
}

type Bar = { x: number; y: number; w: number; h: number; c: string };

/** A template's layout as bars, in the resume's accent: where the name sits, how headings are drawn, whether there is a side column. */
function Skeleton({ template }: { template: TemplateId }) {
  const bars: Bar[] = [];
  const rules: { x1: number; x2: number; y: number }[] = [];
  const bar = (x: number, y: number, w: number, c = "t", h = 1.6) => bars.push({ x, y, w, h, c });
  const info = getTemplate(template);
  const book = info.font === "serif";
  const sidebar = info.layout?.startsWith("sidebar");
  const center = ["shujuan", "classic", "formal", "monogram"].includes(template);
  const section = (x: number, w: number, y: number, entries: number[]) => {
    if (book) {
      bar(x, y, 13, "t dark", 2.4);
      rules.push({ x1: x + 16, x2: x + w, y: y + 1.2 });
    } else if (template === "ats") {
      bar(x, y, 14, "t dark", 2.4);
    } else {
      bar(x, y, 14, "a", 2.4);
      rules.push({ x1: x, x2: x + w, y: y + 4.2 });
    }
    y += 8.5;
    for (const n of entries) {
      bar(x, y, w * 0.3, "t dark", 1.8);
      bar(x + w * 0.84, y, w * 0.16);
      y += 4.4;
      for (let i = 0; i < n; i++) {
        bar(x + 2, y, w * [0.94, 0.8, 0.88][i % 3] - 2);
        y += 3.5;
      }
      y += 2.4;
    }
    return y + 3;
  };
  if (sidebar) {
    bar(6, 12, 19, "t dark", 4);
    bar(6, 19, 12, "a", 2);
    // The side column: contact lines, then two short sections.
    for (const [y, w] of [[25, 19], [28.5, 15], [32, 17], [35.5, 12], [50, 17], [53.5, 14], [57, 16], [63, 17], [66.5, 13], [81, 16], [84.5, 18], [88, 12]]) bar(6, y, w);
    bar(6, 44, 11, "a", 2.2);
    bar(6, 75, 11, "a", 2.2);
    let y = section(37, 58, 12, [3, 2]);
    y = section(37, 58, y, [2]);
    section(37, 58, y, [2]);
  } else {
    const mid = (w: number) => (center ? 52.5 - w / 2 : 10);
    bar(mid(30), 11, 30, "t dark", 4.5);
    bar(mid(15), 18.5, 15, "a", 2);
    bar(mid(52), 23, 52);
    bar(10, 29.5, 85);
    bar(10, 33, 64);
    if (info.layout === "columns") {
      for (const x of [10, 56]) { const y = section(x, 39, 41, [3]); section(x, 39, y, [2]); }
    } else if (info.layout === "labels") {
      for (const y of [42, 76, 110]) {
        bar(10, y, 15, "a", 2.4);
        for (let i = 0; i < 6; i++) bar(31, y + i * 4, i ? 58 : 26, i ? "t" : "t dark");
      }
    } else {
      let y = section(10, 85, 41, [3, 2]);
      y = section(10, 85, y, [2]);
      section(10, 85, y, [1]);
    }
  }
  return (
    <svg viewBox="0 0 105 148.5" aria-hidden="true" className={`mini-${template}`}>
      <g transform={info.layout === "sidebar-right" ? "translate(105 0) scale(-1 1)" : undefined}>
      {sidebar && template !== "sidebar-clean" && <rect className="side" x="0" y="0" width="31" height="148.5" />}
      {template === "sidebar-clean" && <line className="rule" x1="31" x2="31" y1="0" y2="148.5" />}
      {template === "banner" && <rect className="a" x="5" y="5" width="95" height="23" rx="1" />}
      {template === "rail" && <rect className="a" x="0" y="0" width="2" height="148.5" />}
      {template === "executive" && <rect className="a" x="10" y="5" width="85" height="2" />}
      {template === "editorial" && <rect className="t dark" x="10" y="26" width="85" height="1.5" />}
      {template === "monogram" && <rect className="outline" x="33" y="8" width="39" height="10" />}
      {template === "timeline" && <line className="rule" x1="8" x2="8" y1="49" y2="135" />}
      {template === "classic" && [7, 27].map((y) => <line key={y} className="rule" x1="10" x2="95" y1={y} y2={y} />)}
      {template === "card" && [38, 86, 117].map((y, i) => <rect key={y} className="side" x="7" y={y} width="91" height={i ? 28 : 46} rx="2" />)}
      {info.priority && <rect className="side" x="7" y="38" width="91" height="46" />}
      {rules.map((r, i) => <line key={i} className="rule" x1={r.x1} x2={r.x2} y1={r.y} y2={r.y} />)}
      {bars.map((b, i) => <rect key={i} className={b.c} x={b.x} y={b.y} width={b.w} height={b.h} rx={b.h / 2} />)}
      </g>
    </svg>
  );
}
