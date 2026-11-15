import type { JobMatch, JobTarget } from "./types";
import { uid } from "./nodes";

/** Keep five compact reviews; raw job descriptions and credentials are never stored here. */
export function rememberJob(previous: JobTarget | null, next: JobMatch): JobTarget {
  const { history = [], ...current } = previous ?? { summary: "", missing: [] };
  const recent = previous ? [{ ...current, id: current.id ?? uid("job") }, ...history] : [];
  return { ...next, id: next.id ?? uid("job"), at: next.at ?? Date.now(), history: recent.filter((job, i) => job.id !== next.id && recent.findIndex((other) => other.id === job.id) === i).slice(0, 4) };
}

export function selectJob(current: JobTarget, id: string): JobTarget {
  const next = current.history?.find((job) => job.id === id);
  return next ? rememberJob(current, next) : current;
}
