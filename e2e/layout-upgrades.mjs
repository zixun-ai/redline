import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { stored } from "./storage.mjs";

const html = resolve(process.env.REDLINE_HTML ?? "dist/index.html");
const out = resolve(process.env.LAYOUT_UPGRADES_OUT ?? "e2e/out/layout-upgrades");
mkdirSync(out, { recursive: true });
const report = { html, htmlSha256: createHash("sha256").update(readFileSync(html)).digest("hex"), cases: [] };
const browser = await chromium.launch({ channel: "chrome", headless: true });
const tab = (page, name) => page.getByRole("tab", { name, exact: true });
const button = (page, name) => page.getByRole("button", { name, exact: true });
const compact = (text) => text.replace(/\s/g, "");

async function checkContrast(control) {
  const ratio = await control.evaluate((el) => {
    const light = (color) => color.match(/[\d.]+/g).slice(0, 3).map(Number).map((c) => c / 255)
      .map((c) => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)
      .reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
    const style = getComputedStyle(el), a = light(style.color), b = light(style.backgroundColor);
    return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  });
  assert.ok(ratio >= 4.5, `filled control text must meet 4.5:1 contrast, got ${ratio.toFixed(2)}`);
}

async function restore(page, doc) {
  await tab(page, "版本").click();
  await page.locator('input[type="file"][accept=".json"]').setInputFiles({ name: "layout-fixture.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ app: "redline", doc })) });
  await page.waitForFunction((id) => document.querySelector(`.page-live .t-${id}`), doc.design.template);
  await page.locator(".save-state").filter({ hasText: "已保存在本机" }).waitFor();
  assert.deepEqual(await stored(page, "doc"), doc);
}

function longDoc(original, count, template = "qingjun") {
  const doc = structuredClone(original);
  const section = doc.resume.sections[0];
  const base = section.items[0];
  section.items = Array.from({ length: count }, (_, i) => ({ ...base, id: `long_item_${i}`, title: `经历${i}`,
    bullets: Array.from({ length: 4 }, (_, j) => ({ id: `long_bullet_${i}_${j}`, text: `ITEM${i}POINT${j} 负责业务流程梳理与产品交付，整理用户反馈，协调团队完成需求评审并跟踪实施结果。` })) }));
  doc.resume.sections = [section];
  doc.design = { ...doc.design, template, pageLimit: 2 };
  return doc;
}

async function pdf(page, id) {
  const path = `${out}/${id}.pdf`;
  await page.pdf({ path, preferCSSPageSize: true, printBackground: true });
  const info = execFileSync("pdfinfo", [path]).toString();
  const text = execFileSync("pdftotext", ["-raw", path, "-"]).toString();
  writeFileSync(`${out}/${id}.txt`, text);
  return { path, pages: Number(info.match(/Pages:\s+(\d+)/)[1]), text: compact(text) };
}

const cases = {
  async rich_text_exports(page) {
    const doc = await stored(page, "doc");
    const bullet = doc.resume.sections[0].items[0].bullets[0];
    const text = "完成**核心建设**，详见 https://example.com/portfolio-END。";
    await page.locator(`[data-form="${bullet.id}"] textarea`).fill(text);
    const rendered = page.locator(`.page-live [data-node="${bullet.id}"]`);
    assert.equal(await rendered.locator(".inline-bold").innerText(), "核心建设");
    assert.equal(await rendered.locator("a").getAttribute("href"), "https://example.com/portfolio-END");
    assert.ok(!(await rendered.innerText()).includes("**"));
    const printed = await pdf(page, "rich-text");
    assert.equal(printed.pages, 1);
    assert.ok(printed.text.includes("核心建设"));
    assert.ok(!printed.text.includes("**"));
    assert.ok(execFileSync("pdfinfo", ["-url", printed.path]).toString().includes("https://example.com/portfolio-END"), "PDF must contain a clickable link annotation");
    await tab(page, "版本").click();
    for (const [label, stars] of [["导出 Markdown", true], ["导出纯文本", false]]) {
      const downloading = page.waitForEvent("download");
      await button(page, label).click();
      const output = readFileSync(await (await downloading).path(), "utf8");
      assert.ok(output.includes(stars ? "**核心建设**" : "核心建设"));
      assert.equal(output.includes("**"), stars);
      assert.ok(!output.includes(bullet.id) && !output.includes("apiKey"));
    }
  },

  async multipage_export(page) {
    const original = await stored(page, "doc");
    for (const template of ["qingjun", "fenlan", "columns", "ledger"]) {
      const doc = longDoc(original, 6, template);
      await restore(page, doc);
      await button(page, "导出 PDF").click();
      assert.equal(await page.getByRole("dialog").count(), 0, `${template}: a two-page document should be exportable`);
      const result = await pdf(page, `two-pages-${template}`);
      const expected = template === "qingjun" ? 1 : 2;
      assert.equal(result.pages, expected, `${template}: no blank page may be added by print styles`);
      for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) assert.ok(result.text.includes(`ITEM${i}POINT${j}`), `${template}: all points survive pagination`);
    }
    const longer = longDoc(original, 24);
    await restore(page, longer);
    await button(page, "导出 PDF").click();
    await page.getByRole("dialog").getByText(/内容超出2页/).waitFor();
    await button(page, "知道了").click();
    await page.getByRole("dialog").waitFor({ state: "detached" });
    await tab(page, "版式").click();
    await page.getByRole("radio", { name: "不限", exact: true }).click();
    await button(page, "导出 PDF").click();
    assert.equal(await page.getByRole("dialog").count(), 0);
    const result = await pdf(page, "unlimited-pages");
    assert.ok(result.pages > 2 && result.text.includes("ITEM23POINT3"));
  },

  async compression_restores(page) {
    const doc = longDoc(await stored(page, "doc"), 18);
    doc.design = { ...doc.design, pageLimit: 1, margin: "wide", density: "relaxed", fontScale: 1.07 };
    await restore(page, doc);
    await button(page, "压缩到一页").click();
    await page.locator(".fit.over").filter({ hasText: "已恢复原版式" }).waitFor();
    const current = await stored(page, "doc");
    assert.deepEqual(current.design, doc.design, "failed compression restores every original setting");
    assert.deepEqual(current.resume, doc.resume, "compression never rewrites content");
  },

  async dark_chrome_light_paper(page) {
    await tab(page, "版式").click();
    await page.getByRole("radio", { name: "深色", exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
    assert.equal(await page.locator(".page-live .resume").evaluate((el) => getComputedStyle(el).backgroundColor), "rgb(255, 255, 255)");
    assert.equal(await page.locator(".topbar").evaluate((el) => getComputedStyle(el).backgroundColor), "rgb(38, 37, 33)");
    await page.screenshot({ path: `${out}/dark-workspace.png`, animations: "disabled" });
    await checkContrast(button(page, "填写 API Key"));
    await button(page, "填写 API Key").click();
    await page.getByLabel("API Key", { exact: true }).fill("sk-contrast-fake-not-real");
    await page.screenshot({ path: `${out}/dark-connection.png`, animations: "disabled" });
    await checkContrast(button(page, "验证并保存"));
    await page.keyboard.press("Escape");
    await page.reload();
    await page.locator(".app").waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
    for (const width of [390, 1024, 1200, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}: viewport must not overflow`);
      const overlaps = await page.locator(".topbar").evaluate((el) => {
        const rects = [...el.querySelectorAll("button, .brand")].filter((b) => b.getBoundingClientRect().width).map((b) => b.getBoundingClientRect());
        return rects.some((a, i) => rects.slice(i + 1).some((b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1));
      });
      assert.equal(overlaps, false, `${width}: toolbar controls must not overlap`);
      await page.screenshot({ path: `${out}/dark-${width}.png`, animations: "disabled" });
    }
  },
};

try {
  const requested = process.argv.slice(2);
  for (const [id, run] of Object.entries(cases).filter(([id]) => !requested.length || requested.includes(id))) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce", colorScheme: "light" });
    await context.route("https://**", (route) => route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => { window.print = () => {}; });
    try {
      await page.goto(pathToFileURL(html).href);
      await page.locator(".app").waitFor();
      await run(page);
      assert.deepEqual(errors, []);
      report.cases.push({ id, status: "passed" });
      console.log(`PASS ${id}`);
    } catch (error) {
      report.cases.push({ id, status: "failed", error: error.message });
      await page.screenshot({ path: `${out}/${id}-failed.png` }).catch(() => {});
      console.error(`FAIL ${id}: ${error.stack}`);
      process.exitCode = 1;
    } finally { await context.close(); }
  }
} finally {
  await browser.close();
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
}
