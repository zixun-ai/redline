import { expect, it } from "vitest";
import { basicsLine, emptyBasics } from "./basics";
import { normalizeDoc } from "./design";
import { applyPayload, resumeFromImport, validatePayload } from "./nodes";
import { sampleDoc } from "./sample";
import { isDoc, isThreads } from "./storage";

const oldBasics = { name: "林", title: "产品", phone: "1", email: "a@b.c", location: "上海", website: "" };

it("loads a save from before the personal fields existed", () => {
  const doc = sampleDoc();
  const old = { ...doc, resume: { ...doc.resume, basics: oldBasics } };
  expect(isDoc(old)).toBe(true);
  expect(normalizeDoc(old as never).resume.basics).toEqual({ ...emptyBasics(), ...oldBasics });
  expect(isDoc({ ...doc, resume: { ...doc.resume, basics: { ...oldBasics, ethnicity: 1 } } })).toBe(false);
});

it("keeps a thread whose proposal was written against the old fields", () => {
  const proposal = { id: "p", status: "pending", why: "w", kind: "content", targetId: "basics", type: "basics", before: JSON.stringify(oldBasics), after: oldBasics, unsupported: [] };
  expect(isThreads([{ id: "t", targetId: "basics", label: "个人信息", resolved: false, messages: [{ id: "m", role: "ai", text: "x", at: 1, proposal }] }])).toBe(true);
});

it("keeps fields a model reply leaves out, and clears ones it empties", () => {
  const r = sampleDoc().resume;
  const reply = validatePayload("basics", { ...oldBasics, marital: "" })!;
  const next = applyPayload(r, "basics", reply).basics;
  expect(next.ethnicity).toBe("汉族");
  expect(next.marital).toBe("");
  expect(next.name).toBe("林");
  expect(validatePayload("basics", { name: "x" })).toBeNull();
});

it("imports the personal fields", () => {
  const r = resumeFromImport({ basics: { name: "王", ethnicity: "回族", politics: "群众" }, sections: [] })!;
  expect(r.basics).toMatchObject({ name: "王", ethnicity: "回族", politics: "群众", hometown: "" });
});

it("prints contact and personal details on their own lines", () => {
  const b = { ...emptyBasics(), phone: "138", wechat: "lin", gender: "男", ethnicity: "汉族", hometown: "浙江", salary: " " };
  expect(basicsLine(b, "contact")).toEqual(["138", "微信 lin"]);
  expect(basicsLine(b, "info")).toEqual(["男", "汉族", "籍贯 浙江"]);
});
