import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const html = join(root, "dist/index.html");
const delivery = join(root, "Redline.html");
const temporary = `${delivery}.release-${process.pid}.tmp`;
const releaseRoot = join(root, "e2e/out/release");
mkdirSync(releaseRoot, { recursive: true });
const evidence = mkdtempSync(join(releaseRoot, "run-"));
const out = join(evidence, "e2e");
const env = {
  ...process.env,
  REDLINE_HTML: html,
  OUT: out,
  REGRESSION_OUT: join(evidence, "regressions"),
  AUDIT_OUT: join(evidence, "audit-regressions"),
  SESSION_FALLBACK_OUT: join(evidence, "session-fallback"),
  TEMPLATES_OUT: join(evidence, "templates"),
  AI_UPGRADES_OUT: join(evidence, "ai-upgrades"),
  EDITOR_OUT: join(evidence, "editor-upgrades"),
  LEFTPANEL_UPGRADES_OUT: join(evidence, "leftpanel-upgrades"),
  LAYOUT_UPGRADES_OUT: join(evidence, "layout-upgrades"),
  PAGINATION_OUT: join(evidence, "pagination"),
  VERIFY_OUT: join(evidence, "core"),
};
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const run = (command, args) => execFileSync(command, args, { cwd: root, env, stdio: "inherit" });
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

try {
  run(npm, ["run", "build"]);
  const htmlSha256 = hash(html);
  run(npm, ["test"]);
  // run.mjs creates the PDF/image fixtures before features.mjs reads them. A fresh
  // shared OUT prevents an older run's fixtures from hiding a missing producer.
  run(npm, ["run", "e2e"]);
  for (const name of ["1-start.png", "qingjun.pdf", "fenlan.pdf"]) {
    assert.ok(existsSync(join(out, name)), `本次测试未生成 ${name}，不能发布。`);
  }
  const templateIds = ["qingjun", "shujuan", "fenlan", "ats", "compact", "classic", "executive", "formal", "ledger", "timeline", "sidebar-right", "sidebar-clean", "columns", "banner", "rail", "editorial", "card", "monogram", "campus", "skills", "portfolio"];
  for (const [label, directory, expected] of [
    ["回归", env.REGRESSION_OUT, []],
    ["审查回归", env.AUDIT_OUT, []],
    ["临时会话", env.SESSION_FALLBACK_OUT, ["simultaneous", "rejection", "legacy", "storageDenied"]],
    ["模板", env.TEMPLATES_OUT, templateIds.map((id) => `template_${id}`)],
    ["AI 升级", env.AI_UPGRADES_OUT, ["connection_boundary", "streaming_audit", "cancel_stream", "manual_retry", "streaming_import", "matched_summary"]],
    ["画布编辑", env.EDITOR_OUT, ["manual_without_key", "manual_item_and_section", "placeholder_fill", "manual_stale_guard", "title_subtitle_quote", "quote_fallback", "quote_across_markup_and_paragraphs", "aggregated_pins", "editable_rows", "deleted_row_edit", "job_history"]],
    ["左栏升级", env.LEFTPANEL_UPGRADES_OUT, ["sorting", "versions", "photo", "photoLateDecode", "controls"]],
    ["排版导出", env.LAYOUT_UPGRADES_OUT, ["rich_text_exports", "multipage_export", "compression_restores", "dark_chrome_light_paper"]],
    ["分页", env.PAGINATION_OUT, ["single_page", "page_limits", "column_layouts", "oversized_entry", "fit_transaction"]],
  ]) {
    const report = JSON.parse(readFileSync(join(directory, directory === env.EDITOR_OUT ? "results.json" : "report.json"), "utf8"));
    assert.equal(report.htmlSha256, htmlSha256, `${label}测试使用了其他构建。`);
    assert.ok(Array.isArray(report.cases) && report.cases.length, `${label}测试没有执行案例。`);
    const cases = directory === env.EDITOR_OUT
      ? report.cases.map((item) => ({ id: item.name, status: item.passed === true ? "passed" : "failed" }))
      : report.cases;
    assert.ok(cases.every((item) => item.status === "passed"), `${label}测试未全部通过。`);
    for (const id of expected) assert.ok(cases.some((item) => item.id === id), `${label}测试缺少案例 ${id}。`);
  }

  run(process.execPath, [join(root, ".claude/skills/verify-redline/scripts/core-flow.mjs")]);
  const core = JSON.parse(readFileSync(join(env.VERIFY_OUT, "report.json"), "utf8"));
  assert.equal(core.htmlSha256, htmlSha256, "核心流程使用了其他构建。");
  assert.equal(core.status, "passed", "核心流程未全部通过。");
  const expected = ["review", "review-history", "resolve", "import", "backup", "closing-summary", "pdf"];
  for (const id of expected) assert.ok(core.journeys.some((item) => item.id === id && item.status === "passed"), `核心流程 ${id} 未通过。`);
  assert.equal(hash(html), htmlSha256, "验证期间构建被修改，请重新运行发布验证。");

  copyFileSync(html, temporary);
  assert.equal(hash(temporary), htmlSha256, "交付文件复制校验失败。");
  renameSync(temporary, delivery);
  assert.equal(hash(delivery), htmlSha256, "交付文件与已验证构建不一致。");
  writeFileSync(join(evidence, "release.json"), JSON.stringify({
    status: "passed", html: relative(root, html), delivery: relative(root, delivery), htmlSha256,
    checks: ["build", "unit", "e2e", "core"],
  }, null, 2));
  console.log(`\n发布验证通过：Redline.html\nSHA-256：${htmlSha256}\n证据：${relative(root, evidence)}`);
} catch (error) {
  console.error(`\n发布验证失败：${error.message}\n证据：${relative(root, evidence)}`);
  process.exitCode = 1;
} finally {
  rmSync(temporary, { force: true });
}
