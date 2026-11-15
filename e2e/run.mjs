import { stored, seed, reload } from "./storage.mjs";
// End-to-end check of the built single file against a mocked DeepSeek API.
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const out = process.env.OUT ?? "e2e/out";
mkdirSync(out, { recursive: true });
const url = `file://${resolve(process.env.REDLINE_HTML ?? "dist/index.html")}`;
const ok = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok - ${m}`); };

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && !/401/.test(m.text()) && errors.push(m.text()));

const requests = [];
let nextReply = null;
await page.route("https://api.deepseek.com/**", async (route) => {
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
  if (route.request().method() === "OPTIONS") return route.fulfill({ status: 200, headers: cors });
  const body = route.request().postDataJSON();
  requests.push({ body, auth: route.request().headers().authorization });
  if (route.request().headers().authorization === "Bearer bad") return route.fulfill({ status: 401, headers: cors, body: "{}" });
  const content = nextReply === "blank" ? " " : JSON.stringify(nextReply ?? {});
  if (nextReply === "blank") nextReply = { action: "ask", reply: "重试后的问题" };
  await new Promise((r) => setTimeout(r, 150));
  return route.fulfill({
    status: 200, headers: { ...cors, "content-type": "application/json" },
    body: JSON.stringify({ choices: [{ finish_reason: "stop", message: { content } }] }),
  });
});

await page.goto(url);
await page.screenshot({ path: `${out}/1-start.png` });

const bullet = page.locator(".page-live li").first();
await bullet.click();
await page.locator(".composer textarea").fill("突出成果");
await page.keyboard.press("Enter");
ok(await page.getByRole("dialog", { name: "连接 DeepSeek" }).isVisible(), "no key opens the key dialog");
await page.getByRole("textbox", { name: "API Key", exact: true }).fill("bad");
await page.getByRole("button", { name: "验证并保存" }).click();
await page.getByText("API Key 无效").waitFor();
ok(true, "a rejected key shows an error");
await page.getByRole("textbox", { name: "API Key", exact: true }).fill("sk-test");
await page.getByRole("checkbox", { name: "记住 API Key", exact: true }).check();
await page.getByRole("button", { name: "验证并保存" }).click();
await page.locator(".dialog").waitFor({ state: "detached" });
ok(await page.locator(".composer textarea").inputValue() === "突出成果", "the draft survives the key dialog");

nextReply = { action: "edit", reply: "改成了结果导向。", why: "原文没有成果", after: { text: "主导客户管理系统迭代，转化率提升 30%，使用 Python 分析数据。" } };
await page.locator(".composer textarea").press("Enter");
await page.locator(".proposal").waitFor();
const req = requests.at(-1).body;
ok(req.model === "deepseek-flash", "uses deepseek-flash");
ok(req.response_format.type === "json_object" && /json/.test(req.messages[0].content), "uses JSON mode with json in the prompt");
ok(req.thinking.type === "disabled", "thinking is off");
ok(requests.at(-1).auth === "Bearer sk-test", "sends the key");
const warn = await page.locator(".unsupported").innerText();
ok(warn.includes("30%") && warn.includes("Python"), "invented claims are flagged");
ok(await page.getByRole("button", { name: "我确认属实，接受" }).isVisible(), "accepting needs explicit confirmation");
await page.locator(".proposal").hover();
ok((await bullet.innerText()).includes("30%"), "hover previews on the page");
await page.screenshot({ path: `${out}/2-proposal.png` });
await page.mouse.move(700, 880);
ok(!(await bullet.innerText()).includes("30%"), "preview ends with the hover");

await page.getByRole("button", { name: "拒绝" }).click();
nextReply = { action: "edit", reply: "加了占位。", why: "缺少数字", after: { text: "负责客户管理系统，推动转化率提升 [待填写：提升比例]。" } };
await page.locator(".reply textarea").fill("不要编数字，用占位");
await page.keyboard.press("Enter");
await page.locator(".proposal").nth(1).waitFor();
ok(await page.locator(".proposal").nth(1).locator(".unsupported").count() === 0, "placeholders aren't flagged");
await page.locator(".proposal").nth(1).getByRole("button", { name: "接受", exact: true }).click();
ok((await bullet.innerText()).includes("待填写"), "accepting applies the edit");
await page.getByRole("button", { name: "导出 PDF" }).click();
ok(await page.getByRole("dialog", { name: "还有内容没填" }).isVisible(), "placeholders block export");
await page.getByRole("button", { name: "知道了" }).click();

await page.locator(".proposal").nth(1).getByRole("button", { name: "撤销" }).click();
ok(!(await bullet.innerText()).includes("待填写"), "revert restores the text");
await page.locator(".proposal").nth(1).getByRole("button", { name: "拒绝" }).click();

// Stale proposal: edit the node by hand after the AI answered.
const second = page.locator(".page-live .item").first().locator("li").nth(1);
nextReply = "blank";
await second.click();
await page.locator(".composer textarea").fill("具体一点");
await page.keyboard.press("Enter");
await page.locator(".thread.on .fail").waitFor();
ok(await page.getByText("重试后的问题").count() === 0, "a blank reply waits for the user's retry");
await page.locator(".thread.on").getByRole("button", { name: "重试", exact: true }).click();
await page.getByText("重试后的问题").waitFor();
ok(true, "the user can retry a blank reply explicitly");
nextReply = { action: "edit", reply: "改了。", why: "", after: { text: "优化线索分配流程。" } };
await page.locator(".thread.on .reply textarea").fill("优化流程");
await page.keyboard.press("Enter");
await page.locator(".thread.on .proposal").waitFor();
const secondText = await second.innerText();
await page.locator(`.form textarea`).filter({ hasText: secondText }).fill(`${secondText}！`);
await page.getByText("这个方案不能再直接使用").waitFor();
ok(await page.locator(".thread.on .proposal").getByRole("button", { name: "接受" }).count() === 0, "a stale proposal can't be accepted");

// Failure and retry.
nextReply = { action: "style", reply: "收紧行距。", why: "内容偏多", patch: { density: "compact", fontScale: 9 } };
await page.locator(".page-live h2", { hasText: "项目经历" }).click();
await page.locator(".composer textarea").fill("这里紧凑一点");
await page.keyboard.press("Enter");
await page.locator(".style-changes").waitFor();
ok((await page.locator(".style-changes").innerText()).includes("110%"), "style values are clamped");
await page.locator(".style-changes").locator("..").getByRole("button", { name: "接受" }).click();
await page.screenshot({ path: `${out}/3-threads.png` });

await reload(page);
ok(await page.locator(".thread").count() === 1 && (await page.getByRole("tab", { name: /已解决/ }).innerText()).replace(/\s+/g, "") === "已解决2",
  "threads survive a reload, the decided ones under 已解决");
ok(await page.getByRole("button", { name: "已连接" }).isVisible(), "the key survives a reload");

// Overflow indicator.
await page.locator(".form textarea").first().fill("很长的简介。".repeat(400));
await page.getByText(/超出一页约/).waitFor();
await page.screenshot({ path: `${out}/4-overflow.png` });
await page.locator(".topbar .brand").click();
await page.keyboard.press("Meta+z");
await page.getByText("刚好一页").waitFor();
ok(true, "undo restores the page and clears the overflow");

// Clean state for templates and PDFs.
await seed(page, { doc: undefined, threads: undefined });
await reload(page);
await page.getByRole("tab", { name: "版式", exact: true }).click();
for (const [name, id] of [["清隽", "qingjun"], ["书卷", "shujuan"], ["分栏", "fenlan"]]) {
  await page.locator(".tpl", { hasText: name }).click();
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${out}/5-${id}.png` });
  ok(await page.getByText("刚好一页").isVisible(), `${name} fits one page`);
  const pdf = `${out}/${id}.pdf`;
  await page.emulateMedia({ media: "print" });
  writeFileSync(pdf, await page.pdf({ preferCSSPageSize: true, printBackground: true }));
  await page.emulateMedia({ media: "screen" });
  const info = execFileSync("pdfinfo", [pdf]).toString();
  ok(/Pages:\s+1\b/.test(info), `${name} PDF is one page`);
  const text = execFileSync("pdftotext", [pdf, "-"]).toString();
  ok(text.includes("林知远") && text.includes("华东师范大学"), `${name} PDF has real text`);
  ok(!/批注|导出 PDF/.test(text), `${name} PDF has no app chrome`);
}

ok(errors.length === 0, `no console errors ${errors.join(" | ")}`);
await browser.close();
console.log("E2E PASSED");
