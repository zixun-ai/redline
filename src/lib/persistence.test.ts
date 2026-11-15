import { expect, it } from "vitest";
import { recoverState } from "./persistence";
import { isThreads, styleStale } from "./storage";
import { sampleDoc } from "./sample";
import type { Thread } from "./types";

const thread: Thread = {
  id: "t", targetId: "blank", label: "空白要点", resolved: false,
  messages: [{ id: "m", role: "ai", text: "建议", at: 1, proposal: {
    id: "p", kind: "content", status: "pending", why: "", targetId: "blank", type: "bullet",
    before: '{"text":""}', after: { text: "补充的内容" }, unsupported: [],
  } }],
};

it("loads proposals whose original component was empty", () => {
  expect(isThreads([thread])).toBe(true);
  expect(recoverState({ threads: [thread] }).state.threads).toEqual([thread]);
});

it("recovers valid threads independently and retains the complete damaged value", () => {
  const damaged = [thread, { id: "broken", messages: [null] }];
  const loaded = recoverState({ doc: sampleDoc(), threads: damaged, job: { wrong: true } });
  expect(loaded.state.threads).toEqual([thread]);
  expect(loaded.invalid.threads).toBe(damaged);
  expect(loaded.invalid.job).toEqual({ wrong: true });
  expect(loaded.state.job).toBeNull();
});

it("rejects invalid quote offsets without dropping other threads", () => {
  const bad = { ...thread, messages: [{ id: "m2", role: "user", text: "x", at: 1, quote: "xx", quoteRange: { start: -1, end: 1 } }] };
  expect(recoverState({ threads: [bad, thread] }).state.threads).toEqual([thread]);
});

it("isolates malformed style keys without throwing during recovery", () => {
  const malformed = { ...thread, messages: [{ id: "m2", role: "ai", text: "", at: 1, proposal: {
    id: "p2", kind: "style", status: "pending", why: "", beforeDesign: sampleDoc().design, patch: { toString: "bad" },
  } }] };
  expect(recoverState({ threads: [malformed, thread] }).state.threads).toEqual([thread]);
});

it("blocks only style fields that changed after the proposal", () => {
  const doc = sampleDoc();
  const p = { id: "p", kind: "style" as const, status: "pending" as const, why: "", beforeDesign: doc.design, patch: { density: "compact" as const } };
  expect(styleStale({ ...doc, design: { ...doc.design, accent: "#000000" } }, p)).toBe(false);
  expect(styleStale({ ...doc, design: { ...doc.design, density: "relaxed" } }, p)).toBe(true);
  const node = { id: "n", kind: "nodeStyle" as const, status: "pending" as const, why: "", targetId: "basics", beforeStyle: { bold: false }, patch: { bold: true } };
  expect(styleStale(doc, node)).toBe(false);
  expect(styleStale({ ...doc, resume: { ...doc.resume, nodeStyles: { basics: { bold: true } } } }, node)).toBe(true);
});
