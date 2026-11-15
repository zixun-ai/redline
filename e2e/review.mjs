import { stored, seed, reload } from "./storage.mjs";
import { chromium } from "playwright-core";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(`file://${resolve(process.env.REDLINE_HTML ?? "dist/index.html")}`);
  await page.locator(".app").waitFor();
  const original = await stored(page, "doc");
  await page.evaluate(() => localStorage.setItem("redline.connection.v1", JSON.stringify({ settings: { baseUrl: "https://api.deepseek.com", model: "deepseek-flash" }, key: "sk-test" })));
  await seed(page, { threads: [{ id: "t_test", targetId: "basics", label: "原批注", resolved: false, messages: [{ id: "m_test", role: "user", text: "请保留这条批注", at: 1 }] }] });
  await reload(page);
  await page.route("https://api.deepseek.com/**", route => route.fulfill({
    headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "content-type": "application/json" },
    body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ basics: { ...original.resume.basics, name: "导入姓名" }, summary: "整理后的简介", sections: [] }) } }] }),
  }));
  await page.getByRole("button", { name: "导入", exact: true }).click();
  await page.locator(".import-text").fill("原文姓名及简介");
  await page.getByRole("button", { name: "开始整理" }).click();
  const dialog = page.getByRole("dialog", { name: "确认导入" });
  await dialog.waitFor();
  assert.equal(await dialog.getByLabel("导入原文").inputValue(), "原文姓名及简介");
  await dialog.locator('[data-form="basics"] input').first().fill("核对后姓名");
  await page.getByRole("button", { name: "替换当前简历" }).click();
  assert.equal((await stored(page, "doc")).resume.basics.name, "核对后姓名");
  assert.equal(await page.locator(".thread").count(), 0);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await page.getByText("请保留这条批注", { exact: true }).waitFor();
  assert.equal(await stored(page, "doc").then(d => d.resume.basics.name), original.resume.basics.name);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  assert.equal((await stored(page, "doc")).resume.basics.name, "核对后姓名");
  assert.equal(await page.locator(".thread").count(), 0);
  await page.locator('[data-form="basics"] input').first().fill("");
  await page.getByRole("button", { name: "导出 PDF" }).click();
  await page.getByRole("button", { name: "姓名为空，请填写姓名" }).click();
  assert.equal(await page.locator('[data-form="basics"].on').count(), 1);
  assert.deepEqual(errors, []);
  console.log("REVIEW PASSED: editable import, original text, undo/redo with comments, export checks and navigation");
} finally { await browser.close(); }
