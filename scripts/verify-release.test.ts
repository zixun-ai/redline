import { afterEach, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function verify(failure = "") {
  const root = mkdtempSync(join(tmpdir(), "redline-release-test-"));
  roots.push(root);
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "bin"));
  mkdirSync(join(root, ".claude/skills/verify-redline/scripts"), { recursive: true });
  copyFileSync(fileURLToPath(new URL("./verify-release.mjs", import.meta.url)), join(root, "scripts/verify-release.mjs"));
  writeFileSync(join(root, "Redline.html"), "previous delivery");
  writeFileSync(join(root, "bin/npm"), `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const action = process.argv.slice(2).join(" ");
const failure = process.env.RELEASE_TEST_FAILURE;
fs.appendFileSync("calls.txt", action + "\\n");
if (action === "run build") {
  fs.mkdirSync("dist");
  fs.writeFileSync("dist/index.html", "fresh build");
}
if (action === "test" && failure === "unit") process.exit(1);
if (action === "run e2e") {
  if (failure === "e2e") process.exit(1);
  const out = failure === "stale-fixtures" ? "e2e/out" : process.env.OUT;
  fs.mkdirSync(out, { recursive: true });
  for (const name of ["1-start.png", "qingjun.pdf", "fenlan.pdf"]) fs.writeFileSync(path.join(out, name), "fixture");
  fs.mkdirSync(process.env.REGRESSION_OUT, { recursive: true });
  const hash = crypto.createHash("sha256").update(fs.readFileSync(process.env.REDLINE_HTML)).digest("hex");
  fs.writeFileSync(path.join(process.env.REGRESSION_OUT, "report.json"), JSON.stringify({ htmlSha256: failure === "wrong-hash" ? "wrong" : hash, cases: [{ status: "passed" }] }));
  const auditOut = failure === "missing-audit-report" ? "e2e/out/audit-regressions" : process.env.AUDIT_OUT;
  fs.mkdirSync(auditOut, { recursive: true });
  fs.writeFileSync(path.join(auditOut, "report.json"), JSON.stringify({
    htmlSha256: failure === "wrong-audit-hash" ? "wrong" : hash,
    cases: failure === "empty-audit-cases" ? [] : [{ status: failure === "failed-audit-case" ? "failed" : "passed" }],
  }));
  for (const [kind, directory, ids] of [
    ["templates", process.env.TEMPLATES_OUT, ["qingjun", "shujuan", "fenlan", "ats", "compact", "classic", "executive", "formal", "ledger", "timeline", "sidebar-right", "sidebar-clean", "columns", "banner", "rail", "editorial", "card", "monogram", "campus", "skills", "portfolio"].map((id) => "template_" + id)],
    ["session", process.env.SESSION_FALLBACK_OUT, ["simultaneous", "rejection", "legacy", "storageDenied"]],
    ["ai", process.env.AI_UPGRADES_OUT, ["connection_boundary", "streaming_audit", "cancel_stream", "manual_retry", "streaming_import", "matched_summary"]],
    ["editor", process.env.EDITOR_OUT, ["manual_without_key", "manual_item_and_section", "placeholder_fill", "manual_stale_guard", "title_subtitle_quote", "quote_fallback", "quote_across_markup_and_paragraphs", "aggregated_pins", "editable_rows", "deleted_row_edit", "job_history"]],
    ["leftpanel", process.env.LEFTPANEL_UPGRADES_OUT, ["sorting", "versions", "photo", "photoLateDecode", "controls"]],
    ["layout", process.env.LAYOUT_UPGRADES_OUT, ["rich_text_exports", "multipage_export", "compression_restores", "dark_chrome_light_paper"]],
    ["pagination", process.env.PAGINATION_OUT, ["single_page", "page_limits", "column_layouts", "oversized_entry", "fit_transaction"]],
  ]) {
    if (failure === "missing-" + kind + "-report") continue;
    fs.mkdirSync(directory, { recursive: true });
    const cases = failure === "empty-" + kind + "-cases" ? [] : ids.map((id) => ({ id, status: failure === "failed-" + kind + "-case" ? "failed" : "passed" }));
    if (failure === "partial-" + kind + "-cases") cases.pop();
    fs.writeFileSync(path.join(directory, kind === "editor" ? "results.json" : "report.json"), JSON.stringify({
      htmlSha256: failure === "wrong-" + kind + "-hash" ? "wrong" : hash,
      cases: kind === "editor" ? cases.map((item) => ({ name: item.id, passed: item.status === "passed" })) : cases,
    }));
  }
}
`, { mode: 0o755 });
  writeFileSync(join(root, ".claude/skills/verify-redline/scripts/core-flow.mjs"), `
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
appendFileSync("calls.txt", "core\\n");
mkdirSync(process.env.VERIFY_OUT, { recursive: true });
const ids = ["review", "review-history", "resolve", "import", "backup", "closing-summary", "pdf"];
if (process.env.RELEASE_TEST_FAILURE === "missing-journey") ids.pop();
const htmlSha256 = createHash("sha256").update(readFileSync(process.env.REDLINE_HTML)).digest("hex");
writeFileSync(join(process.env.VERIFY_OUT, "report.json"), JSON.stringify({ htmlSha256, status: "passed", journeys: ids.map((id) => ({ id, status: "passed" })) }));
if (process.env.RELEASE_TEST_FAILURE === "changed-build") writeFileSync(process.env.REDLINE_HTML, "unverified build");
`);
  const result = spawnSync(process.execPath, [join(root, "scripts/verify-release.mjs")], {
    cwd: root, encoding: "utf8",
    env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}`, RELEASE_TEST_FAILURE: failure,
      OUT: join(root, "old-fixtures"), REGRESSION_OUT: join(root, "old-report"), AUDIT_OUT: join(root, "old-audit"),
      TEMPLATES_OUT: join(root, "old-templates"), SESSION_FALLBACK_OUT: join(root, "old-session"),
      AI_UPGRADES_OUT: join(root, "old-ai"), EDITOR_OUT: join(root, "old-editor"),
      LEFTPANEL_UPGRADES_OUT: join(root, "old-leftpanel"), LAYOUT_UPGRADES_OUT: join(root, "old-layout"),
      PAGINATION_OUT: join(root, "old-pagination"),
      VERIFY_OUT: join(root, "old-core"), REDLINE_HTML: join(root, "Redline.html") },
  });
  return { root, result };
}

it("builds once, verifies that artifact, and only then replaces the delivery", () => {
  const { root, result } = verify();
  expect(result.status, result.stderr).toBe(0);
  expect(readFileSync(join(root, "calls.txt"), "utf8")).toBe("run build\ntest\nrun e2e\ncore\n");
  expect(readFileSync(join(root, "Redline.html"), "utf8")).toBe("fresh build");
  const run = readdirSync(join(root, "e2e/out/release"))[0];
  const report = JSON.parse(readFileSync(join(root, "e2e/out/release", run, "release.json"), "utf8"));
  expect(report).toMatchObject({ status: "passed", checks: ["build", "unit", "e2e", "core"] });
  expect(report.htmlSha256).toHaveLength(64);
});

it.each([
  "unit", "e2e", "stale-fixtures", "wrong-hash", "missing-audit-report", "wrong-audit-hash", "empty-audit-cases", "failed-audit-case", "missing-journey", "changed-build",
  ...["templates", "session", "ai", "editor", "leftpanel", "layout", "pagination"].flatMap((kind) => [`missing-${kind}-report`, `wrong-${kind}-hash`, `empty-${kind}-cases`, `failed-${kind}-case`, `partial-${kind}-cases`]),
])("preserves the previous delivery when verification fails: %s", (failure) => {
  const { root, result } = verify(failure);
  expect(result.status).toBe(1);
  expect(readFileSync(join(root, "Redline.html"), "utf8")).toBe("previous delivery");
  expect(readdirSync(root).filter((name) => name.includes(".release-"))).toEqual([]);
});
