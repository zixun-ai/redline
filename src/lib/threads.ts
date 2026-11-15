import type { Doc, JobTarget, Proposal, Thread } from "./types";
import { flatten, getPayload, targetFacts } from "./nodes";
import { unsupportedClaims } from "./check";

/**
 * A proposal moves only along these edges; anything else is a stale click and is ignored.
 *
 *   pending ──accept──▶ accepted ──revert──▶ pending
 *   pending ──reject──▶ rejected
 */
export const MOVES = {
  accept: { from: "pending", to: "accepted" },
  reject: { from: "pending", to: "rejected" },
  revert: { from: "accepted", to: "pending" },
} as const satisfies Record<string, { from: Proposal["status"]; to: Proposal["status"] }>;

export type Move = keyof typeof MOVES;

export const canMove = (p: Proposal | undefined, move: Move): p is Proposal => !!p && p.status === MOVES[move].from;

export const hasPending = (t: Thread) => t.messages.some((m) => m.proposal?.status === "pending");

export function safeJobProposals(doc: Doc, threads: Thread[], job: JobTarget | null) {
  if (!job?.id) return [];
  const candidates = threads.filter(t => !t.resolved && t.jobId === job.id).flatMap(t =>
    t.messages.flatMap(m => m.proposal?.kind === "content" && m.proposal.status === "pending"
      ? [{ threadId: t.id, messageId: m.id, fromJd: m.fromJd, proposal: m.proposal }] : []));
  return candidates.filter(({ proposal: p, fromJd }) => fromJd
    && candidates.filter(c => c.proposal.targetId === p.targetId).length === 1
    && !p.unsupported.length && !flatten(p.type, p.after).includes("[待填写")
    && !unsupportedClaims(flatten(p.type, p.after), targetFacts(doc.resume, p.targetId)).length
    && JSON.stringify(getPayload(doc.resume, p.targetId)) === p.before);
}

/**
 * Where a comment thread stands, worked out from what it holds rather than stored next to it:
 * - `asking`: DeepSeek is answering it (even if it was just checked off).
 * - `resolved`: put away in 已解决.
 * - `deciding`: a proposal waits for accept or reject.
 * - `failed`: the last answer is an error, with a retry under it.
 * - `open`: waiting on the user, after a question, a reply that needs nothing, or a decision.
 *
 * The card carries it as `data-state`, so tests and agents can read it off the page.
 */
export type ThreadState = "asking" | "resolved" | "deciding" | "failed" | "open";

export function threadState(t: Thread, asking: boolean): ThreadState {
  if (asking) return "asking";
  if (t.resolved) return "resolved";
  if (hasPending(t)) return "deciding";
  return t.messages[t.messages.length - 1]?.failed ? "failed" : "open";
}
