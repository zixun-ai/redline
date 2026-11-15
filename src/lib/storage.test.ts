import { afterEach, expect, it, vi } from "vitest";
import { isDoc, isThreads, isVersions, revertStyle, styleStale } from "./storage";
import { sampleDoc } from "./sample";
import { chatJson } from "./deepseek";

it("rejects malformed nested backup data", () => {
  const doc = sampleDoc();
  expect(isDoc(doc)).toBe(true);
  expect(isDoc({ ...doc, resume: { ...doc.resume, sections: [{ title: "bad" }] } })).toBe(false);
  expect(isThreads([{ id: "t", targetId: "basics", label: "test", resolved: false, messages: [null] }])).toBe(false);
  expect(isVersions([{ id: "v", name: "bad", at: 1, doc: {} }])).toBe(false);
});
it("reverts only the changed style field and rejects later conflicts", () => {
  const before = sampleDoc().design;
  const p = { id: "p", kind: "style" as const, status: "accepted" as const, why: "", beforeDesign: before, patch: { fontScale: 0.9 } };
  const current = { ...before, fontScale: 0.9, accent: "#112233" };
  expect(revertStyle(current, p)).toEqual({ ...before, accent: "#112233" });
  expect(revertStyle({ ...current, fontScale: 1.1 }, p)).toBeNull();
});
afterEach(() => vi.unstubAllGlobals());
it("reports a timeout and permits the next request", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new DOMException("timeout", "TimeoutError"))
    .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }) }));
  await expect(chatJson("test", [], 1)).rejects.toThrow("请求超时");
  expect(await chatJson("test", [], 1)).toEqual({ ok: true });
  expect(vi.mocked(fetch).mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
});

import { exportIssues } from "./check";
it("locates missing name, placeholders and page overflow before export", () => {
  const r = sampleDoc().resume;
  r.basics.name = " ";
  r.summary.text = "[待填写：简介]";
  const issues = exportIssues(r, 3);
  expect(issues.some(x => x.targetId === "basics")).toBe(true);
  expect(issues.some(x => x.targetId === r.summary.id && x.text.includes("待填写"))).toBe(true);
  expect(issues.some(x => x.text.includes("3 行"))).toBe(true);
  expect(exportIssues(sampleDoc().resume, 0)).toEqual([]);
});

it("keeps threads whose style edits use the newer settings", () => {
  const design = sampleDoc().design;
  const thread = (patch: object) => [{
    id: "t", targetId: "basics", label: "x", resolved: false,
    messages: [{ id: "m", role: "ai", text: "", at: 1, proposal: { id: "p", kind: "style", status: "pending", why: "", beforeDesign: design, patch } }],
  }];
  expect(isThreads(thread({ font: "song", heading: "bar", margin: "wide", latin: "serif" }))).toBe(true);
  expect(isThreads(thread({ font: "comic" }))).toBe(false);
});
it("accepts documents saved before the newer settings", () => {
  const doc = sampleDoc();
  const { font: _f, latin: _l, heading: _h, margin: _m, ...old } = doc.design;
  expect(isDoc({ ...doc, design: old })).toBe(true);
  expect(isDoc({ ...doc, design: { ...doc.design, font: "comic" } })).toBe(false);
  const p = { id: "old", kind: "style" as const, status: "pending" as const, why: "", beforeDesign: old as typeof doc.design, patch: { font: "song" as const } };
  expect(styleStale(doc, p)).toBe(false);
  expect(revertStyle({ ...doc.design, font: "song" }, p)?.font).toBe("auto");
});

it("validates per-component formatting", () => {
  const doc = sampleDoc();
  const withStyles = (nodeStyles: unknown) => ({ ...doc, resume: { ...doc.resume, nodeStyles } });
  expect(isDoc(withStyles({ basics: { align: "center", bold: true } }))).toBe(true);
  expect(isDoc(withStyles({ basics: { align: "middle" } }))).toBe(false);
});
