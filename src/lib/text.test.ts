import { afterEach, describe, expect, it, vi } from "vitest";
import { exportIssues } from "./check";
import { parseTailor, structureResume } from "./deepseek";
import { applyPayload, findNode, getPayload, moveClosingSummary, pathTo, resumeFromImport } from "./nodes";
import { sampleDoc } from "./sample";
import { isDoc } from "./storage";
import type { Resume, TextSection } from "./types";

const closing = "五年 B 端产品经验，擅长需求分析和跨团队沟通，做事踏实，学习能力强。";
const header = "林知远\n产品经理\n138-0000-0000 · zhiyuan@example.com · 上海\n";
const modules = "工作经历\n青禾科技 高级产品经理 2022.03 — 至今\n负责客户管理系统的产品工作。\n教育经历\n华东师范大学 本科 2015.09 — 2019.06\n专业技能\n产品工具 Figma、Axure、SQL\n数据分析\n";

/** What a model returns when it files the closing text as the summary. */
const filed = (summary: string) => resumeFromImport({
  basics: { name: "林知远" },
  summary,
  sections: [
    { kind: "experience", title: "工作经历", items: [{ title: "青禾科技", subtitle: "高级产品经理", period: "2022.03 — 至今", bullets: ["负责客户管理系统的产品工作。"] }] },
    { kind: "education", title: "教育经历", items: [{ title: "华东师范大学", subtitle: "本科", period: "2015.09 — 2019.06", bullets: [] }] },
    { kind: "skill", title: "专业技能", items: [{ title: "产品工具", subtitle: "", period: "", bullets: ["Figma、Axure、SQL"] }, { title: "数据分析", subtitle: "", period: "", bullets: [] }] },
  ],
})!;

const last = (r: Resume) => r.sections.at(-1) as TextSection;

describe("a closing summary", () => {
  it("goes back to the end, under the heading it had", () => {
    // The source wraps the paragraph where the PDF line ended; the model joined it.
    const r = moveClosingSummary(filed(closing), `${header}${modules}个人总结\n五年 B 端产品经验，擅长需求分析和跨团队沟通，\n做事踏实，学习能力强。`);
    expect(r.summary.text).toBe("");
    expect(r.sections.map((s) => s.title)).toEqual(["工作经历", "教育经历", "专业技能", "个人总结"]);
    expect(last(r)).toMatchObject({ kind: "text", body: { text: closing } });
  });
  it("leaves a summary written under the name where it is", () => {
    const r = filed(closing);
    expect(moveClosingSummary(r, `${header}个人简介\n${closing}\n${modules}`)).toBe(r);
  });
  it("leaves it where it is when any module comes after it, or when no module title can be found", () => {
    const r = filed(closing);
    const [work, rest] = modules.split("教育经历");
    expect(moveClosingSummary(r, `${header}${work}${closing}\n教育经历${rest}`)).toBe(r);
    expect(moveClosingSummary(r, `${header}${modules.replace("工作经历", "工作经验").replace("教育经历", "教育背景").replace("专业技能", "技能")}\n${closing}`)).toBe(r);
  });
  it("takes its heading from the same line, or from a letter-spaced one", () => {
    expect(last(moveClosingSummary(filed(closing), `${header}${modules}自我评价：${closing}`)).title).toBe("自我评价");
    expect(last(moveClosingSummary(filed(closing), `${header}${modules}自 我 评 价\n${closing}`)).title).toBe("自我评价");
  });
  it("is called 个人总结 when the line before it is the last module's content", () => {
    expect(last(moveClosingSummary(filed(closing), `${header}${modules}${closing}`)).title).toBe("个人总结");
  });
  it("stays put when the source doesn't contain it", () => {
    const r = filed("擅长沟通。");
    expect(moveClosingSummary(r, `${header}${modules}个人总结\n${closing}`)).toBe(r);
  });
  it("is asked for as a text module, and put back on import when the model files it anyway", async () => {
    const reply = { basics: { name: "林知远" }, summary: closing, sections: [{ kind: "experience", title: "工作经历", items: [] }] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(reply) } }] }) }));
    const r = await structureResume("sk-test", `${header}工作经历\n个人总结\n${closing}`);
    const prompt: string = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).messages[0].content;
    expect(prompt).toContain('{"kind":"text","title":"模块名","paragraphs":["每段一个字符串"]}');
    expect(prompt).toContain("末尾的个人总结");
    expect(r.summary.text).toBe("");
    expect(last(r)).toMatchObject({ kind: "text", title: "个人总结", body: { text: closing } });
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("text modules", () => {
  it("import in place, whether the model answers with paragraphs, one string or entries", () => {
    const basics = { name: "王" };
    const work = { kind: "experience", title: "工作经历", items: [] };
    for (const answer of [{ paragraphs: ["第一段。", " 第二段。"] }, { text: "第一段。\n第二段。" }, { items: [{ title: "", bullets: ["第一段。", "第二段。"] }] }]) {
      const r = resumeFromImport({ basics, summary: "", sections: [work, { kind: "text", title: "自我评价", ...answer }, work] })!;
      expect(r.sections.map((s) => s.kind)).toEqual(["experience", "text", "experience"]);
      expect((r.sections[1] as TextSection).body.text).toBe("第一段。\n第二段。");
    }
  });

  const withText = () => {
    const doc = sampleDoc();
    const text: TextSection = { id: "s_text", kind: "text", title: "个人总结", body: { id: "txt_body", text: "第一段。\n第二段。" } };
    return { ...doc, resume: { ...doc.resume, sections: [...doc.resume.sections, text] } };
  };

  it("have a body that is edited like the summary", () => {
    const { resume } = withText();
    expect(findNode(resume, "txt_body")).toEqual({ type: "summary", label: "个人总结 · 正文" });
    expect(pathTo(resume, "txt_body")).toEqual([{ id: "s_text", name: "个人总结" }, { id: "txt_body", name: "正文" }]);
    expect(getPayload(resume, "txt_body")).toEqual({ text: "第一段。\n第二段。" });
    expect(last(applyPayload(resume, "txt_body", { text: "新的一段。" })).body).toEqual({ id: "txt_body", text: "新的一段。" });
  });
  it("go to the model as one entry and come back as paragraphs", () => {
    const { resume } = withText();
    const sent = getPayload(resume, "s_text");
    expect(sent).toEqual({ title: "个人总结", items: [{ title: "", subtitle: "", period: "", bullets: ["第一段。\n第二段。"] }] });
    expect(last(applyPayload(resume, "s_text", sent!))).toEqual(last(resume));
    const answer = { title: "自我评价", items: [{ title: "", subtitle: "", period: "", bullets: ["要点一。", " ", "要点二。"] }] };
    expect(last(applyPayload(resume, "s_text", answer))).toEqual({ ...last(resume), title: "自我评价", body: { id: "txt_body", text: "要点一。\n要点二。" } });
  });
  it("are saved, checked before export and offered for tailoring", () => {
    const doc = withText();
    expect(isDoc(doc)).toBe(true);
    expect(isDoc({ ...doc, resume: { ...doc.resume, sections: [{ id: "s_bad", kind: "text", title: "个人总结" }] } })).toBe(false);
    const draft = applyPayload(doc.resume, "txt_body", { text: "学习能力 [待填写：例子]" });
    expect(exportIssues(draft, 0)).toContainEqual({ targetId: "txt_body", text: "[待填写：例子]" });
    expect(parseTailor({ edits: [{ id: "txt_body", text: "改写后的总结。" }] }, doc.resume).edits.map((e) => e.targetId)).toEqual(["txt_body"]);
  });
});
