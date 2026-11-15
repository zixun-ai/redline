import { describe, expect, it } from "vitest";
import { getPayload } from "./nodes";
import { sampleDoc } from "./sample";
import { safeJobProposals } from "./threads";
import type { Doc, JobTarget, ListSection, Message, Thread } from "./types";

const job: JobTarget = { id: "current-job", summary: "当前岗位", missing: [] };
const targetId = (doc: Doc, index = 0) => (doc.resume.sections[0] as ListSection).items[0].bullets[index].id;

const proposalMessage = (doc: Doc, id: string, target: string, fromJd = true): Message => ({
  id, role: "ai", text: "建议修改", at: 1, fromJd,
  proposal: {
    id: `proposal-${id}`, kind: "content", targetId: target, type: "bullet", status: "pending", why: "岗位匹配",
    before: JSON.stringify(getPayload(doc.resume, target)), after: { text: "梳理产品需求并跟进相关工作" }, unsupported: [],
  },
});

const thread = (doc: Doc, id: string, target = targetId(doc)): Thread => ({
  id, targetId: target, label: "工作经历", jobId: job.id, resolved: false,
  messages: [
    { id: `request-${id}`, role: "user", text: "岗位要求", at: 0, fromJd: true },
    proposalMessage(doc, `response-${id}`, target),
  ],
});

describe("safeJobProposals", () => {
  it("includes the original proposals from the current job", () => {
    const doc = sampleDoc();
    const current = thread(doc, "current");
    expect(safeJobProposals(doc, [current], job).map((p) => p.messageId)).toEqual(["response-current"]);
  });

  it("excludes old jobs, ordinary comments and missing job identifiers", () => {
    const doc = sampleDoc();
    const old = { ...thread(doc, "old"), jobId: "previous-job" };
    const ordinary = { ...thread(doc, "ordinary"), jobId: undefined };
    expect(safeJobProposals(doc, [old, ordinary], job)).toEqual([]);
    expect(safeJobProposals(doc, [thread(doc, "current")], null)).toEqual([]);
    expect(safeJobProposals(doc, [thread(doc, "current")], { summary: "旧记录没有批次", missing: [] })).toEqual([]);
  });

  it("does not treat an ordinary follow-up in a job thread as an original job proposal", () => {
    const doc = sampleDoc();
    const current = thread(doc, "current");
    current.messages[1].proposal!.status = "rejected";
    current.messages.push(
      { id: "follow-up", role: "user", text: "再改一下", at: 2 },
      proposalMessage(doc, "ordinary-response", current.targetId, false),
    );
    // The thread and its first user message still identify the job; the later AI reply does not.
    expect(safeJobProposals(doc, [current], job)).toEqual([]);
  });

  it("excludes both conflicting pending proposals for one target", () => {
    const doc = sampleDoc();
    const first = thread(doc, "first");
    const second = thread(doc, "second", first.targetId);
    expect(safeJobProposals(doc, [first, second], job)).toEqual([]);
    first.messages.push(proposalMessage(doc, "ordinary-conflict", first.targetId, false));
    expect(safeJobProposals(doc, [first], job)).toEqual([]);
  });

  it("allows independent targets while ignoring rejected and resolved conflicts", () => {
    const doc = sampleDoc();
    const first = thread(doc, "first");
    const second = thread(doc, "second", targetId(doc, 1));
    const rejected = thread(doc, "rejected", first.targetId);
    rejected.messages[1].proposal!.status = "rejected";
    const resolved = { ...thread(doc, "resolved", first.targetId), resolved: true };
    expect(safeJobProposals(doc, [first, second, rejected, resolved], job).map((p) => p.threadId)).toEqual(["first", "second"]);
  });

  it("rechecks the original text and local facts instead of trusting saved risk flags", () => {
    const doc = sampleDoc();
    const stale = thread(doc, "stale");
    const risk = thread(doc, "risk", targetId(doc, 1));
    const placeholder = thread(doc, "placeholder", targetId(doc, 2));
    if (stale.messages[1].proposal?.kind === "content") stale.messages[1].proposal.before = '{"text":"以前的内容"}';
    if (risk.messages[1].proposal?.kind === "content") risk.messages[1].proposal.after = { text: "转化率提升 5%" };
    if (placeholder.messages[1].proposal?.kind === "content") placeholder.messages[1].proposal.after = { text: "成果为 [待填写：数字]" };
    expect(safeJobProposals(doc, [stale, risk, placeholder], job)).toEqual([]);
  });
});
