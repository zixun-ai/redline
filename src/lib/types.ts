export type Bullet = { id: string; text: string };

export type Item = {
  id: string;
  title: string;
  subtitle: string;
  period: string;
  bullets: Bullet[];
};

export type SectionKind = "experience" | "project" | "education" | "skill" | "other" | "text";

/** One run of prose. The summary under the name is one, and so is the body of a text module. */
export type Passage = { id: string; text: string };

export type ListSection = { id: string; kind: Exclude<SectionKind, "text">; title: string; items: Item[] };
/** Prose under a heading, such as a closing self-assessment. Unlike the summary, it can sit anywhere. */
export type TextSection = { id: string; kind: "text"; title: string; body: Passage };
export type Section = ListSection | TextSection;

import type { Basics } from "./basics";
export type { Basics };

export type Resume = {
  basics: Basics;
  summary: Passage;
  sections: Section[];
  /** A small JPEG data URL. Kept out of `basics` so it never reaches the model. */
  photo?: string;
  /** Keyed by node id; a component with no entry follows the template. */
  nodeStyles?: Record<string, NodeStyle>;
  /** An absent entry follows the sidebar template's default grouping. */
  sectionPlacement?: Record<string, "main" | "side">;
};

export type TemplateId = "qingjun" | "shujuan" | "fenlan" | "ats" | "classic" | "executive" | "formal" | "ledger" | "timeline" | "sidebar-right" | "sidebar-clean" | "columns" | "banner" | "rail" | "editorial" | "card" | "monogram" | "campus" | "skills" | "portfolio" | "compact";
export type Density = "compact" | "normal" | "relaxed";
export type FontId = "auto" | "hei" | "song" | "kai" | "fang" | "yuan";
export type LatinFontId = "auto" | "sans" | "serif" | "mono";
export type HeadingStyle = "line" | "block" | "bar" | "plain";
export type MarginSize = "narrow" | "normal" | "wide";

export type Design = {
  template: TemplateId;
  accent: string;
  density: Density;
  fontScale: number;
  font: FontId;
  latin: LatinFontId;
  heading: HeadingStyle;
  margin: MarginSize;
  pageLimit: 1 | 2 | 0;
  language: "zh" | "en";
  photoShape: "square" | "rounded" | "circle";
};

export type Doc = { resume: Resume; design: Design };

export type NodeType = "basics" | "summary" | "section" | "item" | "bullet" | "field";

export type Align = "left" | "center" | "right";
/** Formatting for one component, as opposed to `Design`, which covers the whole resume.
 * An empty color means "back to the template's color". */
export type NodeStyle = { align?: Align; bold?: boolean; italic?: boolean; color?: string };

export type ItemPayload = { title: string; subtitle: string; period: string; bullets: string[] };
export type SectionPayload = { title: string; items: ItemPayload[] };
export type TextPayload = { text: string };
export type Payload = Basics | TextPayload | ItemPayload | SectionPayload;

export type StylePatch = Partial<Design>;

export type Proposal = {
  id: string;
  status: "pending" | "accepted" | "rejected";
  why: string;
  edited?: boolean;
} & (
  | {
      kind: "content";
      targetId: string;
      type: NodeType;
      /** JSON of the node when the AI read it; used to detect a stale proposal. */
      before: string;
      after: Payload;
      /** Claims in `after` that the target component does not support. Instructions are not evidence. */
      unsupported: string[];
    }
  | { kind: "style"; patch: StylePatch; beforeDesign: Design }
  | { kind: "nodeStyle"; targetId: string; patch: NodeStyle; beforeStyle: NodeStyle }
);

export type Message = {
  id: string;
  role: "user" | "ai";
  text: string;
  at: number;
  proposal?: Proposal;
  failed?: boolean;
  /** The words the user selected inside the component. */
  quote?: string;
  /** UTF-16 offsets in the selected component's text; older saves only have `quote`. */
  quoteRange?: { start: number; end: number };
  /** Answers the AI suggests for its question. */
  options?: string[];
  /** Written from a job posting, so it isn't evidence of what the user has done. */
  fromJd?: boolean;
};

export type Version = { id: string; name: string; at: number; doc: Doc; job?: JobTarget | null };

export type JobMatch = { id?: string; summary: string; missing: string[]; matched?: string[]; at?: number };
export type JobTarget = JobMatch & { history?: JobMatch[] };

export type Thread = {
  id: string;
  targetId: string;
  label: string;
  resolved: boolean;
  /** The job-matching run that created this thread; absent on older saves. */
  jobId?: string;
  messages: Message[];
};
