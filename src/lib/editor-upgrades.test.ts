import { describe, expect, it } from "vitest";
import { applyManualPayload, applyPayload, editPayloadField, findNode, getPayload, pathTo, quoteOnlyEdit, targetContext, targetFacts, titleId, validatePayload } from "./nodes";
import { sampleDoc } from "./sample";
import type { ItemPayload, ListSection, SectionPayload } from "./types";

describe("independent title fields", () => {
  it("addresses a title without changing its item, subtitle or bullets", () => {
    const { resume } = sampleDoc();
    const item = (resume.sections[0] as ListSection).items[0];
    const id = titleId(item.id);
    expect(findNode(resume, id)?.type).toBe("field");
    expect(getPayload(resume, id)).toEqual({ text: item.title });
    expect(pathTo(resume, id).map((part) => part.id)).toEqual([resume.sections[0].id, item.id, id]);
    expect(targetFacts(resume, id)).toBe(item.title);
    expect(targetContext(resume, id)).toContain(item.bullets[0].text);
    const next = applyPayload(resume, id, { text: "更新后的**标题**" });
    expect((next.sections[0] as ListSection).items[0]).toEqual({ ...item, title: "更新后的**标题**" });
    expect(validatePayload("field", getPayload(next, id))).toEqual({ text: "更新后的**标题**" });
  });

  it("limits a title quote to the chosen occurrence, including source Markdown offsets", () => {
    const before = { text: "参与**项目**，项目协作" };
    const start = before.text.lastIndexOf("项目");
    expect(quoteOnlyEdit(before, { text: "参与**项目**，跨组协作" }, "项目", { start, end: start + 2 })).toBe(true);
    expect(quoteOnlyEdit(before, { text: "主导**项目**，跨组协作" }, "项目", { start, end: start + 2 })).toBe(false);
  });
});

describe("manual fixed-field editing", () => {
  it("preserves all item and bullet identities when changing a section's fields", () => {
    const { resume } = sampleDoc();
    const section = resume.sections[0] as ListSection;
    const original = structuredClone(section);
    let value = getPayload(resume, section.id)!;
    value = editPayloadField("section", value, "items.0.title", "新名称 | 含竖线");
    value = editPayloadField("section", value, "items.0.bullets.0", "两行内容\n继续说明");
    const next = applyManualPayload(resume, section.id, value);
    const changed = next.sections[0] as ListSection;
    expect(changed.items.map((item) => item.id)).toEqual(section.items.map((item) => item.id));
    expect(changed.items.flatMap((item) => item.bullets.map((bullet) => bullet.id))).toEqual(section.items.flatMap((item) => item.bullets.map((bullet) => bullet.id)));
    expect(changed.items[0].title).toBe("新名称 | 含竖线");
    expect(changed.items[0].bullets[0].text).toBe("两行内容\n继续说明");
    expect(section).toEqual(original);
  });

  it("keeps the chosen duplicate's identity and allows a manual field to be cleared", () => {
    const { resume } = sampleDoc();
    const item = (resume.sections[0] as ListSection).items[0];
    item.bullets = [{ id: "first-copy", text: "相同内容" }, { id: "second-copy", text: "相同内容" }];
    const value = editPayloadField("item", getPayload(resume, item.id)!, "bullets.1", "");
    const next = applyManualPayload(resume, item.id, value);
    expect((next.sections[0] as ListSection).items[0].bullets).toEqual([{ id: "first-copy", text: "相同内容" }, { id: "second-copy", text: "" }]);
    expect(getPayload(applyManualPayload(next, titleId(item.id), { text: "" }), titleId(item.id))).toEqual({ text: "" });
  });

  it("rejects structural changes through the fixed manual form", () => {
    const { resume } = sampleDoc();
    const section = resume.sections[0] as ListSection;
    const value = getPayload(resume, section.id) as SectionPayload;
    expect(applyManualPayload(resume, section.id, { ...value, items: value.items.slice(1) })).toBe(resume);
    const item = section.items[0];
    const itemValue = getPayload(resume, item.id) as ItemPayload;
    expect(applyManualPayload(resume, item.id, { ...itemValue, bullets: itemValue.bullets.slice(1) })).toBe(resume);
    expect(editPayloadField("item", itemValue, "unknown", "value")).toBe(itemValue);
  });

  it("preserves prose whitespace and its body id when editing a text section", () => {
    const { resume } = sampleDoc();
    resume.sections.push({ id: "closing", kind: "text", title: "补充", body: { id: "closing-body", text: "原文" } });
    const value = editPayloadField("section", getPayload(resume, "closing")!, "items.0.bullets.0", " 第一行\n\n最后一行 ");
    expect(applyManualPayload(resume, "closing", value).sections.at(-1)).toEqual({ id: "closing", kind: "text", title: "补充", body: { id: "closing-body", text: " 第一行\n\n最后一行 " } });
  });
});
