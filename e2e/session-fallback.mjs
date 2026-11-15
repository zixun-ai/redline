import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { stored } from "./storage.mjs";

const html = resolve(process.env.REDLINE_HTML ?? "dist/index.html");
const out = resolve(process.env.SESSION_FALLBACK_OUT ?? "e2e/out/session-fallback");
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const report = { html, htmlSha256: createHash("sha256").update(readFileSync(html)).digest("hex"), cases: [] };
const name = page => page.getByRole("textbox", { name: "姓名", exact: true });
const url = pathToFileURL(html).href;

async function open(context, mode, legacy) {
  const page = await context.newPage();
  page.on("dialog", dialog => dialog.type() === "beforeunload" ? dialog.accept() : dialog.dismiss());
  if (mode) await page.addInitScript(({ mode, legacy }) => {
    if (legacy) localStorage.setItem("redline.doc.v1", JSON.stringify(legacy));
    const denied = () => new DOMException("test access denied", "SecurityError");
    if (mode === "getter") Object.defineProperty(navigator, "locks", { get() { throw denied(); } });
    else Object.defineProperty(navigator, "locks", { value: mode === "reject" ? { request: () => Promise.reject(denied()) }
      : mode === "throw" ? { request() { throw denied(); } } : undefined });
    window.editorPuts = 0;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) { window.editorPuts++; return put.apply(this, args); };
    if (mode === "storage-denied") {
      Object.defineProperty(window, "indexedDB", { get() { throw denied(); } });
      Storage.prototype.getItem = () => { throw denied(); };
    }
  }, { mode, legacy });
  await page.goto(url);
  await page.locator(".app").waitFor();
  if (mode) {
    await page.locator('[data-editor-session="temporary"]').waitFor();
    assert.match(await page.locator(".save-state").innerText(), /临时|未自动保存/);
    assert.equal(await page.getByText("已保存在本机", { exact: true }).count(), 0);
  }
  return page;
}

async function backup(page) {
  await page.getByRole("tab", { name: "版本", exact: true }).click();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载备份", exact: true }).click();
  return JSON.parse(readFileSync(await (await pending).path(), "utf8"));
}

const cases = {
  async simultaneous(context) {
    const owner = await open(context);
    await name(owner).fill("持久页原文");
    assert.equal((await stored(owner, "doc")).resume.basics.name, "持久页原文");
    const [a, b] = await Promise.all([open(context, "missing"), open(context, "missing")]);
    assert.equal(await name(a).inputValue(), "持久页原文");
    assert.equal(await name(b).inputValue(), "持久页原文");
    await name(a).fill("甲页临时修改");
    await name(b).fill("乙页临时修改");
    for (const page of [a, b]) assert.equal(await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }), true, "leaving a modified temporary copy must warn before discarding edits");
    assert.equal((await stored(owner, "doc")).resume.basics.name, "持久页原文", "temporary tabs cannot overwrite the persistent editor");
    await name(owner).fill("持久页新内容");
    assert.equal((await stored(owner, "doc")).resume.basics.name, "持久页新内容");
    assert.equal((await backup(a)).doc.resume.basics.name, "甲页临时修改");
    assert.equal((await backup(b)).doc.resume.basics.name, "乙页临时修改");
    assert.equal(await a.evaluate(() => window.editorPuts), 0);
    assert.equal(await b.evaluate(() => window.editorPuts), 0);
    await a.reload();
    await name(a).waitFor();
    assert.equal(await name(a).inputValue(), "持久页新内容", "reopening reads the persistent state, not another temporary copy");
    await a.screenshot({ path: `${out}/temporary-session.png` });
    const pdf = await a.pdf({ path: `${out}/temporary-session.pdf`, preferCSSPageSize: true, printBackground: true });
    assert.match(execFileSync("pdfinfo", ["-"], { input: pdf }).toString(), /Pages:\s+1\b/);
    const printed = execFileSync("pdftotext", ["-", "-"], { input: pdf }).toString();
    assert.ok(printed.includes("持久页新内容") && !printed.includes("临时会话"));
  },
  async rejection(context) {
    for (const mode of ["reject", "throw", "getter"]) {
      const page = await open(context, mode);
      await name(page).fill(`${mode} 临时简历`);
      assert.equal((await backup(page)).doc.resume.basics.name, `${mode} 临时简历`);
      assert.equal(await page.evaluate(() => window.editorPuts), 0, `${mode}: no persistent writes`);
      await page.close();
    }
  },
  async legacy(context) {
    const seed = await open(context);
    const doc = await stored(seed, "doc");
    await seed.close();
    const fresh = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await fresh.route("https://**", route => route.abort());
    try {
      doc.resume.basics.name = "旧版数据";
      const page = await open(fresh, "missing", doc);
      assert.equal(await name(page).inputValue(), "旧版数据");
      await name(page).fill("临时更改旧版");
      assert.equal((await backup(page)).doc.resume.basics.name, "临时更改旧版");
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("redline.doc.v1")).resume.basics.name), "旧版数据");
      assert.equal(await stored(page, "doc"), undefined, "temporary opening never migrates or deletes the legacy save");
      assert.equal(await page.evaluate(() => window.editorPuts), 0);
    } finally { await fresh.close(); }
  },
  async storageDenied(context) {
    const page = await open(context, "storage-denied");
    assert.match(await page.locator('[data-editor-session="temporary"]').innerText(), /部分本机数据无法读取/);
    await name(page).fill("存储关闭时的临时简历");
    const data = await backup(page);
    assert.equal(data.doc.resume.basics.name, "存储关闭时的临时简历");
    assert.equal(data.app, "redline");
    assert.equal(await page.evaluate(() => window.editorPuts), 0);
  },
};

try {
  for (const [id, run] of Object.entries(cases)) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    await context.route("https://**", route => route.abort());
    const errors = [];
    context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
    try {
      await run(context);
      assert.deepEqual(errors, []);
      report.cases.push({ id, status: "passed" });
      console.log(`PASS ${id}`);
    } catch (error) {
      report.cases.push({ id, status: "failed", error: error.message });
      console.error(`FAIL ${id}: ${error.stack}`);
      process.exitCode = 1;
    } finally { await context.close(); }
  }
} finally {
  await browser.close();
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
}
