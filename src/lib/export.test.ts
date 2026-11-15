import { expect, it } from "vitest";
import { exportResume } from "./export";
import { sampleDoc } from "./sample";
import { nextCompactDesign } from "./design";

it("exports a clean resume with Unicode text and all sections, without storage metadata", () => {
  const doc = sampleDoc();
  doc.resume.summary.text = "**核心能力** / Core skills 😀";
  doc.design = { ...doc.design, language: "en" };
  doc.resume.sections.push({ id: "closing", kind: "text", title: "备注", body: { id: "closing-text", text: "第一段\n第二段" } });
  const md = exportResume(doc, "markdown");
  const plain = exportResume(doc, "text");
  expect(md).toContain("# 林知远");
  expect(md).toContain("**核心能力** / Core skills 😀");
  expect(plain).toContain("核心能力 / Core skills 😀");
  expect(plain).not.toContain("**");
  expect(plain).toContain("Email：zhiyuan@example.com");
  expect(plain).toContain("第一段\n第二段");
  for (const section of doc.resume.sections) expect(md).toContain(`## ${section.title}`);
  expect(md).not.toContain(doc.resume.summary.id);
});

it("compresses spacing in a fixed order before shrinking type, and stops at the limit", () => {
  let d = { ...sampleDoc().design, margin: "wide" as const, density: "relaxed" as const, fontScale: 1.01 };
  const states = [];
  for (let i = 0; i < 6; i++) {
    const next = nextCompactDesign(d)!;
    states.push([next.margin, next.density, next.fontScale]);
    d = next as typeof d;
  }
  expect(states).toEqual([["normal", "relaxed", 1.01], ["normal", "normal", 1.01], ["normal", "compact", 1.01], ["narrow", "compact", 1.01], ["narrow", "compact", 1], ["narrow", "compact", .99]]);
  expect(nextCompactDesign({ ...d, fontScale: .9 })).toBeNull();
});
