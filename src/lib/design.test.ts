import { expect, it } from "vitest";
import { ACCENTS, TEMPLATES, contrastOnWhite, fontStack, onAccent, templateSections } from "./design";
import { sampleDoc } from "./sample";
import { isDoc } from "./storage";

it("keeps filled headings readable at ordinary text sizes", () => {
  const colors = [...ACCENTS.map((c) => c.hex), "#777777", "#888888", "#FFFFFF", "#000000"];
  for (const color of colors) {
    const contrast = contrastOnWhite(color);
    expect(onAccent(color) === "#fff" ? contrast : 21 / contrast).toBeGreaterThanOrEqual(4.5);
  }
  expect(onAccent("#888888")).toBe("#000");
});

it("keeps all template choices compatible with saved documents", () => {
  const doc = sampleDoc();
  expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
  for (const template of TEMPLATES) expect(isDoc({ ...doc, design: { ...doc.design, template: template.id } })).toBe(true);
  expect(isDoc({ ...doc, design: { ...doc.design, template: "unknown" } })).toBe(false);
});

it("prioritizes the chosen section without changing the document or dropping any module", () => {
  const sections = sampleDoc().resume.sections;
  const original = structuredClone(sections);
  for (const [id, kind] of [["campus", "education"], ["skills", "skill"], ["portfolio", "project"]] as const) {
    expect(templateSections(sections, id)[0].kind).toBe(kind);
  }
  for (const template of TEMPLATES) {
    const ordered = templateSections(sections, template.id);
    expect(ordered.map((s) => s.id).sort()).toEqual(sections.map((s) => s.id).sort());
    if (template.priority) {
      const first = sections.filter((s) => s.kind === template.priority);
      expect(ordered.slice(0, first.length)).toEqual(first);
      expect(ordered.slice(first.length)).toEqual(sections.filter((s) => s.kind !== template.priority));
    }
    expect(sections).toEqual(original);
  }
});

it("uses a template font only when the user has not chosen one", () => {
  const d = sampleDoc().design;
  expect(fontStack({ ...d, template: "classic" })).toBe("var(--serif)");
  expect(fontStack({ ...d, template: "formal" })).toBe("var(--serif)");
  expect(fontStack({ ...d, template: "classic", font: "hei" })).toContain("PingFang SC");
  expect(fontStack({ ...d, template: "classic", latin: "mono" })).toContain('"Menlo", "Consolas", var(--serif)');
});
