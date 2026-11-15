import { useLanguage } from "@/lib/language";
import { ENGLISH_DESIGN_OPTIONS, ENGLISH_TEMPLATES } from "@/lib/designLocale";
import { useId, useMemo, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { diffChars } from "../lib/diff";
import { resumeText } from "../lib/nodes";
import { getTemplate } from "../lib/design";
import type { Design, Doc, Version } from "../lib/types";

const labels: Record<keyof Design, readonly [string, string]> = {
  template: ["模板", "Template"], accent: ["强调色", "Accent color"], density: ["内容疏密", "Content spacing"],
  fontScale: ["字号", "Font size"], font: ["中文字体", "Chinese font"], latin: ["西文字体", "Latin font"],
  heading: ["标题样式", "Heading style"], margin: ["页边距", "Margins"], pageLimit: ["页数限制", "Page limit"],
  language: ["简历标签语言", "Résumé label language"], photoShape: ["照片形状", "Portrait shape"],
};
const setting = (key: keyof Design, value: Design[keyof Design], english: boolean) => {
  if (key === "template") {
    const template = getTemplate(value as Design["template"]);
    return english ? ENGLISH_TEMPLATES[template.id].name : template.name;
  }
  if (key === "pageLimit") {
    if (english) return value === 0 ? "Unlimited" : `${value} ${value === 1 ? "page" : "pages"}`;
    return value === 0 ? "不限" : `${value} 页`;
  }
  if (key === "fontScale") return `${Math.round(Number(value) * 100)}%`;
  const label = ({ normal: "标准", compact: "紧凑", relaxed: "宽松", auto: "自动", hei: "黑体", song: "宋体", kai: "楷体", fang: "仿宋", yuan: "圆体", sans: "无衬线", serif: "衬线", mono: "等宽", line: "下划线", block: "色块", bar: "竖条", plain: "纯文字", narrow: "窄", wide: "宽", zh: "中文", en: "English", square: "方角", rounded: "圆角", circle: "圆形" } as Record<string, string>)[value] ?? String(value);
  return english ? ENGLISH_DESIGN_OPTIONS[label] ?? label : label;
};

export function VersionCompareDialog({ version, current, onClose }: { version: Version; current: Doc; onClose: () => void }) {
  const { english, t } = useLanguage();
  const descriptionId = useId();
  const invoker = useRef(document.activeElement as HTMLElement | null);
  const changes = useMemo(() => diffChars(resumeText(version.doc.resume), resumeText(current.resume)), [version.doc.resume, current.resume]);
  const design = (Object.keys(labels) as (keyof Design)[]).filter((key) => version.doc.design[key] !== current.design[key]);
  const photoChanged = version.doc.resume.photo !== current.resume.photo;
  const placementChanged = JSON.stringify(version.doc.resume.sectionPlacement ?? {}) !== JSON.stringify(current.resume.sectionPlacement ?? {});
  const styleChanged = JSON.stringify(version.doc.resume.nodeStyles ?? {}) !== JSON.stringify(current.resume.nodeStyles ?? {});
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="dialog chrome version-compare-dialog" aria-describedby={descriptionId}
      onCloseAutoFocus={(e) => { e.preventDefault(); if (invoker.current?.isConnected) invoker.current.focus(); }}>
      <DialogHeader><DialogTitle>{t("与当前简历对比", "Compare with current résumé")}</DialogTitle></DialogHeader>
      <p id={descriptionId} className="hint">{t(`从“${version.name}”到当前简历。`, `Comparing “${version.name}” with the current résumé. `)}<del>{t("删除", "Removed text")}</del>{t("为旧版内容，", " is from the saved version. ")}<ins>{t("新增", "Added text")}</ins>{t("为当前内容。", " is from the current version.")}</p>
      {!changes.some((part) => part.t !== "same") && <p className="hint">{t("正文没有变化。", "No text changes.")}</p>}
      <div className="version-diff" aria-label={t("简历正文差异", "Résumé text differences")} role="region">{changes.map((part, index) => part.t === "del"
        ? <del key={index}><span className="sr-only">{t("删除：", "Removed: ")}</span>{part.s}</del>
        : part.t === "add" ? <ins key={index}><span className="sr-only">{t("新增：", "Added: ")}</span>{part.s}</ins> : <span key={index}>{part.s}</span>)}</div>
      {(design.length > 0 || photoChanged || placementChanged || styleChanged) && <section className="version-design-diff">
        <h3>{t("版式与照片变化", "Layout and photo changes")}</h3>
        <ul>{design.map((key) => <li key={key}>{t(...labels[key])}{t("：", ": ")}{setting(key, version.doc.design[key], english)} → {setting(key, current.design[key], english)}</li>)}
          {photoChanged && <li>{t("证件照已变更", "Portrait changed")}</li>}{placementChanged && <li>{t("模块主栏 / 侧栏位置已变更", "Section placement changed")}</li>}{styleChanged && <li>{t("局部文字样式已变更", "Text styling changed")}</li>}
        </ul>
      </section>}
      <div className="dialog-actions"><Button variant="outline" onClick={onClose}>{t("关闭对比", "Close comparison")}</Button></div>
    </DialogContent>
  </Dialog>;
}
