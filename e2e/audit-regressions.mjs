// Regressions reproduced during the project audit. All AI replies use a fake, local fixture.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { stored, seed, reload } from "./storage.mjs";

const htmlPath = resolve(process.env.REDLINE_HTML ?? "dist/index.html");
const html = pathToFileURL(htmlPath).href;
const out = process.env.AUDIT_OUT ?? "e2e/out/audit-regressions";
mkdirSync(out, { recursive: true });
const fakeKey = "sk-redline-audit-fake";
const byName = (root, role, name) => root.getByRole(role, { name, exact: true });
const button = (root, name) => byName(root, "button", name);
const tab = (page, name) => byName(page, "tab", name);
const nameField = (page) => byName(page, "textbox", "姓名");
const pageBullet = (page) => page.locator(".page-live .item li").first();
const doc = (page) => stored(page, "doc");
const threads = (page) => stored(page, "threads");
const versions = (page) => stored(page, "versions");
const bullet = async (page) => (await doc(page)).resume.sections[0].items[0].bullets[0];
const statuses = async (page) => (await threads(page)).flatMap((t) => t.messages.flatMap((m) => m.proposal ? [m.proposal.status] : []));
const snapshot = async (page) => Object.fromEntries(await Promise.all(["doc", "threads", "versions", "job"].map(async (key) => [key, await stored(page, key)])));
const undo = (page) => button(page.locator(".tools"), "撤销").click();
const edit = (text) => ({ action: "edit", reply: "建议修改", why: "核对用", after: { text } });
const ask = { action: "ask", reply: "还有可补充的信息吗？", options: [] };
const compact = (text) => text.replace(/\s+/g, "");

async function pdfText(page, name) {
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  writeFileSync(`${out}/${name}.pdf`, pdf);
  return execFileSync("pdftotext", ["-", "-"], { input: pdf }).toString();
}

async function format(page, name) {
  const composer = page.locator(".composer");
  if (await button(composer, "展开格式").count()) await button(composer, "展开格式").click();
  await button(composer.getByRole("toolbar", { name: "组件格式" }), name).click();
}

const cases = {
  async empty_before(j) {
    const { page, replies } = j;
    await j.key();
    replies.push(ask);
    await j.comment(pageBullet(page), "正常批注");
    await page.getByText(ask.reply, { exact: true }).waitFor();
    const itemId = (await doc(page)).resume.sections[0].items[0].id;
    await button(page.locator(`[data-form="${itemId}"]`), "添加一条").click();
    const newId = (await doc(page)).resume.sections[0].items[0].bullets.at(-1).id;
    const sheet = page.locator(".page-live");
    const index = await sheet.locator("[data-node]").evaluateAll((nodes, id) => nodes.findIndex((node) => node.dataset.node === id), newId);
    assert.ok(index >= 0);
    await sheet.focus();
    for (let n = 0; n <= index; n++) await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    replies.push(edit("这是补上的空白要点。"));
    await j.send("请补写空白要点");
    await page.locator(".proposal.pending").waitFor();
    const before = await threads(page);
    assert.equal(before.length, 2);
    assert.equal(before[1].messages[1].proposal.before, '{"text":""}');
    await reload(page);
    await nameField(page).waitFor();
    assert.deepEqual(await threads(page), before, "a valid empty original must not discard saved threads");
    assert.equal(await page.locator(".recovery-notice").count(), 0);
    return "空白原文的建议及已有批注在刷新后完整保留";
  },

  async batch_and_facts(j) {
    const { page } = j;
    await j.key();
    const { id } = await bullet(page);
    await j.tailor({ summary: "第一次", missing: [], edits: [{ id, text: "转化率提高 5%", why: "核对用" }] });
    const first = (await threads(page))[0];
    assert.ok(first.messages[1].proposal.unsupported.includes("5%"), "five years must not establish a five-percent gain");
    assert.equal(first.jobId, (await stored(page, "job")).id);
    assert.equal(await page.getByRole("button", { name: /未发现明显风险的修改/ }).count(), 0);
    await j.tailor({ summary: "第二次", missing: [], edits: [{ id, text: "梳理产品需求并跟进相关工作", why: "核对用" }] });
    const second = (await threads(page))[1];
    assert.notEqual(first.jobId, second.jobId);
    assert.equal(second.jobId, (await stored(page, "job")).id);
    await page.getByRole("button", { name: /^接受 1 处未发现明显风险/ }).click();
    await page.locator(".toast").getByText(/已接受 1 处/).waitFor();
    assert.deepEqual(await statuses(page), ["pending", "accepted"]);
    assert.equal((await bullet(page)).text, "梳理产品需求并跟进相关工作");
    return "数字按单位核对；批量接受仅处理当前岗位并报告实际数量";
  },

  async stale_style(j) {
    const { page, replies } = j;
    await j.key();
    replies.push({ action: "style", why: "使用紧凑间距", patch: { density: "compact" } });
    await j.comment(pageBullet(page), "整页改用紧凑间距");
    const card = page.locator(".proposal.pending");
    await card.waitFor();
    await tab(page, "版式").click();
    await byName(page, "radio", "宽松").click();
    await card.locator(".stale").waitFor();
    assert.equal(await button(card, "接受").count(), 0, "stale proposals must not offer acceptance");
    await card.hover();
    assert.equal(await page.locator(".preview-bar").count(), 0);
    assert.equal((await doc(page)).design.density, "relaxed");
    return "过期的全局格式建议不能覆盖手动设置或进入预览";
  },

  async stale_node_style(j) {
    const { page, replies } = j;
    await j.key();
    const { id } = await bullet(page);
    replies.push({ action: "node_style", why: "居中", patch: { align: "center" } });
    await j.comment(pageBullet(page), "这一条居中");
    const card = page.locator(".proposal.pending");
    await card.waitFor();
    await pageBullet(page).click();
    await format(page, "右对齐");
    await page.keyboard.press("Escape");
    await card.locator(".stale").waitFor();
    assert.equal(await button(card, "接受").count(), 0, "stale proposals must not offer acceptance");
    await card.hover();
    assert.equal(await page.locator(".preview-bar").count(), 0);
    assert.equal((await doc(page)).resume.nodeStyles[id].align, "right");
    return "过期的组件格式建议不能覆盖手动设置";
  },

  async style_undo(j) {
    const { page, replies } = j;
    await j.key();
    const original = (await doc(page)).design.density;
    replies.push({ action: "style", why: "使用紧凑间距", patch: { density: "compact" } });
    await j.comment(pageBullet(page), "整页改用紧凑间距");
    await button(page.locator(".proposal.pending"), "接受").click();
    await tab(page, "版式").click();
    await byName(page, "textbox", "颜色色值").fill("#123456");
    await button(page.locator(".proposal.accepted"), "撤销").click();
    const current = await doc(page);
    assert.equal(current.design.density, original);
    assert.equal(current.design.accent, "#123456", "undo only restores fields changed by that proposal");
    return "撤销格式建议时保留后来手动修改的其他设置";
  },

  async reorder_identity(j) {
    const { page, replies } = j;
    await j.key();
    const item = (await doc(page)).resume.sections[0].items[0];
    replies.push(ask);
    await j.comment(pageBullet(page), "批注原来的第一条");
    await page.getByText(ask.reply, { exact: true }).waitFor();
    const { title, subtitle, period, bullets } = item;
    replies.push({ action: "edit", reply: "调整顺序", why: "核对用", after: { title, subtitle, period, bullets: [bullets[1].text, bullets[0].text, bullets[2].text] } });
    await j.comment(page.locator(".page-live .item-head").first(), "交换前两条顺序");
    await button(page.locator(".proposal.pending"), "接受 2/2 处").click();
    const current = (await doc(page)).resume.sections[0].items[0].bullets;
    assert.equal((await threads(page))[0].targetId, bullets[0].id);
    assert.deepEqual(current.map((row) => row.id), [bullets[1].id, bullets[0].id, bullets[2].id]);
    assert.equal(current.find((row) => row.id === bullets[0].id).text, bullets[0].text);
    return "AI 重排后批注仍指向原来的内容";
  },

  async print_preview(j) {
    const { page, replies } = j;
    await j.key();
    const original = (await bullet(page)).text;
    const marker = "UNACCEPTEDPREVIEWMARKER";
    replies.push(edit(marker));
    await j.comment(pageBullet(page), "测试打印正文");
    await page.locator(".proposal.pending").hover();
    await page.locator(".preview-bar span").waitFor();
    assert.equal(await pageBullet(page).textContent(), marker);
    assert.equal((await bullet(page)).text, original);
    const text = await pdfText(page, "committed-during-preview");
    assert.ok(!text.includes(marker), "PDF must not contain an unaccepted hover preview");
    assert.ok(compact(text).includes(compact(original)), "PDF must contain the committed text");
    assert.deepEqual(await statuses(page), ["pending"]);
    return "悬停预览期间打印仍只输出已接受的正文";
  },

  async print_long_link(j) {
    const { page } = j;
    const ending = "ENDOFRESUMELINK";
    await byName(page, "textbox", "网站").fill(`https://example.com/${"abcdefghij".repeat(22)}${ending}`);
    await page.getByText("刚好一页", { exact: true }).waitFor();
    const horizontal = await page.locator(".print-page .resume").evaluate((el) => ({ actual: el.scrollWidth, width: el.clientWidth }));
    assert.ok(horizontal.actual <= horizontal.width + 1, "long URLs must wrap inside the printed page");
    const text = await pdfText(page, "long-url");
    assert.ok(text.includes("example.com"));
    assert.ok(compact(text).includes(ending), "the final URL characters must survive PDF export");
    return "长网址自动换行，PDF 保留末尾字符";
  },

  async horizontal_overflow_location(j) {
    const { page } = j;
    const target = await bullet(page);
    const original = await doc(page);
    const forcedOverflow = await page.addStyleTag({ content: `[data-node="${target.id}"] { min-width: 1000px !important; }` });
    // Trigger the same measurement used after a real content edit.
    await nameField(page).fill("横向定位测试");
    await page.getByText("内容超出纸张宽度", { exact: true }).waitFor();
    await button(page, "导出 PDF").click();
    const issues = page.getByRole("dialog").getByRole("button").filter({ hasText: "超出可用宽度" });
    assert.equal(await issues.count(), 1, "nested ancestors must not create duplicate overflow issues");
    await issues.click();
    await page.getByRole("dialog").waitFor({ state: "detached" });
    assert.equal(await page.locator(`[data-form="${target.id}"]`).getAttribute("class"), "bullet on", "locate must select the overflowing bullet, not personal details");
    assert.deepEqual((await doc(page)).resume.sections, original.resume.sections, "locating must not edit the content");
    await forcedOverflow.evaluate((el) => el.remove());
    await nameField(page).fill("横向定位已修复");
    await page.getByText("刚好一页", { exact: true }).waitFor();
    return "横向溢出定位到实际要点，去重祖先提示，恢复排版后清除阻断";
  },

  async backup_undo(j) {
    const { page } = j;
    await j.key();
    await tab(page, "版本").click();
    const input = byName(page, "textbox", "版本名称");
    await input.fill("旧版");
    await button(page, "保存").click();
    const download = page.waitForEvent("download");
    await button(page, "下载备份").click();
    const backup = await (await download).path();
    const current = await bullet(page);
    await j.tailor({ summary: "新岗位批次", missing: [], edits: [{ id: current.id, text: `${current.text}。`, why: "备份撤销测试" }] });
    await input.fill("新版");
    await button(page, "保存").click();
    const before = await snapshot(page);
    assert.equal(before.threads.length, 1);
    assert.ok(before.job.id);
    await page.locator('input[type=file][accept=".json"]').setInputFiles(backup);
    await page.getByText("已从备份恢复", { exact: true }).waitFor();
    const restored = await snapshot(page);
    assert.deepEqual(restored.versions.map((v) => v.name), ["旧版"]);
    assert.equal(restored.job, null);
    await undo(page);
    assert.deepEqual(await snapshot(page), before, "undo must restore document, comments, versions and job together");
    await button(page.locator(".tools"), "重做").click();
    assert.deepEqual(await snapshot(page), restored);
    return "备份恢复可完整撤销和重做，包括版本、岗位及批注";
  },

  async partial_save(j) {
    const { page, replies } = j;
    await j.key();
    const original = (await bullet(page)).text;
    const marker = "修改已写入简历正文";
    replies.push(edit(marker));
    await j.comment(pageBullet(page), "测试原子存盘");
    await page.locator(".proposal.pending").waitFor();
    const before = await snapshot(page);
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      window.auditPutKeys = [];
      IDBObjectStore.prototype.put = function (value, key) {
        if (this.name === "editor") {
          window.auditPutKeys.push(key);
          if (key === "threads") throw new DOMException("audit fixture quota", "QuotaExceededError");
        }
        return put.call(this, value, key);
      };
    });
    await button(page.locator(".proposal.pending"), "接受").click();
    await page.locator(".save-state.failed").waitFor();
    assert.equal(await pageBullet(page).textContent(), marker, "failed saves must preserve the user's in-memory edit");
    assert.deepEqual((await page.evaluate(() => window.auditPutKeys)).slice(0, 2), ["doc", "threads"]);
    assert.deepEqual(await snapshot(page), before, "a later record failure must abort the earlier document write");
    page.once("dialog", (dialog) => dialog.accept());
    await page.reload();
    await page.locator(".app").waitFor();
    await nameField(page).waitFor();
    assert.equal((await bullet(page)).text, original);
    assert.deepEqual(await statuses(page), ["pending"]);
    assert.equal(await page.locator(".proposal.pending .stale").count(), 0);
    return "事务内后续写入失败时，刷新仍载入上次完整保存";
  },

  async keyboard_and_narrow(j) {
    const { page } = j;
    await tab(page, "版本").click();
    const restore = button(page.locator(".file-actions"), "从备份恢复");
    assert.equal(await restore.evaluate((el) => el.tabIndex), 0);
    await restore.focus();
    const choosing = page.waitForEvent("filechooser");
    await page.keyboard.press("Enter");
    await choosing;
    const links = await page.getByRole("tab").evaluateAll((els) => els.map((el) => {
      const panel = document.getElementById(el.getAttribute("aria-controls"));
      return panel?.getAttribute("role") === "tabpanel" && panel.getAttribute("aria-labelledby") === el.id;
    }));
    assert.ok(links.length > 0 && links.every(Boolean), "every tab must reference a matching panel");
    for (const width of [1024, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const overlapping = await page.locator(".topbar button, .topbar .brand, .topbar .save-state").evaluateAll(els => {
        const rects = els.map(el => ({ text: el.textContent, rect: el.getBoundingClientRect() }));
        return rects.flatMap((a, i) => rects.slice(i + 1).filter(b => Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left) > 1
          && Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top) > 1).map(b => [a.text, b.text]));
      });
      assert.deepEqual(overlapping, [], "narrow toolbar controls and save status must not overlap");
      await page.screenshot({ path: `${out}/narrow-${width}.png` });
      const nav = page.getByRole("navigation", { name: "编辑区域" });
      await button(nav, "内容").click();
      await tab(page, "内容").click();
      await nameField(page).fill(`窄屏编辑 ${width}`);
      assert.equal((await doc(page)).resume.basics.name, `窄屏编辑 ${width}`);
      await button(nav, "简历").click();
      assert.equal(await page.locator(".page-live").isVisible(), true);
      await button(nav, "批注").click();
      assert.equal(await page.locator(".panel.right").isVisible(), true);
      assert.equal(await page.locator(".too-narrow").isVisible(), false);
    }
    return "恢复备份支持键盘；标签页关系正确；1024/390 像素均可编辑";
  },

  async hidden_text_height(j) {
    const { page } = j;
    await tab(page, "版本").click();
    await button(page, "新建空白简历").click();
    await tab(page, "内容").click();
    const summary = page.locator(".panel.left .group").filter({ has: page.getByRole("heading", { name: "个人简介", exact: true }) }).locator("textarea");
    await summary.waitFor();
    const dimensions = await summary.evaluate((el) => ({ height: el.clientHeight, needed: el.scrollHeight }));
    assert.ok(dimensions.height > 0 && dimensions.height >= dimensions.needed - 1);
    return "在隐藏面板中新建简历后，输入框恢复正常高度";
  },

  async privacy_scope(j) {
    const { page, replies, requests } = j;
    await j.key();
    replies.push(ask);
    await j.comment(pageBullet(page), "仅精炼这句话");
    await page.getByText(ask.reply, { exact: true }).waitFor();
    const current = await doc(page);
    const sent = JSON.stringify(requests[0].messages);
    for (const value of [current.resume.basics.name, current.resume.basics.phone, current.resume.basics.email, current.resume.basics.ethnicity, current.resume.basics.birth]) {
      assert.ok(value && !sent.includes(value), `ordinary comments must not send the personal field ${value}`);
    }
    assert.ok(sent.includes(current.resume.sections[0].items[0].bullets[0].text));
    assert.ok(!sent.includes(current.resume.sections[0].items[1].bullets[0].text));
    assert.equal(await page.evaluate(() => localStorage.getItem("redline.apiKey")), null, "the key stays in memory unless Remember is selected");
    replies.push(ask);
    await j.comment(page.locator('.page-live [data-node="basics"]'), "检查个人信息的写法");
    await page.locator(".thread").nth(1).getByText(ask.reply, { exact: true }).waitFor();
    assert.ok(JSON.stringify(requests[1].messages).includes(current.resume.basics.name));
    return "普通批注不附带身份字段和其他经历；编辑基本信息时才发送该组件";
  },

  async partial_preview(j) {
    const { page, replies } = j;
    await j.key();
    const item = (await doc(page)).resume.sections[0].items[0];
    const { title, subtitle, period, bullets } = item;
    replies.push({ action: "edit", reply: "两处修改", why: "测试预览", after: { title, subtitle, period, bullets: ["甲处修改", "乙处修改", bullets[2].text] } });
    await j.comment(page.locator(".page-live .item-head").first(), "改前两条");
    const card = page.locator(".proposal.pending");
    const second = card.getByRole("checkbox").nth(1);
    await second.click();
    assert.equal(await second.getAttribute("aria-checked"), "false");
    await button(card, "接受 1/2 处").hover();
    await page.locator(".preview-bar span").waitFor();
    assert.equal(await page.locator(".page-live .item li").nth(0).textContent(), "甲处修改");
    assert.equal(await page.locator(".page-live .item li").nth(1).textContent(), bullets[1].text);
    await button(card, "接受 1/2 处").click();
    assert.equal((await bullet(page)).text, "甲处修改");
    assert.equal((await doc(page)).resume.sections[0].items[0].bullets[1].text, bullets[1].text);
    return "未勾选的修改不进入预览，接受结果与预览一致";
  },

  async repeated_quote(j) {
    const { page, replies } = j;
    await j.key();
    const { id } = await bullet(page);
    await page.locator(`[data-form="${id}"] textarea`).fill("甲段保留，甲段修改");
    const target = pageBullet(page);
    await target.evaluate((el) => {
      const text = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode();
      const index = text.textContent.lastIndexOf("甲段");
      const range = document.createRange();
      range.setStart(text, index);
      range.setEnd(text, index + 2);
      const selected = window.getSelection();
      selected.removeAllRanges();
      selected.addRange(range);
    });
    await target.dispatchEvent("click");
    await page.locator(".composer .quote").getByText("甲段", { exact: true }).waitFor();
    replies.push(edit("甲段保留，乙段修改"));
    await j.send("把选中的词改成乙段");
    await page.locator(".proposal.pending").waitFor();
    assert.equal(await page.locator(".msg .fail").count(), 0);
    assert.deepEqual((await threads(page))[0].messages[0].quoteRange, { start: 5, end: 7 });
    await button(page.locator(".proposal.pending"), "接受").click();
    assert.equal((await bullet(page)).text, "甲段保留，乙段修改");
    await reload(page);
    await nameField(page).waitFor();
    assert.deepEqual((await threads(page))[0].messages[0].quoteRange, { start: 5, end: 7 });
    return "重复词按实际选区修改，选区范围可保存并恢复";
  },

  async pin_in_resolved_tab(j) {
    const { page, replies } = j;
    await j.key();
    replies.push(ask);
    await j.comment(pageBullet(page), "测试图钉");
    await page.getByText(ask.reply, { exact: true }).waitFor();
    const done = tab(page, "已解决");
    await done.click();
    await button(page, "打开第 1 条批注").click();
    await page.locator(".thread").waitFor();
    assert.equal(await done.getAttribute("aria-selected"), "false");
    assert.equal(await page.locator(".thread").count(), 1);
    await page.getByText("测试图钉", { exact: true }).waitFor();
    return "点击未解决批注的图钉后，自动显示正确的批注页签";
  },

  async reply_without_key(j) {
    const { page, replies } = j;
    await j.key();
    replies.push(ask);
    await j.comment(pageBullet(page), "测试追问草稿");
    await page.getByText(ask.reply, { exact: true }).waitFor();
    await button(page, "已连接").click();
    await button(page, "移除").click();
    await page.getByRole("dialog").waitFor({ state: "detached" });
    const reply = page.locator(".reply textarea");
    await reply.fill("这是刚打好的追问。");
    await reply.press("Enter");
    await page.getByRole("dialog").waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });
    assert.equal(await reply.inputValue(), "这是刚打好的追问。");
    assert.equal((await threads(page))[0].messages.length, 2);
    return "缺少 API Key 时保留尚未发送的追问草稿";
  },

  async restore_race(j) {
    const { page } = j;
    await page.addInitScript(() => {
      const read = File.prototype.text;
      File.prototype.text = async function () {
        const data = await read.call(this);
        if (this.name === "slow-old.json") await new Promise((resolve) => { window.releaseOldRestore = resolve; });
        return data;
      };
    });
    await reload(page);
    await nameField(page).waitFor();
    const current = await doc(page);
    await tab(page, "版本").click();
    const input = page.locator('input[type=file][accept=".json"]');
    const upload = (name, resumeName) => input.setInputFiles({
      name, mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ app: "redline", doc: { ...current, resume: { ...current.resume, basics: { ...current.resume.basics, name: resumeName } } } })),
    });
    await upload("slow-old.json", "较早的备份");
    await page.waitForFunction(() => !!window.releaseOldRestore);
    await upload("fast-new.json", "最后选中的备份");
    await page.locator(".page-live").getByRole("heading", { name: "最后选中的备份", exact: true }).waitFor();
    await page.evaluate(async () => {
      window.releaseOldRestore();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    assert.equal((await doc(page)).resume.basics.name, "最后选中的备份");
    return "较早开始的慢速备份读取不能覆盖最后一次选择";
  },

  async close_tailor(j) {
    const { page } = j;
    await j.key();
    const before = await snapshot(page);
    const pending = j.defer({ summary: "关闭后不得出现的岗位结果", missing: ["示例缺项"], edits: [] });
    await button(page, "按岗位定制").click();
    await page.locator(".import-text").fill("示例岗位说明");
    await button(page, "开始审阅").click();
    await pending.arrived;
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => window.auditAiSignals.at(-1).aborted), true, "closing aborts the request before the exit animation ends");
    pending.release();
    await pending.settled;
    await page.getByRole("dialog").waitFor({ state: "detached" });
    assert.deepEqual(await snapshot(page), before);
    assert.equal(await page.getByText("关闭后不得出现的岗位结果", { exact: true }).count(), 0);
    return "关闭定制窗口立即中止请求，迟到结果不生成岗位或版本";
  },

  async saved_duplicate_targets(j) {
    const { page } = j;
    // A valid saved history may have two suggestions for one target. Both require individual review.
    const current = await doc(page);
    const target = current.resume.sections[0].items[0].bullets[0];
    const job = { id: "job-audit", summary: "重复目标批次", missing: [] };
    const records = ["第一份建议", "第二份建议"].map((text, i) => ({
      id: `audit-thread-${i}`, jobId: job.id, targetId: target.id, label: "工作经历", resolved: false,
      messages: [{ id: `audit-message-${i}`, role: "ai", text: "建议修改", fromJd: true, at: i + 1, proposal: {
        id: `audit-proposal-${i}`, kind: "content", status: "pending", why: "计数测试", targetId: target.id,
        type: "bullet", before: JSON.stringify({ text: target.text }), after: { text }, unsupported: [],
      } }],
    }));
    await seed(page, { threads: records, job });
    await reload(page);
    await nameField(page).waitFor();
    assert.equal(await page.getByRole("button", { name: /未发现明显风险的修改/ }).count(), 0);
    assert.deepEqual(await statuses(page), ["pending", "pending"]);
    assert.equal((await bullet(page)).text, target.text);
    return "同一目标存在两个待审方案时，批量接受排除两者";
  },

  async legacy_migration(j) {
    const { page } = j;
    const original = await snapshot(page);
    original.doc.resume.basics.name = "旧版本迁移";
    const target = original.doc.resume.sections[0].items[0].bullets[0];
    target.text = "";
    const valid = { id: "legacy-thread", targetId: target.id, label: "空白要点", resolved: false, messages: [{
      id: "legacy-message", role: "ai", text: "旧建议", at: 1, proposal: { id: "legacy-proposal", kind: "content", status: "pending", why: "", type: "bullet", targetId: target.id, before: '{"text":""}', after: { text: "已补充的内容" }, unsupported: [] },
    }] };
    original.threads = [valid, { id: "broken", messages: [null] }];
    await seed(page, { doc: undefined, threads: undefined, versions: undefined, job: undefined });
    await page.evaluate(state => {
      for (const [key, value] of Object.entries(state)) localStorage.setItem(`redline.${key}.v1`, JSON.stringify(value));
    }, original);
    await reload(page);
    assert.equal(await nameField(page).inputValue(), "旧版本迁移");
    assert.deepEqual(await threads(page), [valid]);
    await page.locator(".recovery-notice").waitFor();
    const next = page.waitForEvent("download");
    await button(page, "下载恢复数据").click();
    const recovery = JSON.parse(readFileSync(await (await next).path(), "utf8"));
    assert.deepEqual(recovery.threads, original.threads, "migration must preserve the original damaged data");
    assert.equal(await page.evaluate(() => localStorage.getItem("redline.doc.v1")), null);
    await reload(page);
    assert.deepEqual(await threads(page), [valid]);
    return "旧存档迁移保留有效空原文批注，并可下载损坏记录的原件";
  },

  async migration_write_failure(j) {
    const { page } = j;
    const original = await snapshot(page);
    original.doc.resume.basics.name = "迁移失败仍可导出";
    await seed(page, { doc: undefined, threads: undefined, versions: undefined, job: undefined });
    await page.evaluate(state => {
      for (const [key, value] of Object.entries(state)) localStorage.setItem(`redline.${key}.v1`, JSON.stringify(value));
    }, original);
    await page.addInitScript(() => {
      const put = IDBObjectStore.prototype.put;
      window.migrationFailure = true;
      IDBObjectStore.prototype.put = function(value, key) {
        if (window.migrationFailure && key === "job") throw new DOMException("migration quota", "QuotaExceededError");
        return put.call(this, value, key);
      };
    });
    await reload(page);
    await page.locator(".save-state.failed").waitFor();
    assert.equal(await nameField(page).inputValue(), original.doc.resume.basics.name);
    assert.equal(await doc(page), undefined, "failed migration must not leave a partial document");
    assert.ok(await page.evaluate(() => localStorage.getItem("redline.doc.v1")), "old data survives failed migration");
    await tab(page, "版本").click();
    const next = page.waitForEvent("download");
    await button(page, "下载备份").click();
    const backup = JSON.parse(readFileSync(await (await next).path(), "utf8"));
    assert.deepEqual(backup.doc, original.doc);
    await page.evaluate(() => { window.migrationFailure = false; });
    await tab(page, "内容").click();
    await nameField(page).fill("迁移重试成功");
    assert.equal((await doc(page)).resume.basics.name, "迁移重试成功");
    assert.equal(await page.evaluate(() => localStorage.getItem("redline.doc.v1")), null);
    return "迁移写入失败保留原件并允许备份，重试成功后才移除旧数据";
  },

  async readonly_startup(j) {
    const { page } = j;
    const name = "只读存储仍可导出";
    await nameField(page).fill(name);
    const saved = await doc(page);
    assert.equal(saved.resume.basics.name, name);
    await page.addInitScript(() => {
      window.auditBlockedWrites = 0;
      window.auditPrintCount = 0;
      window.print = () => { window.auditPrintCount++; };
      IDBObjectStore.prototype.put = function () {
        window.auditBlockedWrites++;
        throw new DOMException("audit read-only storage", "QuotaExceededError");
      };
    });
    await reload(page);
    await nameField(page).waitFor();
    assert.equal(await nameField(page).inputValue(), name);
    assert.deepEqual(await doc(page), saved);
    assert.equal(await page.evaluate(() => window.auditBlockedWrites), 0, "valid saved state must not be rewritten during startup");
    await button(page, "导出 PDF").click();
    await page.waitForFunction(() => window.auditPrintCount === 1);
    assert.ok(compact(await pdfText(page, "readonly-startup")).includes(name));
    await tab(page, "版本").click();
    const downloading = page.waitForEvent("download");
    await button(page, "下载备份").click();
    const backup = JSON.parse(readFileSync(await (await downloading).path(), "utf8"));
    assert.deepEqual(backup.doc, saved);
    assert.equal(await page.evaluate(() => window.auditBlockedWrites), 0);
    return "持久层无法写入时仍能打开有效存档，打印 PDF 并下载备份";
  },

  async version_history(j) {
    const { page } = j;
    await nameField(page).fill("版本历史测试");
    const original = await doc(page);
    await tab(page, "版本").click();
    const name = byName(page, "textbox", "版本名称");
    const redo = () => button(page.locator(".tools"), "重做").click();
    for (const value of ["版本甲", "版本乙"]) {
      await name.fill(value);
      await button(page, "保存").click();
    }
    const both = await versions(page);
    assert.deepEqual(both.map((version) => version.name), ["版本乙", "版本甲"]);
    await undo(page);
    assert.deepEqual((await versions(page)).map((version) => version.name), ["版本甲"]);
    await undo(page);
    assert.deepEqual(await versions(page), []);
    assert.deepEqual(await doc(page), original, "undoing version creation must not also undo the preceding text edit");
    await redo();
    await redo();
    assert.deepEqual(await versions(page), both);
    await button(page, "删除 版本甲").click();
    assert.deepEqual((await versions(page)).map((version) => version.name), ["版本乙"]);
    await undo(page);
    assert.deepEqual(await versions(page), both);
    await redo();
    assert.deepEqual((await versions(page)).map((version) => version.name), ["版本乙"]);
    assert.deepEqual(await doc(page), original);
    await button(page, "删除 版本乙").click();
    await tab(page, "内容").click();
    await nameField(page).fill("恢复前的输入");
    await button(page.locator(".toast"), "撤销").click();
    await nameField(page).fill("恢复后的输入");
    await undo(page);
    assert.equal(await nameField(page).inputValue(), original.resume.basics.name, "toast restore must start a fresh typing history entry");
    assert.deepEqual((await versions(page)).map((version) => version.name), ["版本乙"], "undoing new typing must retain the restored version");
    return "版本增删及提示撤销后立即输入，各有独立的撤销、重做历史";
  },
};

async function open(context) {
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  await page.addInitScript(() => {
    const send = window.fetch;
    window.auditAiSignals = [];
    window.fetch = (url, options) => {
      if (String(url).startsWith("https://api.deepseek.com/")) window.auditAiSignals.push(options.signal);
      return send(url, options);
    };
  });
  const replies = [], requests = [];
  const j = {
    page, replies, requests,
    async key() {
      await button(page, "填写 API Key").click();
      await byName(page, "textbox", "API Key").fill(fakeKey);
      await button(page, "验证并保存").click();
      await button(page, "已连接").waitFor();
      await page.getByRole("dialog").waitFor({ state: "detached" });
    },
    async send(text) {
      await page.locator(".composer textarea").fill(text);
      await page.locator(".composer textarea").press("Enter");
    },
    async comment(target, text) {
      await target.click();
      await this.send(text);
    },
    async tailor(reply) {
      replies.push(reply);
      await button(page, "按岗位定制").click();
      await page.locator(".import-text").fill("示例岗位说明");
      await button(page, "开始审阅").click();
      await page.getByText(reply.summary, { exact: true }).waitFor();
      await page.getByRole("dialog").waitFor({ state: "detached" });
    },
    defer(value) {
      let release, arrive, settle;
      const hold = new Promise((resolve) => { release = resolve; });
      const arrived = new Promise((resolve) => { arrive = resolve; });
      const settled = new Promise((resolve) => { settle = resolve; });
      replies.push({ held: true, value, hold, arrive, settle });
      return { release, arrived, settled };
    },
  };
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.protocol === "file:") return route.continue();
    if (url.origin !== "https://api.deepseek.com") return route.abort();
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 200, headers: cors });
    if (request.headers().authorization !== `Bearer ${fakeKey}`) return route.abort();
    const body = request.postDataJSON();
    const keyCheck = body.max_tokens === 1;
    if (!keyCheck) requests.push(body);
    const fixture = keyCheck ? {} : replies.shift();
    if (!fixture) return route.fulfill({ status: 500, headers: cors, body: "{}" });
    if (fixture.held) { fixture.arrive(); await fixture.hold; }
    try {
      await route.fulfill({
        status: 200, headers: { ...cors, "content-type": "application/json" },
        json: { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(fixture.held ? fixture.value : fixture) } }] },
      });
    } catch (error) {
      if (!fixture.held) throw error;
      // Aborting a deferred request is the behavior under test.
    } finally { fixture.settle?.(); }
  });
  await page.goto(html);
  await nameField(page).waitFor();
  return j;
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const selected = process.argv.slice(2);
const report = { html: htmlPath, htmlSha256: createHash("sha256").update(readFileSync(htmlPath)).digest("hex"), browser: browser.version(), cases: [] };
try {
  for (const [id, run] of Object.entries(cases)) {
    if (selected.length && !selected.includes(id)) continue;
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: id === "close_tailor" ? "no-preference" : "reduce", acceptDownloads: true });
    const errors = [];
    context.on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)));
    let j;
    try {
      j = await open(context);
      const detail = await run(j);
      assert.deepEqual(errors, [], "the page must not emit uncaught errors");
      report.cases.push({ id, status: "passed", detail });
      console.log(`PASS ${id} | ${detail}`);
    } catch (error) {
      report.cases.push({ id, status: "failed", error: error.stack });
      console.error(`FAIL ${id}: ${error.stack}`);
      if (j) await j.page.screenshot({ path: `${out}/${id}-failed.png` }).catch(() => {});
      process.exitCode = 1;
    } finally { await context.close(); }
  }
  assert.ok(report.cases.length, "choose at least one known case");
} finally {
  await browser.close();
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
}
