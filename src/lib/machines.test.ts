import { describe, expect, it } from "vitest";
import { CLOSED, dialogs, resuming, type Dialogs } from "./dialogs";
import { canMove, threadState } from "./threads";
import type { Message, Proposal, Thread } from "./types";

const run = (...events: Parameters<typeof dialogs>[1][]) => events.reduce<Dialogs>(dialogs, CLOSED);

describe("the dialogs", () => {
  it("opens one dialog at a time and closes to nothing", () => {
    expect(run({ type: "open", name: "import" })).toEqual({ open: "import", resume: false });
    expect(run({ type: "open", name: "import" }, { type: "open", name: "block" })).toEqual({ open: "block" });
    expect(run({ type: "open", name: "tailor" }, { type: "close" })).toEqual(CLOSED);
  });

  it("closing the key detour goes back to the step without running it", () => {
    const s = run({ type: "open", name: "import" }, { type: "needKey", from: "import" }, { type: "keyClosed" });
    expect(s).toEqual({ open: "import", resume: false });
  });

  it("saving the key on the detour goes back and runs the step once", () => {
    const back = run({ type: "open", name: "tailor" }, { type: "needKey", from: "tailor" }, { type: "keySaved", key: "sk-1" });
    expect(resuming(back, "tailor")).toBe(true);
    expect(resuming(back, "import")).toBe(false);
    expect(resuming(dialogs(back, { type: "resumed" }), "tailor")).toBe(false);
  });

  it("removing the key on the detour goes back without running into the key dialog again", () => {
    const s = run({ type: "open", name: "import" }, { type: "needKey", from: "import" }, { type: "keySaved", key: "" });
    expect(s).toEqual({ open: "import", resume: false });
  });

  it("a key asked for from inside a step comes back to it, but saving it runs nothing", () => {
    const s = run({ type: "open", name: "import" }, { type: "open", name: "key" });
    expect(s).toEqual({ open: "key", back: { to: "import", run: false } });
    expect(dialogs(s, { type: "keySaved", key: "sk-1" })).toEqual({ open: "import", resume: false });
  });

  it("the key dialog on its own closes to nothing either way", () => {
    expect(run({ type: "open", name: "key" }, { type: "keySaved", key: "sk-1" })).toEqual(CLOSED);
    expect(run({ type: "open", name: "key" }, { type: "keyClosed" })).toEqual(CLOSED);
  });

  it("key events outside the key dialog change nothing", () => {
    const s = run({ type: "open", name: "block" });
    expect(dialogs(s, { type: "keySaved", key: "sk-1" })).toBe(s);
    expect(dialogs(s, { type: "keyClosed" })).toBe(s);
  });
});

const proposal = (status: Proposal["status"]): Proposal =>
  ({ id: "p", kind: "style", status, why: "", patch: {}, beforeDesign: {} as never });
const msg = (extra: Partial<Message> = {}): Message => ({ id: Math.random().toString(), role: "ai", text: "", at: 0, ...extra });
const thread = (messages: Message[], resolved = false): Thread => ({ id: "t", targetId: "n", label: "", resolved, messages });

describe("a proposal", () => {
  it("is decided only while pending, and undone only once accepted", () => {
    expect(canMove(proposal("pending"), "accept")).toBe(true);
    expect(canMove(proposal("pending"), "reject")).toBe(true);
    expect(canMove(proposal("accepted"), "accept")).toBe(false);
    expect(canMove(proposal("rejected"), "reject")).toBe(false);
    expect(canMove(proposal("accepted"), "revert")).toBe(true);
    expect(canMove(proposal("rejected"), "revert")).toBe(false);
    expect(canMove(proposal("pending"), "revert")).toBe(false);
    expect(canMove(undefined, "accept")).toBe(false);
  });
});

describe("a thread", () => {
  it("is asking while DeepSeek answers, even once checked off", () => {
    expect(threadState(thread([msg()]), true)).toBe("asking");
    expect(threadState(thread([msg()], true), true)).toBe("asking");
  });

  it("is deciding while a proposal waits, and resolved once put away", () => {
    expect(threadState(thread([msg({ proposal: proposal("pending") })]), false)).toBe("deciding");
    expect(threadState(thread([msg({ proposal: proposal("pending") })], true), false)).toBe("resolved");
  });

  it("is failed when the last answer is an error, and open otherwise", () => {
    expect(threadState(thread([msg({ failed: true })]), false)).toBe("failed");
    expect(threadState(thread([msg({ failed: true }), msg({ role: "user" })]), false)).toBe("open");
    expect(threadState(thread([msg({ proposal: proposal("accepted") })]), false)).toBe("open");
  });
});
