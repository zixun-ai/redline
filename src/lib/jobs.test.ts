import { expect, it } from "vitest";
import { rememberJob, selectJob } from "./jobs";
import { isDoc, isJob, isVersions } from "./storage";
import { sampleDoc } from "./sample";
import { normalizeDoc } from "./design";
import type { JobTarget } from "./types";

it("keeps five reviews and switches their summaries without losing the other recent reviews", () => {
  let job: JobTarget | null = null;
  for (let i = 0; i < 7; i++) job = rememberJob(job, { id: `job${i}`, summary: `岗位${i}`, matched: ["工具"], missing: ["经历"] });
  expect([job!.id, ...job!.history!.map((j) => j.id)]).toEqual(["job6", "job5", "job4", "job3", "job2"]);
  job = selectJob(job!, "job4");
  expect([job.id, ...job.history!.map((j) => j.id)]).toEqual(["job4", "job6", "job5", "job3", "job2"]);
  expect(isJob(job)).toBe(true);
  expect(isJob({ ...job, history: [...job.history!, job] })).toBe(false);
  expect(isJob({ summary: "", missing: [], matched: [null] })).toBe(false);
});

it("migrates old design defaults and validates new layout and version metadata", () => {
  const doc = sampleDoc();
  const old = { ...doc, design: { template: "qingjun", accent: "#222222", density: "normal", fontScale: 1 } };
  expect(isDoc(old)).toBe(true);
  expect(normalizeDoc(old as typeof doc).design).toMatchObject({ pageLimit: 1, language: "zh", photoShape: "square" });
  expect(isDoc({ ...doc, design: { ...doc.design, pageLimit: 3 } })).toBe(false);
  expect(isDoc({ ...doc, resume: { ...doc.resume, sectionPlacement: { x: "side" } } })).toBe(true);
  expect(isDoc({ ...doc, resume: { ...doc.resume, sectionPlacement: { x: "hidden" } } })).toBe(false);
  const version = { id: "v", name: "岗位版", at: 1, doc, job: { id: "job", summary: "说明", missing: [] } };
  expect(isVersions([version])).toBe(true);
  expect(isVersions([{ ...version, job: { summary: 7 } }])).toBe(false);
});
