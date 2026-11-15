// Isolated browser state and generated images only. No real key, profile, or API traffic.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { stored } from "./storage.mjs";

const html = resolve(process.env.REDLINE_HTML ?? "dist/index.html");
const out = resolve(process.env.LEFTPANEL_UPGRADES_OUT ?? "e2e/out/leftpanel-upgrades");
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const report = { html, htmlSha256: createHash("sha256").update(readFileSync(html)).digest("hex"), cases: [] };
const button = (page, name) => page.getByRole("button", { name, exact: true });
const tab = (page, name) => page.getByRole("tab", { name, exact: true });
const doc = (page) => stored(page, "doc");
const node = (page, id) => page.locator(`.content-upgrades [data-form="${id}"]`);
const undo = (page) => page.locator(".topbar").getByRole("button", { name: "撤销", exact: true }).click();
const order = (list) => list.map((item) => item.id);
async function open(context) {
  const page = await context.newPage();
  await page.goto(pathToFileURL(html).href);
  await page.locator(".app").waitFor();
  return page;
}
async function fixture(page) {
  const data = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1200; canvas.height = 700;
    const ctx = canvas.getContext("2d");
    const gradient = ctx.createLinearGradient(0, 0, 1200, 700);
    gradient.addColorStop(0, "red"); gradient.addColorStop(0.5, "gold"); gradient.addColorStop(1, "blue");
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1200, 700);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  return { name: "synthetic-portrait.png", mimeType: "image/png", buffer: Buffer.from(data, "base64") };
}

const cases = {
  async sorting(context) {
    const page = await open(context);
    const original = await doc(page);
    const [section, second] = original.resume.sections;
    assert.ok(section.items.length >= 2 && section.items[0].bullets.length >= 2, "sample contains sibling reorder fixtures");
    await button(page, "全部收起").click();
    assert.equal(await page.locator(".content-upgrades .entry-body").count(), 0);
    assert.deepEqual(await doc(page), original, "collapse is UI state only");
    await node(page, section.id).locator(".group-head .sort-grip").dragTo(node(page, second.id).locator(".group-head"));
    assert.deepEqual(order((await doc(page)).resume.sections), [second.id, section.id, ...order(original.resume.sections.slice(2))]);
    await undo(page);
    assert.deepEqual((await doc(page)).resume.sections, original.resume.sections);
    await button(page, `展开模块 ${section.title}`).click();
    const [firstItem, secondItem] = section.items;
    await node(page, firstItem.id).locator(".entry-row > .sort-grip").dragTo(node(page, secondItem.id).locator(".entry-row"));
    assert.deepEqual(order((await doc(page)).resume.sections[0].items), [secondItem.id, firstItem.id, ...order(section.items.slice(2))]);
    await undo(page);
    await node(page, firstItem.id).locator(".entry-toggle").click();
    const [firstBullet, secondBullet] = firstItem.bullets;
    await node(page, firstBullet.id).locator(".sort-grip").dragTo(node(page, secondBullet.id).locator("textarea"));
    assert.deepEqual(order((await doc(page)).resume.sections[0].items[0].bullets), [secondBullet.id, firstBullet.id, ...order(firstItem.bullets.slice(2))]);
    assert.equal(await node(page, firstBullet.id).locator("textarea").inputValue(), firstBullet.text);
    await undo(page);
    const last = firstItem.bullets.at(-1);
    await node(page, last.id).getByRole("button", { name: "上移要点", exact: true }).focus();
    await page.keyboard.press("Enter");
    const afterKeyboard = (await doc(page)).resume.sections[0].items[0].bullets;
    assert.equal(afterKeyboard.at(-2).id, last.id);
    assert.equal(await page.evaluate(() => document.activeElement?.closest("[data-form]")?.getAttribute("data-form")), last.id);
    await undo(page);

    const external = await page.evaluateHandle(() => { const data = new DataTransfer(); data.setData("application/x-redline-sort", "external-document"); return data; });
    await node(page, secondBullet.id).dispatchEvent("drop", { dataTransfer: external });
    assert.deepEqual(await doc(page), original, "external payload cannot reorder the document");
    await button(page, "全部展开").click();
    const samePage = await page.evaluateHandle(() => new DataTransfer());
    await node(page, firstBullet.id).locator(".sort-grip").dispatchEvent("dragstart", { dataTransfer: samePage });
    await node(page, secondItem.bullets[0].id).dispatchEvent("drop", { dataTransfer: samePage });
    await node(page, firstBullet.id).locator(".sort-grip").dispatchEvent("dragend", { dataTransfer: samePage });
    assert.deepEqual(await doc(page), original, "bullets cannot cross entry boundaries");
    await node(page, firstBullet.id).locator(".sort-grip").dispatchEvent("dragstart", { dataTransfer: samePage });
    await page.getByRole("textbox", { name: "姓名", exact: true }).fill("拖拽中更改了文档");
    await node(page, secondBullet.id).dispatchEvent("drop", { dataTransfer: samePage });
    await node(page, firstBullet.id).locator(".sort-grip").dispatchEvent("dragend", { dataTransfer: samePage });
    assert.deepEqual((await doc(page)).resume.sections, original.resume.sections, "a stale drag cannot modify a newer document");
    await button(page, "全部收起").click();
    await page.locator(`.page-live [data-node="${firstItem.id}__title"]`).click();
    await page.locator(`.content-upgrades input[data-form="${firstItem.id}__title"]`).waitFor({ state: "visible" });
    await node(page, firstItem.id).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${out}/sorting.png` });
  },
  async versions(context) {
    const page = await open(context);
    const initial = await doc(page);
    await tab(page, "版本").click();
    await page.getByRole("textbox", { name: "版本名称", exact: true }).fill("对比基线");
    await button(page, "保存").click();
    const originalVersion = (await stored(page, "versions"))[0];
    await button(page, "重命名 对比基线").click();
    await page.getByRole("textbox", { name: "新的版本名称", exact: true }).fill("已改名版本");
    await button(page, "确认重命名").click();
    assert.equal((await stored(page, "versions"))[0].name, "已改名版本");
    assert.deepEqual((await stored(page, "versions"))[0].doc, originalVersion.doc, "renaming preserves the saved snapshot");
    assert.equal(await button(page, "重命名 已改名版本").evaluate((el) => el === document.activeElement), true, "renaming keeps a usable keyboard focus target");
    await undo(page);
    assert.equal((await stored(page, "versions"))[0].name, "对比基线");
    await page.locator(".topbar").getByRole("button", { name: "重做", exact: true }).click();
    await tab(page, "内容").click();
    await page.getByRole("textbox", { name: "姓名", exact: true }).fill("当前简历新姓名");
    await tab(page, "版本").click();
    await button(page, "对比 已改名版本").click();
    const dialog = page.getByRole("dialog", { name: "与当前简历对比" });
    await dialog.waitFor();
    assert.ok((await dialog.locator(".version-diff del").allTextContents()).join("").includes(initial.resume.basics.name));
    assert.ok((await dialog.locator(".version-diff ins").allTextContents()).join("").includes("当前简历新姓名"));
    await page.screenshot({ path: `${out}/version-compare.png` });
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "对比 已改名版本");
    assert.equal(await button(page, "对比 已改名版本").evaluate((el) => el === document.activeElement), true, "closing comparison returns focus to its invoker");
  },
  async photo(context) {
    const page = await open(context);
    const image = await fixture(page);
    const input = page.locator('input[type="file"][accept="image/*"]');
    await input.setInputFiles(image);
    const dialog = page.getByRole("dialog", { name: "调整证件照" });
    await button(dialog, "保存照片").waitFor({ state: "visible" });
    assert.equal((await doc(page)).resume.photo, undefined, "preview is isolated from the resume");
    const canvas = dialog.locator("canvas");
    await canvas.waitFor({ state: "visible" });
    const centered = await canvas.evaluate((el) => el.toDataURL());
    await dialog.getByRole("slider", { name: /缩放/ }).press("End");
    const zoomed = await canvas.evaluate((el) => el.toDataURL());
    assert.notEqual(zoomed, centered);
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 35, { steps: 5 });
    await page.mouse.up();
    assert.notEqual(await canvas.evaluate((el) => el.toDataURL()), zoomed, "pointer drag pans the crop");
    await button(dialog, "复位").click();
    assert.equal(await canvas.evaluate((el) => el.toDataURL()), centered);
    await dialog.getByRole("slider", { name: /缩放/ }).press("ArrowRight");
    await button(dialog, "向右移动照片").focus();
    await page.keyboard.press("Enter");
    await page.screenshot({ path: `${out}/photo-crop.png` });
    await button(dialog, "保存照片").click();
    await dialog.waitFor({ state: "hidden" });
    const saved = (await doc(page)).resume.photo;
    assert.match(saved, /^data:image\/jpeg;base64,/);
    assert.deepEqual(await page.evaluate(async (data) => { const image = new Image(); image.src = data; await image.decode(); return [image.naturalWidth, image.naturalHeight]; }, saved), [300, 420]);
    await input.setInputFiles(image);
    await button(page.getByRole("dialog"), "取消").click();
    assert.equal((await doc(page)).resume.photo, saved, "cancel leaves the previous photo unchanged");
    await undo(page);
    assert.equal((await doc(page)).resume.photo, undefined, "saving a crop is one undoable edit");
  },
  async photoLateDecode(context) {
    await context.addInitScript(() => {
      const decode = window.createImageBitmap;
      window.releasePhotos = [];
      window.closedPhotos = 0;
      window.createImageBitmap = async (...args) => {
        const image = await decode(...args);
        const close = image.close.bind(image);
        image.close = () => { window.closedPhotos++; close(); };
        await new Promise((resolve) => window.releasePhotos.push(resolve));
        return image;
      };
    });
    const page = await open(context);
    const original = await doc(page);
    await page.locator('input[type="file"][accept="image/*"]').setInputFiles(await fixture(page));
    await page.waitForFunction(() => window.releasePhotos.length === 1);
    await button(page.getByRole("dialog"), "取消").click();
    await page.evaluate(() => window.releasePhotos[0]());
    await page.waitForFunction(() => window.closedPhotos === 1);
    assert.deepEqual(await doc(page), original, "late decoding closes its bitmap without committing a cancelled photo");
    assert.equal(await page.getByRole("dialog").count(), 0);
  },
  async controls(context) {
    const page = await open(context);
    const initial = await doc(page);
    await tab(page, "版式").click();
    assert.equal(await page.locator("[data-template]").count(), 21);
    await page.getByRole("textbox", { name: "搜索模板" }).fill("分栏");
    assert.equal(await page.locator("[data-template]").count(), 1);
    await page.locator('[data-template="fenlan"]').click();
    for (const name of ["2 页", "English", "圆形", "深色"]) await page.getByRole("radio", { name, exact: true }).click();
    const current = await doc(page);
    assert.equal(current.design.pageLimit, 2);
    assert.equal(current.design.language, "en");
    assert.equal(current.design.photoShape, "circle");
    assert.deepEqual(current.resume, initial.resume, "design controls do not translate or alter content");
    assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
    await tab(page, "内容").click();
    const first = initial.resume.sections[0];
    await node(page, first.id).getByRole("combobox", { name: `${first.title}显示位置` }).selectOption("side");
    assert.equal((await doc(page)).resume.sectionPlacement[first.id], "side");
    assert.deepEqual((await doc(page)).resume.sections, initial.resume.sections);
    await node(page, first.id).getByRole("combobox", { name: `${first.title}显示位置` }).selectOption("");
    assert.equal((await doc(page)).resume.sectionPlacement[first.id], undefined);
    await tab(page, "版本").click();
    for (const label of ["导出 Markdown", "导出纯文本"]) {
      const pending = page.waitForEvent("download");
      await button(page, label).click();
      const download = await pending;
      const text = readFileSync(await download.path(), "utf8");
      assert.ok(text.includes(initial.resume.basics.name));
      assert.match(download.suggestedFilename(), label.endsWith("Markdown") ? /\.md$/ : /\.txt$/);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator(".compact-nav").getByRole("button", { name: "内容", exact: true }).click();
    await tab(page, "版本").click();
    await page.screenshot({ path: `${out}/narrow-versions.png` });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  },
};

try {
  const requested = process.argv.slice(2);
  for (const [id, run] of Object.entries(cases)) {
    if (requested.length && !requested.includes(id)) continue;
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
    context.setDefaultTimeout(12000);
    await context.route(/^https?:/, (route) => route.abort());
    const errors = [];
    context.on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)));
    try { await run(context); assert.deepEqual(errors, []); report.cases.push({ id, status: "passed" }); console.log(`PASS ${id}`); }
    catch (error) { report.cases.push({ id, status: "failed", error: error.message }); console.error(`FAIL ${id}: ${error.stack}`); process.exitCode = 1; }
    finally { await context.close(); }
  }
  assert.ok(report.cases.length, "choose a known case");
} finally {
  await browser.close();
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
}
