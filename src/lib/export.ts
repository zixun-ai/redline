import type { Doc } from "./types";
import { BASICS, ENGLISH_BASICS } from "./basics";
import { templateSections } from "./design";
import { plainInline } from "./inline";

/** Export only the current document, never credentials, comments or job descriptions. */
export function exportResume(doc: Doc, format: "markdown" | "text"): string {
  const { resume, design } = doc;
  const md = format === "markdown";
  const text = (value: string) => md ? value : plainInline(value);
  const lines = [`${md ? "# " : ""}${text(resume.basics.name)}`, text(resume.basics.title), ""];
  for (const field of BASICS) {
    if (field.key === "name" || field.key === "title" || !resume.basics[field.key].trim()) continue;
    lines.push(`${design.language === "en" ? ENGLISH_BASICS[field.key] : field.label}：${text(resume.basics[field.key])}`);
  }
  if (resume.summary.text.trim()) lines.push("", text(resume.summary.text));
  for (const section of templateSections(resume.sections, design.template)) {
    lines.push("", `${md ? "## " : ""}${text(section.title)}`);
    if (section.kind === "text") { lines.push(text(section.body.text)); continue; }
    for (const item of section.items) {
      lines.push("", `${md ? "### " : ""}${text([item.title, item.subtitle, item.period].filter(Boolean).join(" · "))}`);
      for (const bullet of item.bullets) if (bullet.text.trim()) lines.push(`${md ? "- " : "• "}${text(bullet.text)}`);
    }
  }
  return lines.join("\n").trim() + "\n";
}
