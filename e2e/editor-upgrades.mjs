// Local fixtures only. This suite never contacts DeepSeek or uses a real key.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { reload, seed, stored } from "./storage.mjs";

const htmlPath = resolve(process.env.REDLINE_HTML ?? "dist/index.html");
const out = process.env.EDITOR_OUT ?? "e2e/out/editor-upgrades";
const fakeKey = "sk-editor-upgrades-fake";
mkdirSync(out, { recursive: true });
const button = (root, name) => root.getByRole("button", { name, exact: true });
const doc = (page) => stored(page, "doc");
const firstItem = async (page) => (await doc(page)).resume.sections[0].items[0];
const node = (page, id) => page.locator(`.page-live [data-node="${id}"]`);
const composer = (page) => page.locator(".composer");
const undo = (page) => button(page.locator(".tools"), "撤销").click();
const redo = (page) => button(page.locator(".tools"), "重做").click();

function thread(id, targetId, text, proposal) {
  return { id, targetId, label: text, resolved: false, messages: [
    { id: `${id}-user`, role: "user", text, at: 1 },
    { id: `${id}-ai`, role: "ai", text: "本地建议", at: 2, ...(proposal ? { proposal } : {}) },
  ] };
}

async function selectVisible(target, start, end) {
  await target.evaluate((host, { start, end }) => {
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    const parts = [];
    let at = 0;
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      parts.push({ text, start: at, end: at + text.textContent.length });
      at += text.textContent.length;
    }
    const first = parts.find((part) => start >= part.start && start < part.end);
    const last = [...parts].reverse().find((part) => end > part.start && end <= part.end);
    const range = document.createRange();
    range.setStart(first.text, start - first.start);
    range.setEnd(last.text, end - last.start);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    host.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }, { start, end });
}

const cases = {
  async manual_without_key({ page, requests }) {
    const item = await firstItem(page);
    const original = item.bullets[0];
    await node(page, original.id).dblclick();
    await composer(page).getByRole("textbox", { name: "内容", exact: true }).fill("直接编辑后的文字");
    await page.screenshot({ path: `${out}/manual-editor.png` });
    await button(composer(page), "保存修改").click();
    assert.equal((await firstItem(page)).bullets[0].text, "直接编辑后的文字");
    assert.equal((await firstItem(page)).bullets[0].id, original.id);
    await undo(page);
    assert.equal((await firstItem(page)).bullets[0].text, original.text);
    await redo(page);
    assert.equal((await firstItem(page)).bullets[0].text, "直接编辑后的文字");
    await node(page, original.id).click();
    await button(composer(page), "直接改字").click();
    await composer(page).getByRole("textbox", { name: "内容", exact: true }).fill("取消的草稿");
    await button(composer(page), "取消").click();
    assert.equal((await firstItem(page)).bullets[0].text, "直接编辑后的文字");
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.equal(requests.length, 0);
    return "无 Key 双击与直接改字可用；保存、取消、撤销和重做保留 ID";
  },

  async manual_item_and_section({ page }) {
    const original = await firstItem(page);
    await node(page, original.bullets[0].id).click();
    await composer(page).locator(".crumbs button").last().click();
    await button(composer(page), "直接改字").click();
    await composer(page).getByRole("textbox", { name: "标题", exact: true }).fill("手动标题 | 保留竖线");
    await composer(page).getByRole("textbox", { name: "第 1 条", exact: true }).fill("修改这一条，保留批注身份");
    await button(composer(page), "保存修改").click();
    const changed = await firstItem(page);
    assert.equal(changed.title, "手动标题 | 保留竖线");
    assert.deepEqual(changed.bullets.map((b) => b.id), original.bullets.map((b) => b.id));
    assert.equal(changed.subtitle, original.subtitle);
    await node(page, original.bullets[0].id).click();
    await composer(page).locator(".crumbs button").first().click();
    await button(composer(page), "直接改字").click();
    await composer(page).getByRole("textbox", { name: "模块标题", exact: true }).fill("手动模块名称");
    await button(composer(page), "保存修改").click();
    assert.equal((await doc(page)).resume.sections[0].title, "手动模块名称");
    assert.equal((await firstItem(page)).id, original.id);
    return "条目和模块可在画布表单直接修改，其他字段与子级 ID 保留";
  },

  async placeholder_fill({ page }) {
    const value = await doc(page);
    const bullet = value.resume.sections[0].items[0].bullets[0];
    bullet.text = "参与项目，[待填写：成果]，负责协作";
    await seed(page, { doc: value });
    await reload(page);
    await node(page, bullet.id).locator("[data-placeholder]").click();
    const input = composer(page).getByRole("textbox", { name: "内容", exact: true });
    const selected = await input.evaluate((el) => el.value.slice(el.selectionStart, el.selectionEnd));
    assert.equal(selected, "[待填写：成果]");
    await input.pressSequentially("完成交付");
    await button(composer(page), "保存修改").click();
    assert.equal((await firstItem(page)).bullets[0].text, "参与项目，完成交付，负责协作");
    return "点击待填写标记直接选中对应文字，保存后标记消失";
  },

  async manual_stale_guard({ page }) {
    const item = await firstItem(page);
    const id = item.bullets[0].id;
    await node(page, id).dblclick();
    await composer(page).getByRole("textbox", { name: "内容", exact: true }).fill("旧表单里的未保存文字");
    await page.locator(`[data-form="${id}"] textarea`).fill("左侧表单的新文字");
    await button(composer(page), "保存修改").click();
    await composer(page).getByRole("alert").getByText(/原文已变化/).waitFor();
    assert.equal((await firstItem(page)).bullets[0].text, "左侧表单的新文字");
    return "手动表单保存前检查原文版本，不覆盖同时进行的新编辑";
  },

  async title_subtitle_quote({ page, key, requests }) {
    const value = await doc(page);
    const item = value.resume.sections[0].items[0];
    item.title = "负责**产品项目**与产品项目";
    item.subtitle = "协作**设计**与设计";
    await seed(page, { doc: value });
    await reload(page);
    await key();
    for (const [suffix, raw, visible, quote] of [
      ["title", item.title, "负责产品项目与产品项目", "产品项目"],
      ["subtitle", item.subtitle, "协作设计与设计", "设计"],
    ]) {
      const start = visible.lastIndexOf(quote);
      await selectVisible(node(page, `${item.id}__${suffix}`), start, start + quote.length);
      const input = composer(page).getByRole("textbox", { name: "选中文字的修改要求" });
      await input.fill("只改所选部分");
      assert.equal(await input.evaluate((el) => document.activeElement === el), true);
      assert.equal(await page.evaluate(() => CSS.highlights?.get("redline-quote")?.size ?? 0), 1);
      await input.press("Enter");
      await page.waitForFunction(() => !document.querySelector(".thread[data-state='thinking']"));
      const saved = (await stored(page, "threads")).at(-1).messages[0];
      assert.equal(saved.quote, quote);
      assert.deepEqual(saved.quoteRange, { start: raw.lastIndexOf(quote), end: raw.lastIndexOf(quote) + quote.length });
    }
    assert.equal(requests.length, 2);
    return "标题和副标题的重复文本按 Markdown 原偏移引用，输入时高亮仍在";
  },

  async quote_fallback({ page }) {
    await page.addInitScript(() => { Object.defineProperty(CSS, "highlights", { configurable: true, value: undefined }); });
    await reload(page);
    const item = await firstItem(page);
    await selectVisible(node(page, item.bullets[0].id), 0, 4);
    await composer(page).getByRole("textbox", { name: "选中文字的修改要求" }).fill("继续输入");
    const rectangles = page.locator(".quote-selection");
    assert.ok(await rectangles.count() > 0);
    assert.equal(await rectangles.first().evaluate((el) => getComputedStyle(el).pointerEvents), "none");
    await button(composer(page), "取消选中").click();
    await rectangles.waitFor({ state: "detached" });
    return "无 CSS Highlight API 时以不阻挡操作的覆盖层保留选区";
  },

  async quote_across_markup_and_paragraphs({ page, key }) {
    const value = await doc(page);
    const raw = "先写**重点**再写\n下一段结束";
    value.resume.sections.push({ id: "quote-prose", kind: "text", title: "补充说明", body: { id: "quote-body", text: raw } });
    await seed(page, { doc: value });
    await reload(page);
    await key();
    // Range.toString omits paragraph boundaries; source offsets must restore the raw newline and Markdown.
    const visible = "先写重点再写下一段结束";
    const start = visible.indexOf("重点");
    const end = visible.indexOf("结束");
    await selectVisible(node(page, "quote-body"), start, end);
    const input = composer(page).getByRole("textbox", { name: "选中文字的修改要求" });
    await input.fill("调整所选部分");
    assert.equal(await page.evaluate(() => CSS.highlights.get("redline-quote").size), 1);
    await input.press("Enter");
    const saved = (await stored(page, "threads"))[0].messages[0];
    assert.equal(saved.quote, "重点**再写\n下一段");
    assert.deepEqual(saved.quoteRange, { start: raw.indexOf("重点"), end: raw.indexOf("结束") });
    return "跨粗体和段落的选区恢复原文星号及换行，起止偏移准确";
  },

  async aggregated_pins({ page }) {
    const item = await firstItem(page);
    const list = [1, 2, 3, 4].map((i) => thread(`pin-${i}`, item.bullets[0].id, `第 ${i} 条批注`));
    await seed(page, { threads: list });
    await reload(page);
    const group = button(page, "展开此组件的 4 条批注");
    assert.equal(await page.locator(".pin").count(), 1);
    const pinBox = await group.boundingBox();
    const stage = await page.locator(".stage").boundingBox();
    assert.ok(pinBox.x + pinBox.width <= stage.x + stage.width, "pin stays inside the page's right edge");
    for (let i = 1; i <= 4; i++) {
      await group.click();
      if (i === 1) await page.screenshot({ path: `${out}/grouped-pins.png` });
      await button(page.locator(".pin-list"), `打开第 ${i} 条批注`).click();
      assert.equal(await page.locator(".thread.on").getAttribute("data-thread"), `pin-${i}`);
    }
    return "同组件多批注只显示一个聚合针脚，可逐条打开且不越右边界";
  },

  async editable_rows({ page }) {
    const item = await firstItem(page);
    const before = { title: item.title, subtitle: item.subtitle, period: item.period, bullets: item.bullets.map((b) => b.text) };
    const after = { ...before, bullets: ["梳理需求和方案", "推进团队协作", ...before.bullets.slice(2)] };
    const proposal = { id: "row-proposal", kind: "content", targetId: item.id, type: "item", before: JSON.stringify(before), after, why: "逐处核对", unsupported: [], status: "pending" };
    await seed(page, { threads: [thread("rows", item.id, "逐处修改", proposal)] });
    await reload(page);
    const card = page.locator(".proposal.pending");
    await button(card, "微调第 1 处修改").click();
    await card.getByRole("textbox", { name: "内容", exact: true }).fill("提升 77% 的成果");
    await button(card, "取消微调").click();
    assert.equal(await card.getByText("77%", { exact: true }).count(), 0);
    await button(card, "微调第 1 处修改").click();
    const input = card.getByRole("textbox", { name: "内容", exact: true });
    await input.fill("");
    assert.equal(await button(card, "保存这处微调").isDisabled(), true);
    await input.fill("提升 77% 的成果");
    await button(card, "保存这处微调").click();
    await card.getByRole("checkbox", { name: "接受第 2 处修改" }).uncheck();
    await card.locator(".unsupported").getByText("77%", { exact: true }).waitFor();
    await page.screenshot({ path: `${out}/edited-row-warning.png` });
    await card.hover();
    await page.locator(".page-live").getByText("提升 77% 的成果", { exact: true }).waitFor();
    assert.equal((await firstItem(page)).bullets[0].text, before.bullets[0]);
    await button(card, "我确认属实，接受 1/2 处").click();
    const next = await firstItem(page);
    assert.deepEqual(next.bullets.map((b) => b.text), ["提升 77% 的成果", ...before.bullets.slice(1)]);
    const saved = (await stored(page, "threads"))[0].messages[1].proposal;
    assert.equal(saved.edited, true);
    assert.ok(saved.unsupported.includes("77%"));
    await reload(page);
    assert.equal((await stored(page, "threads"))[0].messages[1].proposal.status, "accepted");
    return "单处微调可取消、预览及部分接受；新事实重新提示，空文本不接受";
  },

  async deleted_row_edit({ page }) {
    const item = await firstItem(page);
    const before = { title: item.title, subtitle: item.subtitle, period: item.period, bullets: item.bullets.map((b) => b.text) };
    const proposal = { id: "deleted-row", kind: "content", targetId: item.id, type: "item", before: JSON.stringify(before), after: { ...before, bullets: [] }, why: "核对删除", unsupported: [], status: "pending" };
    await seed(page, { threads: [thread("deletions", item.id, "核对删除", proposal)] });
    await reload(page);
    const card = page.locator(".proposal.pending");
    const count = before.bullets.length;
    assert.ok(count > 1);
    await button(card, `微调第 ${count} 处修改`).click();
    await card.getByRole("textbox", { name: "内容", exact: true }).fill("保留最后一条的说明");
    await button(card, "保存这处微调").click();
    await card.locator("button[data-primary]").click();
    assert.deepEqual((await firstItem(page)).bullets.map((b) => b.text), ["保留最后一条的说明"]);
    await reload(page);
    assert.equal((await stored(page, "threads")).length, 1);
    return "删除方案中的单行可补写，前面的删除不产生空数组项或损坏存档";
  },

  async job_history({ page }) {
    const job = { id: "current-job", summary: "当前产品岗位", matched: ["已有需求分析经历"], missing: ["待补行业经历"], history: [
      { id: "previous-job", summary: "历史设计岗位", matched: ["已有设计协作经历"], missing: ["待补作品集"], at: 1 },
    ] };
    await seed(page, { job });
    await reload(page);
    await page.locator(".job").getByText("已有需求分析经历", { exact: true }).waitFor();
    await button(page, "切换岗位：历史设计岗位").click();
    assert.equal((await stored(page, "job")).id, "previous-job");
    await page.locator(".job").getByText("已有设计协作经历", { exact: true }).waitFor();
    await page.locator(".job").getByText("待补作品集", { exact: true }).waitFor();
    assert.equal(await page.locator(".job").getByText(/\d+%/).count(), 0);
    await button(page, "切换岗位：当前产品岗位").click();
    assert.equal((await stored(page, "job")).id, "current-job");
    return "岗位历史能往返切换，分别展示已有支持与待补信息";
  },
};

async function open(context) {
  const page = await context.newPage();
  page.setDefaultTimeout(7000);
  const requests = [];
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.protocol === "file:") return route.continue();
    if (url.origin !== "https://api.deepseek.com") return route.abort();
    const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "content-type": "application/json" };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 200, headers });
    assert.equal(request.headers().authorization, `Bearer ${fakeKey}`);
    const body = request.postDataJSON();
    if (body.max_tokens !== 1) requests.push(body);
    return route.fulfill({ status: 200, headers, json: { choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ action: "ask", reply: "本地测试回复", options: [] }) } }] } });
  });
  await page.goto(pathToFileURL(htmlPath).href);
  await page.locator(".app").waitFor();
  return { page, requests, async key() {
    await button(page, "填写 API Key").click();
    await page.getByRole("textbox", { name: "API Key", exact: true }).fill(fakeKey);
    await button(page, "验证并保存").click();
    await button(page, "已连接").waitFor();
  } };
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const selected = process.argv.slice(2);
const report = { html: htmlPath, htmlSha256: createHash("sha256").update(readFileSync(htmlPath)).digest("hex"), browser: browser.version(), cases: [] };
try {
  for (const [name, run] of Object.entries(cases)) {
    if (selected.length && !selected.includes(name)) continue;
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    const errors = [];
    context.on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)));
    let fixture;
    try {
      fixture = await open(context);
      const detail = await run(fixture);
      assert.deepEqual(errors, []);
      report.cases.push({ name, passed: true, detail });
      console.log(`PASS ${name}: ${detail}`);
    } catch (error) {
      await fixture?.page.screenshot({ path: `${out}/${name}.png`, fullPage: true }).catch(() => {});
      report.cases.push({ name, passed: false, error: String(error), pageErrors: errors });
      console.error(`FAIL ${name}: ${error}`);
      process.exitCode = 1;
    } finally { await context.close(); }
  }
} finally {
  writeFileSync(`${out}/results.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
