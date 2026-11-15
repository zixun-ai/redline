import { describe, expect, it } from "vitest";
import { placeholders, unsupportedClaims } from "./check";
import { diffChars, isRewrite } from "./diff";
import { applyPayload, editableFields, findNode, pathTo, getPayload, setNodeStyle, subtitleId, validatePayload } from "./nodes";
import { parseResult, parseTailor } from "./deepseek";
import { changedRows, mergeRows } from "./rows";
import { sampleDoc } from "./sample";
import type { ListSection, Resume } from "./types";

/** The sample has no text modules, so each of its modules has entries. */
const entries = (r: Resume, i: number) => (r.sections[i] as ListSection).items;

describe("unsupportedClaims", () => {
  const source = "带领 3 人团队，用 SQL 分析，转化率提升 12%，收入 1,200 万";

  it("flags invented numbers and tools", () => {
    expect(unsupportedClaims("转化率提升 30%，使用 Python", source)).toEqual(["30%", "Python"]);
  });
  it("accepts facts already present, whatever the case or thousands separator", () => {
    expect(unsupportedClaims("3 人团队，sql，提升 12%，收入 1200 万", source)).toEqual([]);
  });
  it("ignores placeholders", () => {
    expect(unsupportedClaims("提升 [待填写：提升 50 个百分比]", source)).toEqual([]);
  });
});

describe("placeholders", () => {
  it("finds what still blocks export", () => {
    const { resume } = sampleDoc();
    expect(placeholders(resume)).toEqual([]);
    const next = { ...resume, summary: { ...resume.summary, text: "提升 [待填写：比例]" } };
    expect(placeholders(next)).toEqual(["[待填写：比例]"]);
  });
});

describe("diffChars", () => {
  it("reconstructs both sides", () => {
    const segs = diffChars("负责产品工作", "主导产品规划工作");
    expect(segs.filter((s) => s.t !== "add").map((s) => s.s).join("")).toBe("负责产品工作");
    expect(segs.filter((s) => s.t !== "del").map((s) => s.s).join("")).toBe("主导产品规划工作");
  });
});

describe("diffChars readability", () => {
  it("folds short coincidental matches into one replacement", () => {
    const segs = diffChars("负责产品工作并上线", "主导产品规划工作并完成交付");
    expect(segs.map((s) => s.t)).toEqual(["del", "add"]);
  });
  it("keeps a long shared phrase as an anchor", () => {
    const segs = diffChars("负责客户管理系统的工作", "主导客户管理系统的迭代");
    expect(segs.some((s) => s.t === "same" && s.s === "客户管理系统的")).toBe(true);
  });
  it("calls a long text mostly replaced a rewrite, and a light edit or a short one not", () => {
    expect(isRewrite(diffChars("负责客户管理系统的产品工作，参与了很多需求的讨论和上线。", "主导客户管理系统迭代，转化率提升 [待填写]。"))).toBe(true);
    expect(isRewrite(diffChars("负责客户管理系统的产品工作，参与了很多需求的讨论和上线。", "负责客户管理系统的产品规划，参与了很多需求的讨论和上线。"))).toBe(false);
    expect(isRewrite(diffChars("负责客户管理系统的产品工作，参与了很多需求的讨论和上线。", "负责客户管理系统的产品规划，主导了需求评审和上线。"))).toBe(false);
    expect(isRewrite(diffChars("负责客户管理系统的产品工作，参与了很多需求的讨论和上线。", "主导客户管理系统的产品规划，推动了需求评审与按期上线。"))).toBe(true);
    expect(isRewrite(diffChars("负责产品工作", "主导产品规划"))).toBe(false);
    expect(isRewrite(diffChars("", "新增的一整句话，内容完全是新的。"))).toBe(false);
  });
});

describe("nodes", () => {
  it("finds a bullet and applies a text change without touching its id", () => {
    const { resume } = sampleDoc();
    const bullet = entries(resume, 0)[0].bullets[1];
    expect(findNode(resume, bullet.id)?.type).toBe("bullet");
    const next = applyPayload(resume, bullet.id, { text: "新内容" });
    expect(entries(next, 0)[0].bullets[1]).toEqual({ id: bullet.id, text: "新内容" });
    expect(entries(resume, 0)[0].bullets[1].text).not.toBe("新内容");
  });
  it("keeps unchanged bullet ids when an item gains a row", () => {
    const { resume } = sampleDoc();
    const it0 = entries(resume, 0)[0];
    const p = getPayload(resume, it0.id) as { bullets: string[] };
    const next = applyPayload(resume, it0.id, { ...p, bullets: [...p.bullets, "新增一条"] } as never);
    const bullets = entries(next, 0)[0].bullets;
    expect(bullets[0].id).toBe(it0.bullets[0].id);
    expect(bullets).toHaveLength(it0.bullets.length + 1);
  });
  it("rejects malformed model output", () => {
    expect(validatePayload("bullet", { text: "  " })).toBeNull();
    expect(validatePayload("item", { title: "a", bullets: [1] })).toBeNull();
    expect(validatePayload("section", { title: "a", items: [{}] })).toBeNull();
  });
});

describe("parseResult", () => {
  it("describes formatting from the patch, not from what the model claims", () => {
    const r = parseResult("item", { action: "node_style", reply: "已改成红色并加粗", patch: { bold: true, color: "red" }, unsupported: ["字号"] });
    expect(r).toMatchObject({ action: "node_style", patch: { bold: true } });
    expect(r.action === "node_style" && r.patch.color).toBeUndefined();
    expect(r.reply).toBe("建议调整：加粗。接受后生效。 暂时做不到：字号。");
  });

  it("keeps a real text color", () => {
    const r = parseResult("item", { action: "node_style", patch: { color: "#B4351F" } });
    expect(r.action === "node_style" && r.patch.color).toBe("#B4351F");
  });

  it("clamps style values and drops unknown ones", () => {
    const r = parseResult("bullet", { action: "style", reply: "好", patch: { fontScale: 5, accent: "red", density: "compact" } });
    expect(r).toMatchObject({ action: "style", patch: { fontScale: 1.1, density: "compact" } });
    expect(r.action === "style" && "accent" in r.patch).toBe(false);
  });
  it("throws on an edit with the wrong shape", () => {
    expect(() => parseResult("bullet", { action: "edit", after: { title: "x" } })).toThrow();
  });
});

describe("Chinese claims", () => {
  it("flags role inflation and new organizations", () => {
    const found = unsupportedClaims("主导项目，曾任职于星河科技有限公司", "参与项目");
    expect(found).toContain("主导");
    expect(found).toContain("星河科技有限公司");
  });
  it("accepts words the source already has", () => {
    expect(unsupportedClaims("主导项目", "主导项目上线")).toEqual([]);
  });
});

describe("rows", () => {
  const before = { title: "A", subtitle: "x", period: "1", bullets: ["一", "二", "三"] };
  const after = { title: "A", subtitle: "x", period: "1", bullets: ["一", "二改", "三改", "四"] };

  it("lists only what changed", () => {
    expect(changedRows("item", before, after).map((r) => r.key)).toEqual(["b1", "b2", "b3"]);
  });
  it("merges the kept rows and leaves the others", () => {
    expect(mergeRows("item", before, after, new Set(["b2"]))).toMatchObject({ bullets: ["一", "二", "三改"] });
    expect(mergeRows("item", before, after, new Set(["b3"]))).toMatchObject({ bullets: ["一", "二", "三", "四"] });
  });
  it("can drop a row", () => {
    const shorter = { ...before, bullets: ["一"] };
    expect(mergeRows("item", before, shorter, new Set(["b1"]))).toMatchObject({ bullets: ["一", "三"] });
  });
  it("merges sections by item", () => {
    const sb = { title: "T", items: [before] };
    const sa = { title: "T2", items: [after, before] };
    const merged = mergeRows("section", sb, sa, new Set(["i1"])) as { title: string; items: unknown[] };
    expect(merged.title).toBe("T");
    expect(merged.items).toHaveLength(2);
  });
});

describe("parseTailor", () => {
  it("drops unknown ids, duplicates and unchanged text", () => {
    const { resume } = sampleDoc();
    const b = entries(resume, 0)[0].bullets[0];
    const r = parseTailor({
      missing: ["Kubernetes"],
      edits: [
        { id: "nope", text: "x" },
        { id: b.id, text: b.text },
        { id: b.id, text: "新", requirement: "r" },
        { id: b.id, text: "再一次" },
      ],
    }, resume);
    expect(r.edits.map((e) => e.text)).toEqual(["新"]);
    expect(r.missing).toEqual(["Kubernetes"]);
  });
  it("throws when nothing usable came back", () => {
    expect(() => parseTailor({ edits: [] }, sampleDoc().resume)).toThrow();
  });
});

describe("ask options", () => {
  it("keeps at most four short strings", () => {
    const r = parseResult("bullet", { action: "ask", reply: "?", options: ["a", 2, "", "b", "c", "d", "e"] });
    expect(r).toMatchObject({ options: ["a", "b", "c", "d"] });
  });
});

describe("component formatting", () => {
  it("sets, clears and leaves other components alone", () => {
    const { resume } = sampleDoc();
    const on = setNodeStyle(resume, "basics", { align: "center", bold: true });
    expect(on.nodeStyles?.basics).toEqual({ align: "center", bold: true });
    expect(setNodeStyle(on, "basics", { align: undefined }).nodeStyles?.basics).toEqual({ bold: true });
    expect(setNodeStyle(setNodeStyle(on, "basics", { align: undefined }), "basics", { bold: false }).nodeStyles?.basics).toBeUndefined();
  });
  it("gives the way down to any component", () => {
    const resume = sampleDoc().resume;
    const section = resume.sections[0];
    const item = entries(resume, 0)[0];
    expect(pathTo(resume, section.id).map((c) => c.name)).toEqual([section.title]);
    expect(pathTo(resume, item.id).map((c) => c.id)).toEqual([section.id, item.id]);
    expect(pathTo(resume, item.bullets[1].id).at(-1)).toEqual({ id: item.bullets[1].id, name: "第 2 条" });
    expect(pathTo(resume, "basics")).toEqual([{ id: "basics", name: "个人信息" }]);
    expect(pathTo(resume, "missing")).toEqual([]);
    expect(pathTo(resume, item.bullets[1].id, true).map((c) => c.name)).toEqual([section.title, item.title, "Bullet 2"]);
    expect(findNode(resume, "basics", true)?.label).toBe("Personal information");
    expect(editableFields("basics", resume.basics, true)[0]).toMatchObject({ key: "name", label: "Name", value: resume.basics.name });
  });

  it("treats a subtitle as its own component", () => {
    const { resume } = sampleDoc();
    const item = entries(resume, 0)[1];
    const id = subtitleId(item.id);
    expect(findNode(resume, id)?.type).toBe("field");
    expect(pathTo(resume, id).map((c) => c.id)).toEqual([resume.sections[0].id, item.id, id]);
    expect(getPayload(resume, id)).toEqual({ text: "产品经理" });
    expect(entries(applyPayload(resume, id, { text: "产品负责人" }), 0)[1].subtitle).toBe("产品负责人");
  });
  it("parses a local format request and refuses a bad one", () => {
    expect(parseResult("item", { action: "node_style", reply: "好", target: "subtitle", patch: { align: "center" } }))
      .toMatchObject({ action: "node_style", subtitle: true, patch: { align: "center" } });
    expect(parseResult("bullet", { action: "node_style", reply: "好", target: "subtitle", patch: { bold: true } }))
      .toMatchObject({ subtitle: false });
    expect(() => parseResult("bullet", { action: "node_style", patch: { align: "middle" } })).toThrow();
  });
});
