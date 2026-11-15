// Template-only acceptance: isolated browser storage, synthetic content, no network.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { stored, seed, reload } from "./storage.mjs";

const html = resolve(process.env.REDLINE_HTML ?? "dist/index.html");
const out = resolve(process.env.TEMPLATES_OUT ?? "e2e/out/templates");
mkdirSync(out, { recursive: true });
const templates = [
  ["qingjun", "简洁"], ["shujuan", "正式"], ["fenlan", "双栏"], ["ats", "简洁"], ["compact", "简洁"],
  ["classic", "正式"], ["executive", "正式"], ["formal", "正式"], ["ledger", "正式"], ["timeline", "正式"],
  ["sidebar-right", "双栏"], ["sidebar-clean", "双栏"], ["columns", "双栏"], ["banner", "创意"],
  ["rail", "创意"], ["editorial", "创意"], ["card", "创意"], ["monogram", "创意"],
  ["campus", "侧重点"], ["skills", "侧重点"], ["portfolio", "侧重点"],
];
const byName = (root, role, name) => root.getByRole(role, { name, exact: true });
const tab = (page, name) => byName(page, "tab", name);
const button = (page, name) => byName(page, "button", name);
const doc = (page) => stored(page, "doc");
const ids = (resume) => ["basics", ...(resume.summary.text ? [resume.summary.id] : []), ...resume.sections.flatMap((section) => [
  section.id, ...(section.kind === "text" ? (section.body.text ? [section.body.id] : []) : section.items.flatMap((item) => [
    item.id, ...(section.kind !== "skill" || item.title ? [`${item.id}__title`] : []), ...(section.kind !== "skill" && item.subtitle ? [`${item.id}__subtitle`] : []), ...item.bullets.map((bullet) => bullet.id),
  ])),
])];
const fragments = (resume) => [...Object.values(resume.basics), resume.summary.text, ...resume.sections.flatMap((section) => [
  section.title, ...(section.kind === "text" ? [section.body.text] : section.items.flatMap((item) => [
    item.title, item.subtitle, item.period, ...item.bullets.map((bullet) => bullet.text),
  ])),
])].filter(Boolean);
const radicals = { "⻘": "青", "⻓": "长", "⻔": "门", "⻛": "风", "⻜": "飞", "⻢": "马", "⻋": "车", "⻅": "见", "⻉": "贝", "⻚": "页", "⻥": "鱼", "⻬": "齐", "⻩": "黄", "⻄": "西", "⻝": "食", "⻮": "齿", "⻰": "龙" };
const compact = (text) => text.normalize("NFKC").replace(/[\u2E80-\u2EFF]/g, (char) => radicals[char] ?? char).replace(/\s+/g, "");

async function select(page, id) {
  await tab(page, "版式").click();
  await byName(page, "textbox", "搜索模板").fill("");
  await button(byName(page, "group", "模板分类"), "全部").click();
  await page.locator(`[data-template="${id}"]`).click();
  await page.waitForFunction((value) => document.querySelector(".page-live .resume")?.classList.contains(`t-${value}`), id);
  assert.equal(await page.locator(`[data-template="${id}"]`).getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator('[data-template][aria-pressed="true"]').count(), 1);
}

async function checkNodes(page, resume) {
  for (const selector of [".page-live", ".print-page"]) {
    const rendered = await page.locator(`${selector} [data-node]`).evaluateAll((nodes) => nodes.map((node) => node.dataset.node));
    assert.equal(new Set(rendered).size, rendered.length, `${selector}: node IDs must not repeat`);
    assert.deepEqual(rendered.sort(), ids(resume).sort(), `${selector}: every existing component must remain`);
  }
}

async function checkPaper(page, onePage) {
  const measure = await page.locator(".page-live .resume").evaluate((paper) => {
    const bounds = paper.getBoundingClientRect();
    const outside = [];
    const walker = document.createTreeWalker(paper, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(walker.currentNode);
      for (const rect of range.getClientRects()) {
        if (rect.width && (rect.left < bounds.left - 1.5 || rect.right > bounds.right + 1.5)) {
          outside.push(walker.currentNode.textContent.slice(0, 70));
        }
      }
    }
    return { height: paper.offsetHeight, width: paper.clientWidth, scrollWidth: paper.scrollWidth, outside };
  });
  assert.deepEqual(measure.outside, [], "text must stay inside the paper horizontally");
  assert.ok(measure.scrollWidth <= measure.width + 1, `paper has horizontal overflow: ${JSON.stringify(measure)}`);
  if (onePage) assert.ok(measure.height <= Math.ceil(297 / 25.4 * 96) + 1, `default sample exceeds A4: ${measure.height}px`);
  return measure;
}

async function pdf(page, name, resume, onePage = true, photo = false) {
  const file = `${out}/${name}.pdf`;
  try {
    await page.emulateMedia({ media: "print" });
    writeFileSync(file, await page.pdf({ preferCSSPageSize: true, printBackground: true }));
  } finally { await page.emulateMedia({ media: "screen" }); }
  const info = execFileSync("pdfinfo", [file], { encoding: "utf8" });
  const pages = Number(info.match(/Pages:\s+(\d+)/)?.[1]);
  assert.ok(pages > 0, "PDF must contain pages");
  if (onePage) assert.equal(pages, 1, "default sample PDF must fit one A4 page");
  const text = execFileSync("pdftotext", [file, "-"], { encoding: "utf8" });
  writeFileSync(`${out}/${name}.txt`, text);
  // Poppler's reading-order heuristics may interleave headings or remove a
  // line-final URL hyphen. Raw extraction checks the actual complete text runs;
  // keep both outputs so readability and extraction order remain reviewable.
  const raw = execFileSync("pdftotext", ["-raw", file, "-"], { encoding: "utf8" });
  writeFileSync(`${out}/${name}-raw.txt`, raw);
  const normalized = compact(raw);
  for (const fragment of fragments(resume)) assert.ok(normalized.includes(compact(fragment)), `PDF lost text: ${fragment.slice(0, 90)}`);
  assert.ok(!/导出 PDF|搜索模板|模板分类/.test(text), "PDF must exclude editor controls");
  if (photo) assert.match(execFileSync("pdfimages", ["-list", file], { encoding: "utf8" }), /^\s*\d+\s+\d+\s+image\s/m, "PDF must contain the photo");
  return pages;
}

async function shot(page, name) {
  await page.locator(".page-live").screenshot({ path: `${out}/${name}.png`, animations: "disabled" });
}

async function verifySelected(page, id, resume) {
  const saved = await doc(page);
  assert.equal(saved.design.template, id, "chosen template must be saved");
  assert.deepEqual(saved.resume, resume, "template changes must preserve stored content and IDs");
  await checkNodes(page, resume);
  const priority = { campus: "education", skills: "skill", portfolio: "project" }[id];
  if (priority) assert.equal(await page.locator(".page-live .sec").first().getAttribute("data-kind"), priority, "focus template must change display order");
}

async function complexDoc(page) {
  const value = structuredClone(await doc(page));
  value.resume.basics.name = "复杂排版测试员林知远";
  value.resume.basics.website = `https://example.invalid/projects/${"LongPortfolioPath".repeat(12)}/URL-END-98765`;
  value.resume.summary.text = `${"复杂中文用于检验换行与完整保留。".repeat(7)}中文末尾校验。`;
  value.resume.sections[0].items[0].title = "跨区域企业协作与数据平台产品研发中心";
  value.resume.sections[0].items[0].bullets[0].text = `${"ContinuousEnglishIdentifier".repeat(7)}EnglishTail98765`;
  value.resume.sections.push(
    { id: "fixture-empty-list", kind: "project", title: "空项目模块", items: [] },
    { id: "fixture-empty-text", kind: "text", title: "空段落模块", body: { id: "fixture-empty-body", text: "" } },
    { id: "fixture-closing", kind: "text", title: "附加说明", body: { id: "fixture-ending", text: "复杂模板尾部校验。\nFinalContentTail98765" } },
  );
  value.resume.photo = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 100; canvas.height = 140;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#d8e4ec"; ctx.fillRect(0, 0, 100, 140);
    ctx.fillStyle = "#6b879c"; ctx.beginPath(); ctx.arc(50, 43, 24, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(18, 78, 64, 62);
    return canvas.toDataURL("image/jpeg", 0.85);
  });
  return value;
}

const cases = {
  async catalog_filters(page) {
    await tab(page, "版式").click();
    assert.deepEqual((await page.locator("[data-template]").evaluateAll((nodes) => nodes.map((node) => node.dataset.template))).sort(), templates.map(([id]) => id).sort());
    const group = byName(page, "group", "模板分类");
    for (const category of new Set(templates.map(([, category]) => category))) {
      await button(group, category).click();
      assert.equal(await button(group, category).getAttribute("aria-pressed"), "true");
      assert.deepEqual((await page.locator("[data-template]").evaluateAll((nodes) => nodes.map((node) => node.dataset.template))).sort(), templates.filter(([, name]) => name === category).map(([id]) => id).sort());
    }
    await button(group, "全部").click();
    await byName(page, "textbox", "搜索模板").fill("sidebar");
    assert.deepEqual((await page.locator("[data-template]").evaluateAll((nodes) => nodes.map((node) => node.dataset.template))).sort(), ["sidebar-clean", "sidebar-right"]);
    await byName(page, "textbox", "搜索模板").fill("不存在的模板98765");
    assert.equal(await page.locator("[data-template]").count(), 0);
    assert.equal(await page.getByText("没有匹配的模板，请换个关键词或分类。", { exact: true }).count(), 1);
    await byName(page, "textbox", "搜索模板").fill("教育");
    assert.deepEqual((await page.locator("[data-template]").evaluateAll((nodes) => nodes.map((node) => node.dataset.template))).sort(), ["campus", "fenlan", "sidebar-right"]);
    return "21 款目录、分类、用途/ID 搜索和无结果状态";
  },
};

for (const [id] of templates) cases[`template_${id}`] = async (page) => {
  const original = (await doc(page)).resume;
  await select(page, id);
  await verifySelected(page, id, original);
  await checkPaper(page, true);
  await shot(page, `template-${id}`);
  await pdf(page, `template-${id}`, original);
  return `${id}: 内容和节点保留、选择持久化、默认样例一页 PDF、中文和尾部完整`;
};

for (const id of ["ledger", "sidebar-right", "columns", "banner"]) cases[`complex_${id}`] = async (page) => {
  const fixture = await complexDoc(page);
  await seed(page, { doc: fixture });
  await reload(page);
  await select(page, id);
  await page.waitForFunction(() => document.querySelector(".page-live .photo")?.naturalWidth > 0);
  await verifySelected(page, id, fixture.resume);
  await checkPaper(page, false);
  await shot(page, `complex-${id}`);
  const pages = await pdf(page, `complex-${id}`, fixture.resume, false, true);
  return `${id}: 长中英文、无断词长网址、照片和空模块完整，PDF ${pages} 页`;
};

for (const [id, heading, label, scale] of [["shujuan", "block", "色块", 1.1], ["ledger", "bar", "竖条", .9], ["banner", "plain", "纯文字", 1.1], ["sidebar-right", "block", "色块", .9]]) cases[`overrides_${id}`] = async (page) => {
  const original = (await doc(page)).resume;
  await select(page, id);
  await byName(page, "radio", label).click();
  await button(page, `${Math.round(scale * 100)}%`).click();
  const saved = await doc(page);
  assert.equal(saved.design.heading, heading);
  assert.equal(saved.design.fontScale, scale);
  await verifySelected(page, id, original);
  const style = await page.locator(".page-live .resume").evaluate((paper) => {
    const heading = getComputedStyle(paper.querySelector("h2"));
    return { fontSize: parseFloat(getComputedStyle(paper).fontSize), color: heading.backgroundColor, borderLeft: parseFloat(heading.borderLeftWidth), borderBottom: parseFloat(heading.borderBottomWidth) };
  });
  assert.ok(Math.abs(style.fontSize - 10 * scale * 96 / 72) < .02, "font size choice must override template defaults");
  if (heading === "block") assert.notEqual(style.color, "rgba(0, 0, 0, 0)");
  if (heading === "bar") assert.ok(style.borderLeft > 0);
  if (heading === "plain") assert.equal(style.borderLeft + style.borderBottom, 0);
  await checkPaper(page, false);
  await pdf(page, `overrides-${id}`, original, false);
  await shot(page, `overrides-${id}`);
  return `${id}: ${label}与 ${Math.round(scale * 100)}% 字号覆盖模板默认，正文与 PDF 完整`;
};

cases.template_history_restore = async (page) => {
  const original = (await doc(page)).resume;
  await select(page, "editorial");
  await reload(page);
  await verifySelected(page, "editorial", original);
  await select(page, "columns");
  await button(page.locator(".tools"), "撤销").click();
  await verifySelected(page, "editorial", original);
  await button(page.locator(".tools"), "重做").click();
  await verifySelected(page, "columns", original);
  await tab(page, "版本").click();
  const downloading = page.waitForEvent("download");
  await button(page, "下载备份").click();
  const backupPath = `${out}/template-backup.json`;
  await (await downloading).saveAs(backupPath);
  const backup = JSON.parse(readFileSync(backupPath, "utf8"));
  assert.equal(backup.doc.design.template, "columns");
  await select(page, "ats");
  await tab(page, "版本").click();
  await page.locator('input[type="file"][accept=".json"]').setInputFiles(backupPath);
  await page.getByText("已从备份恢复", { exact: true }).waitFor();
  await verifySelected(page, "columns", original);
  assert.deepEqual(await doc(page), backup.doc);
  await shot(page, "template-history-restored");
  return "模板选择经刷新、撤销重做和备份恢复保留，正文不变";
};

const selected = process.argv.slice(2);
const unknown = selected.filter((id) => !(id in cases));
if (unknown.length) throw new Error(`Unknown template cases: ${unknown.join(", ")}`);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const report = { html, htmlSha256: createHash("sha256").update(readFileSync(html)).digest("hex"), browser: browser.version(), templateCount: templates.length, cases: [] };
try {
  for (const [id, run] of Object.entries(cases)) {
    if (selected.length && !selected.includes(id)) continue;
    const context = await browser.newContext({ viewport: { width: 1600, height: 1200 }, reducedMotion: "reduce", acceptDownloads: true, serviceWorkers: "block" });
    const errors = [], blocked = [];
    await context.route("**/*", (route) => {
      const url = route.request().url();
      if (/^(file|data|blob):/.test(url)) return route.continue();
      blocked.push(url); return route.abort();
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(pathToFileURL(html).href);
      await byName(page, "textbox", "姓名").waitFor();
      const detail = await run(page);
      assert.deepEqual(errors, [], "page must not emit errors");
      assert.deepEqual(blocked, [], "template editing must not request the network");
      report.cases.push({ id, status: "passed", detail });
      console.log(`PASS ${id} | ${detail}`);
    } catch (error) {
      report.cases.push({ id, status: "failed", error: error.stack, blocked });
      console.error(`FAIL ${id}: ${error.stack}`);
      await page.screenshot({ path: `${out}/${id}-failed.png` }).catch(() => {});
      process.exitCode = 1;
    } finally { await context.close(); }
  }
  assert.ok(report.cases.length, "at least one template case must execute");
} finally {
  await browser.close();
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
}
