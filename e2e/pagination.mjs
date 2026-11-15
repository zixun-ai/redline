// Compare the browser's measuring fragments with real PDFs. Synthetic text and isolated storage only.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { stored } from "./storage.mjs";

const html = resolve(process.env.REDLINE_HTML ?? "dist/index.html");
const out = resolve(process.env.PAGINATION_OUT ?? "e2e/out/pagination");
mkdirSync(out, { recursive: true });
const report = { html, htmlSha256: createHash("sha256").update(readFileSync(html)).digest("hex"), cases: [] };
const browser = await chromium.launch({ channel: "chrome", headless: true });
const button = (page, name) => page.getByRole("button", { name, exact: true });
const tab = (page, name) => page.getByRole("tab", { name, exact: true });
const templates = ["qingjun", "shujuan", "fenlan", "ats", "classic", "executive", "formal", "ledger", "timeline", "sidebar-right", "sidebar-clean", "columns", "banner", "rail", "editorial", "card", "monogram", "campus", "skills", "portfolio", "compact"];
let sequence = 0;

async function restore(page, doc) {
  doc.resume.basics.name = `分页验证 ${++sequence}`;
  await tab(page, "版本").click();
  await page.locator('input[type="file"][accept=".json"]').setInputFiles({ name: "pagination-fixture.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ app: "redline", doc, threads: [], versions: [], job: null })) });
  await page.waitForFunction((name) => document.querySelector(".page-live h1")?.textContent === name, doc.resume.basics.name);
  assert.deepEqual(await stored(page, "doc"), doc);
}

function longDoc(original, count, lines, template = "qingjun") {
  const doc = structuredClone(original);
  doc.design = { ...doc.design, template, pageLimit: 2 };
  doc.resume.summary.text = "";
  doc.resume.sections = [{ id: "pagination_section", kind: "experience", title: "分页验证经历", items: entries("A", count, lines) }];
  return doc;
}
function entries(prefix, count, lines) {
  return Array.from({ length: count }, (_, i) => ({ id: `${prefix}_item_${i}`, title: `经历 ${prefix}${i}`, subtitle: "岗位", period: "2020—2026", bullets: [{ id: `${prefix}_bullet_${i}`,
    text: Array.from({ length: lines }, (_, j) => `MARK${prefix}${i}_${String(j).padStart(2, "0")} 分页内容核对`).join("\n") }] }));
}
const markers = (doc) => JSON.stringify(doc.resume).match(/MARK[A-Z]\d+_\d+/g) ?? [];
const fragments = (page) => page.locator(".pagination-columns > .resume").evaluate((el) => [...el.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0).map((rect) => ({ width: rect.width, height: rect.height })));

async function checkPdf(page, id, doc) {
  const measured = (await fragments(page)).length;
  const file = `${out}/${id}.pdf`;
  const pdf = await page.pdf({ path: file, preferCSSPageSize: true, printBackground: true });
  const info = execFileSync("pdfinfo", ["-"], { input: pdf }).toString();
  const pages = Number(info.match(/Pages:\s+(\d+)/)[1]);
  const text = execFileSync("pdftotext", ["-layout", "-", "-"], { input: pdf }).toString();
  writeFileSync(`${out}/${id}.txt`, text);
  assert.equal(measured, pages, `${id}: measured fragments must match actual printed pages`);
  const pageTexts = text.split("\f");
  if (!pageTexts.at(-1).trim()) pageTexts.pop();
  assert.equal(pageTexts.length, pages);
  assert.ok(pageTexts.every((part) => part.trim()), `${id}: no empty printed pages`);
  for (const marker of markers(doc)) assert.equal((text.match(new RegExp(`\\b${marker}\\b`, "g")) ?? []).length, 1, `${id}: ${marker} must print once, without leaking the measuring copy`);
  assert.equal((await fragments(page)).length, measured, `${id}: printing must preserve the screen measurement`);
  if (doc.design.pageLimit === 0 || pages <= doc.design.pageLimit) {
    const status = await page.locator(".topbar .fit").innerText();
    assert.match(status, pages === 1 ? /刚好一页/ : new RegExp(`${pages}\\s*页`), `${id}: the page count shown to the user must match the PDF`);
  }
  return { id, measured, pages };
}
async function exportAllowed(page) {
  await page.evaluate(() => { window.printRequested = false; window.print = () => { window.printRequested = true; }; });
  await button(page, "导出 PDF").click();
  const allowed = await page.evaluate(() => window.printRequested);
  if (!allowed) {
    await page.getByRole("dialog").waitFor();
    assert.match(await page.getByRole("dialog").innerText(), /内容超出/);
    await page.keyboard.press("Escape");
  }
  return allowed;
}

const cases = {
  async single_page(page, original) {
    const results = [];
    for (const template of templates) {
      const doc = structuredClone(original);
      doc.design = { ...doc.design, template, pageLimit: 1 };
      await restore(page, doc);
      const result = await checkPdf(page, `single-${template}`, doc);
      assert.equal(result.pages, 1, `${template}: a normal one-page resume must not gain a blank page`);
      results.push(result);
    }
    const minimal = structuredClone(original);
    minimal.resume.sections = []; minimal.resume.summary.text = "";
    minimal.design.pageLimit = 2;
    await restore(page, minimal);
    assert.equal((await checkPdf(page, "minimal-multipage", minimal)).pages, 1);
    return results;
  },
  async page_limits(page, original) {
    const doc = longDoc(original, 6, 15);
    await restore(page, doc);
    const continuous = await page.locator(".print-page .resume").evaluate((el) => el.scrollHeight);
    assert.ok(continuous < 2 * 1122.5, "fixture must expose the old continuous-height undercount");
    const result = await checkPdf(page, "two-page-limit", doc);
    assert.equal(result.pages, 3);
    assert.equal(await exportAllowed(page), false, "a two-page limit must reject an actual three-page PDF");
    doc.design.pageLimit = 0;
    await restore(page, doc);
    assert.equal((await checkPdf(page, "unlimited", doc)).pages, 3);
    assert.equal(await exportAllowed(page), true, "unlimited resumes may export all their pages");
    return [result];
  },
  async column_layouts(page, original) {
    const results = [];
    for (const template of ["fenlan", "sidebar-right", "sidebar-clean", "columns", "ledger"]) {
      const doc = longDoc(original, 6, 15, template);
      doc.resume.sections.push({ id: "pagination_side", kind: "project", title: "另一列经历", items: entries("B", 4, 12) });
      doc.resume.sectionPlacement = { pagination_side: "side" };
      doc.design.pageLimit = 0;
      await restore(page, doc);
      const result = await checkPdf(page, `columns-${template}`, doc);
      assert.ok(result.pages > 1);
      results.push(result);
    }
    return results;
  },
  async oversized_entry(page, original) {
    const results = [];
    for (const template of ["qingjun", "fenlan", "columns"]) {
      const doc = longDoc(original, 1, 90, template);
      doc.resume.sections[0].items.push(...entries("C", 1, 3));
      doc.design.pageLimit = 0;
      await restore(page, doc);
      const result = await checkPdf(page, `oversized-${template}`, doc);
      assert.ok(result.pages >= 2, "an entry taller than a page must continue without losing its tail");
      results.push(result);
    }
    return results;
  },
  async fit_transaction(page, original) {
    const doc = longDoc(original, 6, 6);
    doc.design = { ...doc.design, density: "relaxed", margin: "wide", fontScale: 1.1 };
    await restore(page, doc);
    assert.ok((await fragments(page)).length > 1);
    await button(page, "压缩到一页").click();
    await page.getByText("刚好一页", { exact: true }).waitFor();
    const fitted = await stored(page, "doc");
    assert.equal((await checkPdf(page, "fit-success", fitted)).pages, 1);
    assert.deepEqual(fitted.resume, doc.resume);
    await page.locator(".topbar").getByRole("button", { name: "撤销", exact: true }).click();
    assert.deepEqual(await stored(page, "doc"), doc, "a successful compression is one undo step");

    const oversized = longDoc(original, 1, 110);
    oversized.design = { ...oversized.design, density: "relaxed", margin: "wide", fontScale: 1.1 };
    await restore(page, oversized);
    const before = (await fragments(page)).length;
    await button(page, "压缩到一页").click();
    await page.locator(".toast").filter({ hasText: "无法压到一页，已恢复原版式" }).waitFor();
    assert.deepEqual(await stored(page, "doc"), oversized, "failed compression restores every design setting and the complete resume");
    assert.equal((await fragments(page)).length, before);
    return [await checkPdf(page, "fit-failure-restored", oversized)];
  },
};

try {
  const selected = process.argv.slice(2);
  for (const [id, run] of Object.entries(cases)) {
    if (selected.length && !selected.includes(id)) continue;
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
    context.setDefaultTimeout(15000);
    await context.route(/^https?:/, (route) => route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(pathToFileURL(html).href); await page.locator(".app").waitFor();
      const observations = await run(page, await stored(page, "doc"));
      assert.deepEqual(errors, []);
      report.cases.push({ id, status: "passed", observations }); console.log(`PASS ${id}`);
    } catch (error) {
      report.cases.push({ id, status: "failed", error: error.message }); console.error(`FAIL ${id}: ${error.stack}`); process.exitCode = 1;
    } finally { await context.close(); }
  }
  assert.ok(report.cases.length, "choose at least one known case");
} finally {
  await browser.close(); writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
}
