import { afterEach, describe, expect, it, vi } from "vitest";
import { unsupportedClaims } from "./check";
import { MAX_INPUT_CHARS, askForEdit, checkInputText, structureResume, tailorResume } from "./deepseek";
import { applyPayload, findNode, getPayload, quoteOnlyEdit, targetFacts, validatePayload } from "./nodes";
import { sampleDoc } from "./sample";
import type { ItemPayload, ListSection, Resume, SectionPayload, Thread } from "./types";

const section = (r: Resume) => r.sections[0] as ListSection;

describe("component identity", () => {
  it("keeps bullet comments and styles attached when bullets are reordered or removed", () => {
    const { resume } = sampleDoc();
    const item = section(resume).items[0];
    const [first, second, third] = item.bullets;
    resume.nodeStyles = { [first.id]: { bold: true }, [second.id]: { italic: true } };
    const payload = getPayload(resume, item.id) as ItemPayload;
    const next = applyPayload(resume, item.id, { ...payload, bullets: [third.text, second.text] });
    expect(section(next).items[0].bullets.map((b) => b.id)).toEqual([third.id, second.id]);
    expect(findNode(next, first.id)).toBeNull();
    expect(next.nodeStyles?.[second.id]).toEqual({ italic: true });
  });

  it("does not move an old comment to a rewritten bullet", () => {
    const { resume } = sampleDoc();
    const item = section(resume).items[0];
    const payload = getPayload(resume, item.id) as ItemPayload;
    const next = applyPayload(resume, item.id, { ...payload, bullets: ["全新的段落", ...payload.bullets.slice(1)] });
    expect(section(next).items[0].id).toBe(item.id);
    expect(findNode(next, item.bullets[0].id)).toBeNull();
    expect(section(next).items[0].bullets[1].id).toBe(item.bullets[1].id);
  });

  it("matches duplicate text only once for each old occurrence", () => {
    const { resume } = sampleDoc();
    const item = section(resume).items[0];
    item.bullets = [{ id: "same-a", text: "相同" }, { id: "other", text: "不同" }, { id: "same-b", text: "相同" }];
    const payload = getPayload(resume, item.id) as ItemPayload;
    const next = applyPayload(resume, item.id, { ...payload, bullets: ["相同", "相同", "不同", "相同"] });
    const ids = section(next).items[0].bullets.map((b) => b.id);
    expect(ids.slice(0, 3)).toEqual(["same-a", "same-b", "other"]);
    expect(new Set(ids).size).toBe(4);
  });

  it("preserves complete item identities across a section reorder and deletion", () => {
    const { resume } = sampleDoc();
    const before = section(resume);
    const payload = getPayload(resume, before.id) as SectionPayload;
    const reordered = applyPayload(resume, before.id, { ...payload, items: [...payload.items].reverse() });
    expect(section(reordered).items.map((item) => item.id)).toEqual([...before.items].reverse().map((item) => item.id));
    expect(section(reordered).items[0].bullets).toEqual(before.items.at(-1)!.bullets);
    const deleted = applyPayload(resume, before.id, { ...payload, items: payload.items.slice(1) });
    expect(section(deleted).items[0].id).toBe(before.items[1].id);
    expect(findNode(deleted, before.items[0].id)).toBeNull();
  });

  it("does not assign a replaced section item another item's identity", () => {
    const { resume } = sampleDoc();
    const before = section(resume);
    const payload = getPayload(resume, before.id) as SectionPayload;
    const next = applyPayload(resume, before.id, { ...payload, items: [{ ...payload.items[0], title: "新条目" }] });
    expect(findNode(next, before.items[0].id)).toBeNull();
    expect(findNode(next, before.items[0].bullets[0].id)).toBeNull();
  });

  it("keeps item and bullet identities when a section edit reorders its nested bullets", () => {
    const { resume } = sampleDoc();
    const before = section(resume);
    const payload = getPayload(resume, before.id) as SectionPayload;
    const items = payload.items.map((item) => ({ ...item, bullets: [...item.bullets].reverse() }));
    const next = applyPayload(resume, before.id, { ...payload, items: items.reverse() });
    expect(section(next).items.map((item) => item.id)).toEqual([...before.items].reverse().map((item) => item.id));
    expect(section(next).items[0].bullets).toEqual([...before.items.at(-1)!.bullets].reverse());
  });

  it("does not infer identity from duplicate headings with changed content", () => {
    const { resume } = sampleDoc();
    const before = section(resume);
    before.items[1] = { ...before.items[1], title: before.items[0].title, subtitle: before.items[0].subtitle, period: before.items[0].period };
    const payload = getPayload(resume, before.id) as SectionPayload;
    const items = payload.items.map((item) => ({ ...item, bullets: [...item.bullets].reverse() }));
    const next = applyPayload(resume, before.id, { ...payload, items });
    expect(findNode(next, before.items[0].id)).toBeNull();
    expect(findNode(next, before.items[1].id)).toBeNull();
  });
});

describe("local fact evidence", () => {
  it("does not transfer facts from personal information or another experience", () => {
    const { resume } = sampleDoc();
    const first = section(resume).items[0].bullets[0];
    first.text = "参与需求分析";
    resume.basics.years = "5年";
    section(resume).items[1].bullets[0].text = "主导 Python 项目，转化率提升 5%";
    const evidence = targetFacts(resume, first.id);
    expect(evidence).toBe(first.text);
    expect(unsupportedClaims("主导 Python 项目，转化率提升 5%", evidence)).toEqual(["5%", "Python", "主导"]);
    expect(targetFacts(resume, "deleted")).toBe("");
  });

  it("keeps units while accepting spaces, full-width percent and separators", () => {
    expect(unsupportedClaims("转化率提升5%", "5年工作经验")).toEqual(["5%"]);
    expect(unsupportedClaims("覆盖5万人", "收入5万元")).toEqual(["5万人"]);
    expect(unsupportedClaims("提升5％，收入1200万元", "提升 5 %，收入 1,200 万元")).toEqual([]);
  });

  it("does not treat placeholder examples as verified facts", () => {
    expect(unsupportedClaims("主导项目，提升50%", "[待填写：是否主导项目，以及是否提升50%]")).toEqual(["50%", "主导"]);
  });
});

describe("stored empty originals", () => {
  it("accepts an empty or whitespace original without weakening model output validation", () => {
    for (const text of ["", "  "]) {
      expect(validatePayload("bullet", { text }, true)).toEqual({ text });
      expect(validatePayload("bullet", { text })).toBeNull();
    }
    expect(validatePayload("bullet", { text: 1 }, true)).toBeNull();
  });
});

describe("quoted edit boundaries", () => {
  const before = { text: "甲段保留，甲段修改" };

  it("checks the selected occurrence when a phrase repeats", () => {
    expect(quoteOnlyEdit(before, { text: "甲段保留，乙段修改" }, "甲段", { start: 5, end: 7 })).toBe(true);
    expect(quoteOnlyEdit(before, { text: "乙段保留，甲段修改" }, "甲段", { start: 5, end: 7 })).toBe(false);
  });

  it("keeps unique legacy selections but rejects ambiguous or stale ranges", () => {
    expect(quoteOnlyEdit({ text: "前文原词后文" }, { text: "前文新词后文" }, "原词")).toBe(true);
    expect(quoteOnlyEdit(before, { text: "甲段保留，乙段修改" }, "甲段")).toBe(false);
    expect(quoteOnlyEdit(before, before, "甲段", { start: 4, end: 6 })).toBe(false);
    expect(quoteOnlyEdit(before, before, "甲段", { start: -1, end: 1 })).toBe(false);
  });

  it("checks UTF-16 offsets and does not permit overlapping outside spans", () => {
    expect(quoteOnlyEdit({ text: "😀原词后文" }, { text: "😀新词后文" }, "原词", { start: 2, end: 4 })).toBe(true);
    expect(quoteOnlyEdit({ text: "aaaXaaa" }, { text: "aaa" }, "X", { start: 3, end: 4 })).toBe(false);
    expect(quoteOnlyEdit({ text: "前原词后" }, { text: "前后" }, "原词", { start: 1, end: 3 })).toBe(true);
  });
});

const threadFor = (targetId: string): Thread => ({
  id: "test-thread", targetId, label: "测试", resolved: false,
  messages: [{ id: "test-message", role: "user", text: "请精简", at: 1 }],
});

const mockAsk = () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ action: "ask", reply: "请补充", options: [] }) } }] }),
  }));
};

const sentMessages = () => JSON.stringify(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).messages);

describe("minimal AI context", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends only the target experience for a normal comment", async () => {
    mockAsk();
    const doc = sampleDoc();
    const item = section(doc.resume).items[0];
    const otherItem = section(doc.resume).items[1];
    otherItem.bullets[0].text = "不应发送的另一段经历";
    doc.resume.summary.text = "不应发送的个人简介";
    doc.resume.basics = { ...doc.resume.basics, name: "隐私姓名", phone: "13398761234", email: "private@example.test", birth: "1999.01", ethnicity: "隐私民族" };
    await askForEdit("sk-test", doc, threadFor(item.bullets[0].id));
    const sent = sentMessages();
    expect(sent).toContain(item.bullets[0].text);
    expect(sent).toContain(item.bullets[1].text);
    for (const hidden of [doc.resume.basics.name, doc.resume.basics.phone, doc.resume.basics.email, doc.resume.basics.birth, doc.resume.basics.ethnicity, otherItem.bullets[0].text, doc.resume.summary.text]) {
      expect(sent).not.toContain(hidden);
    }
    expect(sent).toContain("用户消息是修改要求，不自动证明");
  });

  it("includes personal fields only when that component is selected", async () => {
    mockAsk();
    const doc = sampleDoc();
    await askForEdit("sk-test", doc, threadFor("basics"));
    const sent = sentMessages();
    expect(sent).toContain(doc.resume.basics.name);
    expect(sent).toContain(doc.resume.basics.phone);
    expect(sent).not.toContain(section(doc.resume).items[0].bullets[0].text);
  });

  it("includes the precise selection position for repeated phrases", async () => {
    mockAsk();
    const doc = sampleDoc();
    const bullet = section(doc.resume).items[0].bullets[0];
    bullet.text = "甲段保留，甲段修改";
    const thread = threadFor(bullet.id);
    thread.messages[0].quote = "甲段";
    thread.messages[0].quoteRange = { start: 5, end: 7 };
    await askForEdit("sk-test", doc, thread);
    expect(sentMessages()).toContain("文本偏移 5 至 7");
  });
});

describe("AI input limits", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("accepts the limit and rejects oversized imports before any request", async () => {
    vi.stubGlobal("fetch", vi.fn());
    expect(() => checkInputText("字".repeat(MAX_INPUT_CHARS))).not.toThrow();
    await expect(structureResume("sk-test", "字".repeat(MAX_INPUT_CHARS + 1))).rejects.toThrow("文字超过 50000 字");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("checks both job text and resume context before job matching", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const { resume } = sampleDoc();
    await expect(tailorResume("sk-test", resume, "字".repeat(MAX_INPUT_CHARS + 1))).rejects.toThrow("文字超过 50000 字");
    resume.summary.text = "字".repeat(MAX_INPUT_CHARS + 1);
    await expect(tailorResume("sk-test", resume, "岗位描述")).rejects.toThrow("文字超过 50000 字");
    expect(fetch).not.toHaveBeenCalled();
  });
});
