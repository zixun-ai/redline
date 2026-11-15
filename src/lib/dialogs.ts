/**
 * Which dialog is open, as one value. The key dialog can be a detour from import or either review: closing it goes back
 * there, and saving a key goes back and, if the user was on their way to run that step, runs it.
 *
 *   closed ──open──▶ import | tailor | audit | block | key
 *   import | tailor | audit ──needKey──▶ key (back: that step, run)
 *   key ──keySaved──▶ back.to (resume when back.run and a key was saved) | closed
 *   key ──keyClosed──▶ back.to | closed
 *   import | tailor | audit (resume) ──resumed──▶ the same, not resuming
 *   any ──close──▶ closed
 */

export type Step = "import" | "tailor" | "audit";

export type Dialogs =
  | { open: null }
  | { open: Step; resume: boolean }
  | { open: "block" }
  | { open: "key"; back: { to: Step; run: boolean } | null };

export type DialogEvent =
  | { type: "open"; name: Step | "block" | "key" }
  | { type: "needKey"; from: Step }
  | { type: "keySaved"; key: string }
  | { type: "keyClosed" }
  | { type: "resumed" }
  | { type: "close" };

export const CLOSED: Dialogs = { open: null };

const isStep = (open: Dialogs["open"]): open is Step => open === "import" || open === "tailor" || open === "audit";

export function dialogs(s: Dialogs, e: DialogEvent): Dialogs {
  switch (e.type) {
    case "open":
      // A key asked for from inside a step (a request failing on a bad key) still comes back to that step.
      if (e.name === "key") return { open: "key", back: isStep(s.open) ? { to: s.open, run: false } : null };
      return e.name === "block" ? { open: "block" } : { open: e.name, resume: false };
    case "needKey":
      return { open: "key", back: { to: e.from, run: true } };
    case "keySaved":
      if (s.open !== "key") return s;
      return s.back ? { open: s.back.to, resume: s.back.run && !!e.key } : CLOSED;
    case "keyClosed":
      if (s.open !== "key") return s;
      return s.back ? { open: s.back.to, resume: false } : CLOSED;
    case "resumed":
      return isStep(s.open) ? { open: s.open, resume: false } : s;
    case "close":
      return CLOSED;
  }
}

/** Whether the step that's open should run as it opens, carrying on from the key detour. */
export const resuming = (s: Dialogs, step: Step) => s.open === step && s.resume;
