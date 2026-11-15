import { stored, seed, reload } from "./storage.mjs";
// Second-round features, against a mocked DeepSeek API.
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const out = process.env.OUT ?? "e2e/out";
mkdirSync(out, { recursive: true });
const ok = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok - ${m}`); };

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

const requests = [];
let reply = {};
await page.route("https://api.deepseek.com/**", async (route) => {
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
  if (route.request().method() === "OPTIONS") return route.fulfill({ status: 200, headers: cors });
  const raw = route.request().postData();
  requests.push(raw);
  const value = typeof reply === "function" ? reply(JSON.parse(raw)) : reply;
  return route.fulfill({
    status: 200, headers: { ...cors, "content-type": "application/json" },
    body: JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }] }),
  });
});

await page.goto(`file://${resolve(process.env.REDLINE_HTML ?? "dist/index.html")}`);
await page.evaluate(() => localStorage.setItem("redline.connection.v1", JSON.stringify({ key: "sk-test", settings: { baseUrl: "https://api.deepseek.com", model: "deepseek-flash" } })));
await reload(page);

// Options
reply = { action: "ask", reply: "这个成果主要体现在哪？", options: ["提升转化", "降低成本"] };
await page.locator(".page-live li").first().click();
await page.locator(".composer textarea").fill("突出成果");
await page.keyboard.press("Enter");
await page.locator(".options button").first().waitFor();
reply = { action: "edit", reply: "好。", why: "", after: { text: "提升转化。" } };
await page.getByRole("button", { name: "提升转化" }).click();
await page.locator(".proposal").waitFor();
ok(requests.at(-1).includes("提升转化") && (await page.locator(".msg .user").nth(1).innerText()) === "提升转化", "an option is sent as the user's answer");
ok(await page.locator(".options").count() === 0, "options disappear once answered");
await page.locator(".proposal").getByRole("button", { name: "拒绝" }).click();

// Partial accept
const firstItem = page.locator(".page-live .item").first();
const originals = await firstItem.locator("li").allInnerTexts();
reply = { action: "edit", reply: "改了两条。", why: "更具体", after: { title: "青禾科技", subtitle: "高级产品经理", period: "2022.03 — 至今", bullets: [originals[0], "第二条新写法。", "第三条新写法。"] } };
await firstItem.locator(".item-head").click();
await page.locator(".composer textarea").fill("整段更具体");
await page.keyboard.press("Enter");
await page.locator(".row").nth(1).waitFor();
ok(await page.locator(".row").count() === 2, "only changed rows are listed");
await page.locator('.row [role="checkbox"]').nth(1).uncheck();
await page.screenshot({ path: `${out}/6-rows.png` });
await page.getByRole("button", { name: "接受 1/2 处" }).click();
const after = await firstItem.locator("li").allInnerTexts();
ok(after[1] === "第二条新写法。" && after[2] === originals[2], "only the checked row is applied");

// Selected words
const li = page.locator(".page-live .item").nth(1).locator("li").first();
const box = await li.boundingBox();
await page.mouse.move(box.x + 30, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + 160, box.y + box.height / 2, { steps: 6 });
await page.mouse.up();
await page.locator(".composer .quote").waitFor();
const quote = await page.locator(".composer .quote").innerText();
const full = await li.innerText();
ok(quote.length > 2 && full.includes(quote), "dragging across words attaches a quote");
await page.screenshot({ path: `${out}/7-quote.png` });
reply = { action: "edit", reply: "改了。", why: "", after: { text: "完全不同的一句话。" } };
await page.locator(".composer textarea").fill("改写");
await page.keyboard.press("Enter");
await page.locator(".msg .fail", { hasText: "超出了选中的文字" }).waitFor();
ok(requests.at(-1).includes("选中内容"), "the quote reaches the model");
ok(await page.locator(".thread.on .proposal").count() === 0, "an edit outside the selection is refused");
reply = { action: "edit", reply: "改了。", why: "", after: { text: full.replace(quote, "替换后") } };
await page.locator(".thread.on").getByRole("button", { name: "重试" }).click();
await page.locator(".thread.on .proposal").waitFor();
ok(true, "an edit inside the selection is proposed");

// JD tailoring
const resetThreads = page.locator(".thread");
const before = await resetThreads.count();
reply = (body) => {
  const ids = [...body.messages[1].content.matchAll(/\[([a-z]+_[a-z0-9]+)\]/g)].map((m) => m[1]);
  return {
    summary: "偏 B 端经验，基本匹配。", missing: ["Kubernetes 经验"],
    edits: [
      { id: ids[0], requirement: "熟悉 B 端产品", why: "贴近岗位", text: "五年 B 端产品经验，专注协同办公与客户管理。" },
      { id: ids[5], requirement: "熟悉 Kubernetes", why: "岗位需要", text: "用 Kubernetes 部署。" },
      { id: "fake_id", requirement: "x", why: "", text: "y" },
    ],
  };
};
await page.getByRole("button", { name: "按岗位定制" }).click();
await page.locator(".dialog textarea").fill("招聘产品经理，要求熟悉 Kubernetes。");
await page.getByRole("button", { name: "开始审阅" }).click();
await page.locator(".job").waitFor();
ok(await resetThreads.count() === before + 2, "valid edits become threads and unknown ids are dropped");
ok((await page.locator(".job").innerText()).includes("Kubernetes 经验"), "uncovered requirements are listed");
const risky = page.locator(".proposal").filter({ hasText: "用 Kubernetes" });
ok((await risky.innerText()).includes("Kubernetes") && await risky.locator(".unsupported").count() === 1, "a posting's term counts as unsupported");
await page.screenshot({ path: `${out}/8-job.png` });
await page.getByRole("button", { name: /未发现明显风险的修改/ }).click();
ok((await page.locator(".page-live .summary").innerText()).includes("专注协同办公"), "safe edits apply");
ok(await risky.getByRole("button", { name: "我确认属实，接受" }).count() === 1, "risky edits stay pending");

// Versions
await page.getByRole("tab", { name: "版本", exact: true }).click();
ok(await page.locator(".version").count() === 1, "tailoring saved a version first");
await page.getByRole("button", { name: /^恢复 定制前/ }).click();
ok(!(await page.locator(".page-live .summary").innerText()).includes("专注协同办公"), "restoring a version brings back its text");
await page.keyboard.press("Meta+z");
await page.locator(".page-live").click({ position: { x: 5, y: 5 } });
await page.keyboard.press("Escape");
const dl = page.waitForEvent("download");
await page.getByRole("button", { name: "下载备份" }).click();
const file = await (await dl).path();
const backup = JSON.parse(readFileSync(file, "utf8"));
ok(backup.doc && !JSON.stringify(backup).includes("sk-test"), "a backup has the resume and not the key");
await page.getByRole("button", { name: "新建空白简历" }).click();
ok(await page.locator(".page-live li").count() <= 2, "a blank resume starts empty");
await page.locator('input[type=file][accept=".json"]').setInputFiles(file);
await page.getByText("已从备份恢复").waitFor();
ok(await page.locator(".page-live .item").count() >= 3, "a backup restores");

// Fit to one page
await page.getByRole("tab", { name: "内容", exact: true }).click();
const longText = "负责产品规划与落地，协调研发设计推进上线，复盘数据并持续改进。".repeat(7);
await page.locator(".form textarea").first().fill(longText.repeat(5));
await page.getByRole("button", { name: "压缩到一页" }).click();
await page.getByText("刚好一页").waitFor();
const fitted = await stored(page, "doc").then(d => d.design);
console.log("  fitted design:", fitted.density, fitted.fontScale);
ok(fitted.density === "compact", "fit tightens the design until it fits");
await page.waitForTimeout(200);
await page.locator(".form textarea").first().fill("很长。".repeat(1500));
await page.getByRole("button", { name: "压缩到一页" }).click();
await page.getByText("无法压到一页，已恢复原版式。请精简内容，或在版式面板允许多页。", { exact: true }).waitFor();
ok(JSON.stringify((await stored(page, "doc")).design) === JSON.stringify(fitted), "failed fit restores the previous design");
await page.locator(".form textarea").first().fill("简介。");
await page.getByText("刚好一页").waitFor();

// Photo
await page.locator('input[type=file][accept="image/*"]').setInputFiles(`${out}/1-start.png`);
await page.getByRole("dialog", { name: "调整证件照" }).getByRole("button", { name: "保存照片", exact: true }).click();
await page.locator(".page-live .photo").waitFor();
ok(true, "a photo shows on the page");
reply = { action: "ask", reply: "?", options: [] };
await page.locator(".page-live header").click();
await page.locator(".composer textarea").fill("调整");
await page.keyboard.press("Enter");
await page.waitForTimeout(300);
ok(!requests.at(-1).includes("data:image"), "the photo is never sent to the model");
await page.emulateMedia({ media: "print" });
writeFileSync(`${out}/photo.pdf`, await page.pdf({ preferCSSPageSize: true, printBackground: true }));
await page.emulateMedia({ media: "screen" });
ok(/image/.test(execFileSync("pdfimages", ["-list", `${out}/photo.pdf`]).toString()) && /Pages:\s+1\b/.test(execFileSync("pdfinfo", [`${out}/photo.pdf`]).toString()), "the photo is in the one-page PDF");

// File import
writeFileSync(`${out}/r.txt`, "王小明\n产品经理\n星河科技 2020-2024\n负责增长");
execFileSync("textutil", ["-convert", "docx", `${out}/r.txt`, "-output", `${out}/r.docx`]);
await page.getByRole("button", { name: "导入", exact: true }).click();
await page.locator(".file-pick input").setInputFiles(`${out}/qingjun.pdf`);
await page.waitForFunction(() => document.querySelector(".import-text")?.value.includes("华东师范大学"), null, { timeout: 15000 });
ok(true, "PDF text is read in the browser");
const pdfValue = await page.locator(".import-text").inputValue();
ok(!/[\u2E80-\u2FDF]/.test(pdfValue), "radical look-alikes are normalized");
ok(pdfValue.startsWith("林知远"), "PDF text keeps its reading order");
await page.locator(".file-pick input").setInputFiles(`${out}/fenlan.pdf`);
await page.waitForFunction(() => {
  const v = document.querySelector(".import-text")?.value ?? "";
  return v.includes("信息管理") && !v.includes("华东师范大学 信息") && v.indexOf("专业技能") < v.indexOf("工作经历");
}, null, { timeout: 15000 });
ok(true, "two-column PDFs read one column at a time");
await page.locator(".file-pick input").setInputFiles(`${out}/r.docx`);
await page.waitForFunction(() => document.querySelector(".import-text")?.value.includes("王小明"), null, { timeout: 15000 });
ok(true, "Word text is read in the browser");
await page.keyboard.press("Escape");

// Narrow layout
await page.setViewportSize({ width: 1100, height: 760 });
await page.screenshot({ path: `${out}/9-1100.png` });
const clipped = await page.evaluate(() => document.querySelector(".topbar").scrollWidth > document.querySelector(".topbar").clientWidth);
ok(!clipped, "the top bar fits at 1100px");

// Colors and type
await page.setViewportSize({ width: 1440, height: 900 });
await seed(page, { doc: { ...await stored(page, "doc"), design: { template: "qingjun", accent: "#1F4E8C", density: "normal", fontScale: 1 } }, threads: [] });
await reload(page);
await page.getByRole("tab", { name: "版式", exact: true }).click();
ok(await page.locator(".swatches button").count() === 16, "sixteen preset colors");
ok(await page.getByRole("radio", { name: "下划线" }).evaluate((b) => b.getAttribute("aria-checked") === "true"), "older documents get defaults");
const accent = () => page.locator(".page-live article").evaluate((a) => a.style.getPropertyValue("--accent"));
await page.getByRole("button", { name: "强调色 紫藤" }).click();
ok(await accent() === "#5B3A9B", "a preset applies");
await page.getByLabel("颜色色值").fill("#00aa88");
ok(await accent() === "#00AA88", "a typed color applies");
await page.getByLabel("自选颜色").evaluate((i) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "#ff8800");
  i.dispatchEvent(new Event("input", { bubbles: true }));
});
ok(await accent() === "#FF8800", "the color picker applies");
await page.getByLabel("颜色色值").fill("#ffee88");
await page.getByText("这个颜色偏浅").waitFor();
await page.getByRole("radio", { name: "色块" }).click();
const heading = await page.locator(".page-live h2").first().evaluate((h) => getComputedStyle(h).color);
ok(heading === "rgb(0, 0, 0)", "filled headings stay readable on a light color");
await page.getByLabel("颜色色值").fill("#1F6B45");
const pdfFonts = {};
for (const name of ["黑体", "宋体", "楷体", "仿宋", "圆体"]) {
  const b = page.locator(".font", { hasText: name });
  if (await b.isDisabled()) { console.log(`  ${name} not installed`); continue; }
  await b.click();
  await page.emulateMedia({ media: "print" });
  writeFileSync(`${out}/font.pdf`, await page.pdf({ preferCSSPageSize: true, printBackground: true }));
  await page.emulateMedia({ media: "screen" });
  pdfFonts[name] = execFileSync("pdffonts", [`${out}/font.pdf`]).toString().split("\n").slice(2)
    .map((l) => l.split(" ")[0].replace(/^[A-Z]+\+/, "")).filter(Boolean).sort().join(",");
}
console.log("  pdf fonts:", pdfFonts);
ok(new Set(Object.values(pdfFonts)).size === Object.keys(pdfFonts).length, "each font really changes the PDF");
const padding = () => page.locator(".page-live article").evaluate((a) => getComputedStyle(a).paddingLeft);
const wideBefore = await padding();
await page.getByRole("radio", { name: "衬线", exact: true }).click();
await page.getByRole("radio", { name: "窄", exact: true }).click();
ok(await padding() !== wideBefore, "margins change");
await page.screenshot({ path: `${out}/10-design.png` });
reply = { action: "style", reply: "换字体。", why: "", patch: { font: "song", heading: "bar", margin: "wide" } };
await page.locator(".page-live h2").first().click();
await page.locator(".composer textarea").fill("换成宋体");
await page.keyboard.press("Enter");
await page.locator(".style-changes").waitFor();
ok((await page.locator(".style-changes").innerText()).includes("宋体"), "AI can change fonts too");
await reload(page);
ok(await page.locator(".thread").count() === 1, "a font edit survives a reload");

// One component's formatting
await seed(page, { doc: undefined, threads: undefined, job: undefined });
await reload(page);
const headName = page.locator(".page-live h1");
await headName.click();
await page.getByRole("button", { name: "展开格式" }).click();
await page.getByRole("button", { name: "居中" }).click();
ok(await page.locator(".page-live header").evaluate((h) => getComputedStyle(h).textAlign) === "center", "the toolbar centers one component");
ok(await page.locator(".page-live .summary").evaluate((h) => getComputedStyle(h).textAlign) !== "center", "other components stay as they were");
const templateBefore = await stored(page, "doc").then(d => d.design.template);
await page.getByRole("button", { name: "加粗" }).click();
await page.keyboard.press("Escape");
const secondItem = page.locator(".page-live .item").nth(1);
await secondItem.locator(".sub").click();
ok((await page.locator(".crumbs").innerText()).includes("产品经理"), "a subtitle can be selected by itself");
await page.getByRole("button", { name: "居中" }).click();
const headBox = await secondItem.locator(".item-head").boundingBox();
const subBox = await secondItem.locator(".sub").boundingBox();
ok(Math.abs(subBox.x + subBox.width / 2 - (headBox.x + headBox.width / 2)) < 3, "the subtitle sits in the middle of its row");
await page.getByRole("button", { name: "取消选中" }).click();
await page.screenshot({ path: `${out}/11-node-style.png` });
reply = { action: "node_style", reply: "把职位居中了。", why: "", target: "subtitle", patch: { align: "right" } };
const firstRow = page.locator(".page-live .item").first();
await firstRow.locator(".item-head time").click();
await page.locator(".composer textarea").fill("产品经理文本靠右");
await page.keyboard.press("Enter");
await page.locator(".style-changes").waitFor();
ok(requests.at(-1).includes("node_style"), "the prompt offers local formatting");
ok(/对齐[\s\S]*默认[\s\S]*右对齐/.test(await page.locator(".style-changes").innerText()), "the card shows the alignment it changes from and to");
await page.getByRole("button", { name: "接受", exact: true }).click();
ok(await firstRow.locator(".item-head").evaluate((h) => h.classList.contains("sub-right")), "accepting applies the local style");
const design = await stored(page, "doc").then(d => d.design.template);
ok(design === templateBefore, "local formatting leaves the template alone");
await page.locator(".proposal").getByRole("button", { name: "撤销" }).click();
ok(!(await firstRow.locator(".item-head").evaluate((h) => h.classList.contains("sub-right"))), "revert removes it");
await page.emulateMedia({ media: "print" });
writeFileSync(`${out}/node-style.pdf`, await page.pdf({ preferCSSPageSize: true, printBackground: true }));
await page.emulateMedia({ media: "screen" });
ok(/Pages:\s+1\b/.test(execFileSync("pdfinfo", [`${out}/node-style.pdf`]).toString()), "formatted PDF stays one page");
await reload(page);
ok(await page.locator(".page-live header").evaluate((h) => getComputedStyle(h).textAlign) === "center", "formatting survives a reload");
ok(await page.locator(".thread").count() === 1, "a formatting thread survives a reload");

// Color and weight really land on the page, even in a font with no bold cut.
await page.getByRole("tab", { name: "版式", exact: true }).click();
await page.getByRole("button", { name: /仿宋/ }).click();
await page.getByRole("tab", { name: "内容", exact: true }).click();
reply = { action: "node_style", reply: "已改成红色、加粗并放大", why: "", target: "subtitle", patch: { bold: true, color: "#B4351F" }, unsupported: ["字号"] };
await firstRow.locator(".item-head time").click();
await page.locator(".composer textarea").fill("职位变成红色，加粗，字号放大");
await page.keyboard.press("Enter");
await page.getByText("暂时做不到：字号").waitFor();
const told = (await page.locator(".thread.on .msg.ai").last().allInnerTexts()).join("");
ok(/加粗[\s\S]*文字颜色/.test(told) && told.includes("暂时做不到：字号") && !told.includes("放大"), "the card states only what the patch does, and what it can't");
await page.getByRole("button", { name: "接受", exact: true }).last().click();
const painted = await firstRow.locator(".sub").evaluate((e) => { const c = getComputedStyle(e); return [c.color, c.fontWeight, c.webkitTextStrokeWidth]; });
ok(painted[0] === "rgb(180, 53, 31)" && painted[1] === "700" && parseFloat(painted[2]) > 0, `color and bold land on the subtitle ${painted}`);
await page.keyboard.press("Escape");
await page.getByRole("tab", { name: "版式", exact: true }).click();
await page.getByRole("button", { name: /跟随模板/ }).click();

// A line inside a collapsed entry: the form opens that entry and brings the line into view.
await page.keyboard.press("Escape");
await page.getByRole("tab", { name: "内容", exact: true }).click();
const closed = await page.evaluate(() => {
  const bullets = [...document.querySelectorAll(".page li[data-node]")];
  return bullets.map((b) => b.dataset.node).find((id) => !document.querySelector(`[data-form="${id}"]`));
});
ok(!!closed, "some lines start in collapsed entries");
await page.locator(`.page [data-node="${closed}"]`).click();
await page.waitForFunction((id) => {
  const el = document.querySelector(`[data-form="${id}"]`);
  if (!el) return false;
  const a = el.getBoundingClientRect(), b = document.querySelector(".form").getBoundingClientRect();
  return a.top >= b.top && a.bottom <= b.bottom;
}, closed, { timeout: 2000 });
ok(true, "selecting a line opens its entry and scrolls the form to it");

// Revealed on hover: a disabled move button stays hidden until its row is hovered.
const firstMove = page.getByRole("button", { name: "上移模块" }).first();
await firstMove.scrollIntoViewIfNeeded();
await page.mouse.move(720, 4);
const opacityOf = (l) => l.evaluate((el) => getComputedStyle(el).opacity);
ok(await firstMove.isDisabled() && await opacityOf(firstMove) === "0", "a disabled move button is hidden at rest");
await page.locator(".group-head").first().hover();
ok(await opacityOf(firstMove) === "0.38", "a disabled move button shows dimmed on hover");

// Focus ring: a mouse click on a tab draws none, arrow keys do. Chrome only misjudges a page with no pointer history.
const focusContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const fresh = await focusContext.newPage();
await fresh.goto(page.url());
const tab = (name) => fresh.getByRole("tab", { name, exact: true });
const ring = () => fresh.evaluate(() => {
  const s = getComputedStyle(document.querySelector('[role="tab"][data-state="active"]'));
  return s.outlineStyle === "none" ? "none" : `${s.outlineWidth} ${s.outlineColor}`;
});
await tab("版式").click();
ok(await ring() === "none", "a first click on a tab draws no focus ring");
await tab("版式").click();
await fresh.keyboard.press("ArrowRight");
await fresh.waitForFunction(() => document.activeElement?.textContent === "版本", null, { timeout: 2000 });
const keyRing = await ring();
// Ink, not red: red on this page always means a correction.
ok(await tab("版本").getAttribute("data-state") === "active" && keyRing === "2px rgb(33, 31, 27)", `arrow keys move between tabs with an ink focus ring (${keyRing})`);
await focusContext.close();

ok(errors.length === 0, `no page errors ${errors.join(" | ")}`);
await browser.close();
console.log("FEATURES PASSED");
