// User-facing AI settings and streaming flows, with in-browser synthetic responses only.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { stored, reload } from "./storage.mjs";

const html = resolve(process.env.REDLINE_HTML ?? "dist/index.html");
const out = resolve(process.env.AI_UPGRADES_OUT ?? "e2e/out/ai-upgrades");
mkdirSync(out, { recursive: true });
const custom = { baseUrl: "https://mock-ai.invalid/v1", model: "fixture-model" };
const fakeKey = "sk-ai-upgrades-fake-not-real";
const button = (root, name) => root.getByRole("button", { name, exact: true });
const dialog = (page, name) => page.getByRole("dialog", { name, exact: true });
const keyInput = (page) => page.locator('.dialog input[type="password"]');
const calls = (page) => page.evaluate(() => window.aiCalls.map(({ url, body, auth, aborted }) => ({ url, body, auth, aborted })));
const requests = async (page) => (await calls(page)).filter((call) => call.body.max_tokens !== 1);
const connection = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("redline.connection.v1")));
const frame = (content, finish = null) => `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: finish }] })}\r\n\r\n`;
const emit = (page, text, index = 0) => page.evaluate(({ text, index }) => window.feedAi(index, text), { text, index });
const enqueue = (page, fixture) => page.evaluate((fixture) => window.aiQueue.push(fixture), fixture);
const waitRequests = (page, count) => page.waitForFunction((count) => window.aiCalls.filter((call) => call.body.max_tokens !== 1).length === count, count);
const snapshot = async (page) => Object.fromEntries(await Promise.all(["doc", "threads", "versions", "job"].map(async (key) => [key, await stored(page, key)])));

async function openKey(page) {
  if (await button(page, "已连接").count()) await button(page, "已连接").click();
  else await button(page, "填写 API Key").click();
}

async function fillKey(page, settings = custom, remember = false) {
  await page.getByRole("textbox", { name: "Base URL", exact: true }).fill(settings.baseUrl);
  await page.getByRole("textbox", { name: "模型名称", exact: true }).fill(settings.model);
  await keyInput(page).fill(fakeKey);
  await page.getByRole("checkbox", { name: "记住 API Key", exact: true }).setChecked(remember);
  await button(page, "验证并保存").click();
}

async function configure(page, settings = custom, remember = false) {
  await openKey(page);
  await fillKey(page, settings, remember);
  await page.locator(".dialog").waitFor({ state: "detached" });
}

const cases = {
  async connection_boundary(page) {
    await openKey(page);
    await keyInput(page).fill("old-fake-key");
    await page.evaluate(() => { window.holdNextKey = true; });
    await button(page, "验证并保存").click();
    await page.waitForFunction(() => window.aiCalls.length === 1);
    await page.getByRole("textbox", { name: "Base URL", exact: true }).fill("http://unsafe.invalid/v1");
    assert.equal(await keyInput(page).inputValue(), "", "changing the endpoint clears the old key");
    assert.equal((await calls(page))[0].aborted, true, "changing the endpoint cancels its key check immediately");
    await keyInput(page).fill("new-fake-key");
    await button(page, "验证并保存").click();
    await page.locator('.dialog [role="alert"]').filter({ hasText: "只允许 HTTPS" }).waitFor();
    assert.equal((await calls(page)).length, 1, "unsafe endpoints must be rejected before fetch");
    await fillKey(page, custom, true);
    await page.locator(".dialog").waitFor({ state: "detached" });
    await page.evaluate(() => window.aiCalls[0].release());
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("redline.connection.v1"))?.settings.model === "fixture-model");
    assert.deepEqual(await connection(page), { settings: custom, key: fakeKey });
    const checked = (await calls(page)).at(-1);
    assert.equal(checked.url, `${custom.baseUrl}/chat/completions`);
    assert.equal(checked.auth, `Bearer ${fakeKey}`);
    assert.equal(checked.body.model, custom.model);
    await reload(page);
    await button(page, "已连接").waitFor();
    await openKey(page);
    assert.equal(await page.getByRole("textbox", { name: "Base URL", exact: true }).inputValue(), custom.baseUrl);
    assert.equal(await page.getByRole("textbox", { name: "模型名称", exact: true }).inputValue(), custom.model);
    await page.getByRole("checkbox", { name: "记住 API Key", exact: true }).uncheck();
    await button(page, "验证并保存").click();
    await page.locator(".dialog").waitFor({ state: "detached" });
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("redline.connection.v1"))?.key === "");
    assert.deepEqual(await connection(page), { settings: custom, key: "" });
    await reload(page);
    await button(page, "填写 API Key").waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem("redline.apiKey")), null);
    return "端点变更清空凭据并取消旧验证；HTTPS 校验、模型及原子连接记录正确";
  },

  async streaming_audit(page) {
    const before = await snapshot(page);
    const target = before.doc.resume.sections[0].items[0].bullets[0];
    await button(page, "AI 体检").click();
    assert.equal(await dialog(page, "简历体检").locator("textarea").count(), 0, "a general audit needs no job description");
    await button(page, "开始体检").click();
    await dialog(page, "连接 DeepSeek").waitFor();
    await button(page.locator(".dialog"), "关闭").click();
    await dialog(page, "简历体检").waitFor();
    assert.equal((await calls(page)).length, 0);
    await button(page, "开始体检").click();
    await enqueue(page, { mode: "stream" });
    await fillKey(page);
    await waitRequests(page, 1);
    await dialog(page, "简历体检").waitFor();
    assert.ok((await dialog(page, "简历体检").innerText()).includes("mock-ai.invalid"));
    const payload = JSON.stringify({ summary: "表达体检完成", matched: ["原文有明确职责"], missing: ["待填写：实际成果"], edits: [{ id: target.id, requirement: "表达清晰度", why: "精简重复", text: "负责客户管理系统，参与需求讨论和上线。" }] });
    await emit(page, frame(payload.slice(0, 25)));
    await page.locator('.dialog [role="status"]').filter({ hasText: "已收到" }).waitFor();
    assert.deepEqual(await stored(page, "threads"), before.threads, "partial JSON must not create proposals");
    assert.deepEqual(await stored(page, "doc"), before.doc);
    await page.screenshot({ path: `${out}/audit-progress.png` });
    await emit(page, frame(payload.slice(25), "stop") + "data: [DONE]\r\n\r\n");
    await page.locator(".dialog").waitFor({ state: "detached" });
    await page.locator(".proposal.pending").waitFor();
    assert.deepEqual(await stored(page, "doc"), before.doc, "a completed audit still needs an explicit acceptance");
    const threads = await stored(page, "threads");
    assert.equal(threads.length, before.threads.length + 1);
    assert.equal(threads.at(-1).targetId, target.id);
    assert.equal(threads.at(-1).jobId, undefined);
    assert.deepEqual(await stored(page, "job"), before.job);
    const sent = (await requests(page))[0];
    assert.equal(sent.url, `${custom.baseUrl}/chat/completions`);
    assert.equal(sent.body.model, custom.model);
    assert.equal(sent.body.stream, true);
    const context = JSON.stringify(sent.body.messages);
    for (const secret of [before.doc.resume.basics.name, before.doc.resume.basics.phone, before.doc.resume.basics.email]) assert.ok(!context.includes(secret));
    assert.ok(context.includes(target.text));
    await page.screenshot({ path: `${out}/audit-result.png` });
    return "无 JD 体检支持 Key 绕路、真实分块进度；完成后逐条批注，个人字段不发送";
  },

  async cancel_stream(page) {
    await configure(page);
    const before = await snapshot(page);
    await enqueue(page, { mode: "stream" });
    await button(page, "AI 体检").click();
    await button(page, "开始体检").click();
    await waitRequests(page, 1);
    await emit(page, frame(JSON.stringify({ summary: "不得应用的结果", missing: ["不得应用"], edits: [] })));
    await page.locator('.dialog [role="status"]').filter({ hasText: "已收到" }).waitFor();
    await button(page, "取消本次请求").click();
    assert.equal((await requests(page))[0].aborted, true);
    assert.equal(await page.evaluate(() => window.aiStreams[0].cancelled), true);
    await emit(page, frame("", "stop") + "data: [DONE]\n\n");
    assert.deepEqual(await snapshot(page), before);
    await enqueue(page, { mode: "stream" });
    await button(page, "开始体检").click();
    await waitRequests(page, 2);
    await emit(page, frame(JSON.stringify({ summary: "第二次完成", matched: ["正文已有职责"], missing: [], edits: [] }), "stop") + "data: [DONE]\n\n", 1);
    await page.locator(".dialog").waitFor({ state: "detached" });
    assert.deepEqual(await stored(page, "doc"), before.doc);
    assert.deepEqual(await stored(page, "threads"), before.threads);
    return "取消会停止 Reader 并丢弃完整标记前的结果，下一次请求可正常完成";
  },

  async manual_retry(page) {
    await configure(page);
    await enqueue(page, { mode: "json", content: "{broken" });
    await page.locator(".page-live .item li").first().click();
    await page.locator(".composer textarea").fill("精简一下");
    await page.locator(".composer textarea").press("Enter");
    await page.locator(".msg .fail").filter({ hasText: "JSON" }).waitFor();
    assert.equal((await requests(page)).length, 1, "a failed paid request must not repeat itself");
    await enqueue(page, { mode: "json", content: JSON.stringify({ action: "ask", reply: "手动重试成功", options: [] }) });
    await button(page.locator(".thread"), "重试").click();
    await page.locator(".msg").getByText("手动重试成功", { exact: true }).waitFor();
    assert.equal((await requests(page)).length, 2);
    return "坏 JSON 不自动重复计费请求，用户重试可接收标准非流式兼容回复";
  },

  async streaming_import(page) {
    await configure(page);
    const before = await stored(page, "doc");
    await button(page, "导入").click();
    await page.locator(".import-text").fill("导入样例。工作经历：示例公司，负责需求整理。");
    await enqueue(page, { mode: "stream" });
    await button(page, "开始整理").click();
    await waitRequests(page, 1);
    const payload = JSON.stringify({ basics: { name: "导入样例" }, summary: "", sections: [{ kind: "experience", title: "工作经历", items: [{ title: "示例公司", subtitle: "", period: "", bullets: ["负责需求整理。"] }] }] });
    await emit(page, frame(payload.slice(0, 30)));
    await page.locator('.dialog [role="status"]').filter({ hasText: "已收到" }).waitFor();
    assert.equal(await dialog(page, "确认导入").count(), 0);
    assert.deepEqual(await stored(page, "doc"), before);
    await emit(page, frame(payload.slice(30), "stop") + "data: [DONE]\n\n");
    await dialog(page, "确认导入").waitFor();
    assert.deepEqual(await stored(page, "doc"), before, "structured streaming import must still require confirmation");
    return "导入显示分块进度，完整校验后进入核对步骤，不提前替换正文";
  },

  async matched_summary(page) {
    await configure(page);
    await enqueue(page, { mode: "json", content: JSON.stringify({ summary: "岗位已有相关经验", matched: ["原文已有产品协作经验"], missing: ["待补充目标行业经历"], edits: [] }) });
    await button(page, "按岗位定制").click();
    await page.locator(".import-text").fill("需要产品协作和相关行业经验。");
    await button(page, "开始审阅").click();
    await page.locator(".dialog").waitFor({ state: "detached" });
    await page.getByText("AI 认为已有依据，请核对", { exact: true }).waitFor();
    assert.deepEqual((await stored(page, "job")).matched, ["原文已有产品协作经验"]);
    assert.equal((await requests(page))[0].body.stream, true);
    await reload(page);
    await page.getByText("原文已有产品协作经验", { exact: true }).waitFor();
    return "岗位匹配分开保存 AI 判断的已有依据与待补充内容，标准 JSON 回复保持兼容";
  },
};

const selected = process.argv.slice(2);
const unknown = selected.filter((id) => !(id in cases));
if (unknown.length) throw new Error(`Unknown AI cases: ${unknown.join(", ")}`);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const report = { html, htmlSha256: createHash("sha256").update(readFileSync(html)).digest("hex"), browser: browser.version(), cases: [] };
try {
  for (const [id, run] of Object.entries(cases)) {
    if (selected.length && !selected.includes(id)) continue;
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce", serviceWorkers: "block" });
    const errors = [], blocked = [];
    await context.route("**/*", (route) => {
      if (/^(file|data|blob):/.test(route.request().url())) return route.continue();
      blocked.push(route.request().url()); return route.abort();
    });
    await context.addInitScript(() => {
      window.aiQueue = []; window.aiCalls = []; window.aiStreams = []; window.holdNextKey = false;
      const nativeFetch = window.fetch.bind(window);
      const json = (content = "") => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }] }), { headers: { "Content-Type": "application/json" } });
      window.fetch = (url, options) => {
        if (!/^https:\/\/(api\.deepseek\.com|mock-ai\.invalid)\//.test(String(url))) return nativeFetch(url, options);
        const call = { url: String(url), body: JSON.parse(options.body), auth: new Headers(options.headers).get("authorization"), aborted: false };
        window.aiCalls.push(call);
        options.signal?.addEventListener("abort", () => { call.aborted = true; }, { once: true });
        if (call.body.max_tokens === 1) {
          if (window.holdNextKey) {
            window.holdNextKey = false;
            return new Promise((resolve, reject) => {
              call.release = () => resolve(json("ok"));
              options.signal?.addEventListener("abort", () => reject(options.signal.reason), { once: true });
            });
          }
          return Promise.resolve(json("ok"));
        }
        const fixture = window.aiQueue.shift();
        if (!fixture) return Promise.reject(new Error("Missing AI fixture"));
        if (fixture.mode === "json") return Promise.resolve(json(fixture.content));
        const stream = { controller: null, cancelled: false };
        const body = new ReadableStream({ start(controller) { stream.controller = controller; }, cancel() { stream.cancelled = true; } });
        window.aiStreams.push(stream);
        return Promise.resolve(new Response(body, { headers: { "Content-Type": "text/event-stream" } }));
      };
      window.feedAi = (index, text) => {
        const stream = window.aiStreams[index];
        if (stream.cancelled) return;
        const bytes = new TextEncoder().encode(text);
        for (let offset = 0; offset < bytes.length; offset += 3) stream.controller.enqueue(bytes.slice(offset, offset + 3));
      };
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(pathToFileURL(html).href);
      await page.getByRole("textbox", { name: "姓名", exact: true }).waitFor();
      const detail = await run(page);
      assert.deepEqual(errors, [], "the page must not emit uncaught errors");
      assert.deepEqual(blocked, [], "no AI test may access the network");
      report.cases.push({ id, status: "passed", detail });
      console.log(`PASS ${id} | ${detail}`);
    } catch (error) {
      report.cases.push({ id, status: "failed", error: error.stack, blocked });
      console.error(`FAIL ${id}: ${error.stack}`);
      await page.screenshot({ path: `${out}/${id}-failed.png` }).catch(() => {});
      process.exitCode = 1;
    } finally { await context.close(); }
  }
  assert.ok(report.cases.length, "at least one AI case must execute");
} finally {
  await browser.close();
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
}
