import { stored, seed, reload } from "./storage.mjs";
// Interaction and motion details from the design audit, against a mocked DeepSeek API.
import { chromium } from "playwright-core";
import { resolve } from "node:path";

const file = resolve(process.env.REDLINE_HTML ?? "dist/index.html");
const ok = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok - ${m}`); };
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
const line = (page, n) => page.locator(".page-live li").nth(n);
const nodeId = (l) => l.getAttribute("data-node");
const edit = (text) => ({ action: "edit", reply: "改好了。", why: "更具体", after: { text } });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];

async function open(options = {}, { key = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.state = { reply: edit("新的写法。"), hold: null, requests: [] };
  await page.route("https://api.deepseek.com/**", async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 200, headers: cors });
    page.state.requests.push(route.request().postData());
    if (page.state.hold) await page.state.hold;
    return route.fulfill({
      status: 200, headers: { ...cors, "content-type": "application/json" },
      body: JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(page.state.reply) } }] }),
    }).catch(() => {});
  });
  await page.goto(`file://${file}`);
  if (key) {
    await page.evaluate(() => localStorage.setItem("redline.connection.v1", JSON.stringify({ settings: { baseUrl: "https://api.deepseek.com", model: "deepseek-flash" }, key: "sk-test" })));
    await reload(page);
  }
  await page.locator(".page-live").waitFor();
  return page;
}

async function comment(page, n, text) {
  await line(page, n).click();
  await page.locator(".composer textarea").fill(text);
  await page.keyboard.press("Enter");
  await page.locator(".thread.on .proposal.pending").waitFor();
}

const composerValue = (page) => page.locator(".composer textarea").inputValue();
const inCanvas = (page, selector) => page.evaluate((s) => {
  const view = document.querySelector(".canvas").getBoundingClientRect();
  const r = document.querySelector(s).getBoundingClientRect();
  return r.top >= view.top && r.bottom <= view.bottom;
}, selector);
/** Records a value every frame while `act` runs, so short exits can be seen. */
async function sample(page, read, act, ms = 400) {
  await page.evaluate((src) => {
    const fn = new Function(`return (${src})()`);
    window.__samples = [];
    const tick = () => { window.__samples.push(fn()); window.__sampling = requestAnimationFrame(tick); };
    tick();
  }, read.toString());
  await act();
  await page.waitForTimeout(ms);
  return page.evaluate(() => { cancelAnimationFrame(window.__sampling); return window.__samples; });
}

{
  const page = await open({}, { key: false });
  const paper = await page.locator(".page-live").innerText();
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.getByRole("dialog", { name: "Import an existing résumé" }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("tab", { name: "Layout", exact: true }).click();
  await page.getByRole("textbox", { name: "Search templates" }).waitFor();
  await line(page, 0).click();
  await page.getByRole("button", { name: "Edit text", exact: true }).waitFor();
  await page.getByRole("textbox", { name: "Edit request", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  ok(await page.locator("html").getAttribute("lang") === "en", "English updates the page language");
  ok(await page.locator(".page-live").innerText() === paper, "interface language leaves the resume unchanged");
  await reload(page);
  await page.getByRole("button", { name: "中文", exact: true }).click();
  await page.getByRole("button", { name: "导入", exact: true }).waitFor();
  ok(await page.locator("html").getAttribute("lang") === "zh-CN", "the switch persists and can return to Chinese");
  await page.context().close();
}

{
  const page = await open();
  await line(page, 0).click();
  await page.locator(".composer textarea").fill("写了半句");
  await line(page, 5).click();
  ok(await composerValue(page) === "", "another component starts with an empty composer");
  ok(await page.locator(".draft-dot").count() === 1, "the first component shows it has a draft");
  await page.locator(".draft-dot").click();
  ok(await composerValue(page) === "写了半句", "the dot brings the draft back");
  ok(await page.locator(".draft-dot").count() === 0, "the dot goes away while that draft is open");
  await page.keyboard.press("Escape");
  await page.locator(".composer").waitFor({ state: "detached" });
  await line(page, 0).click();
  ok(await composerValue(page) === "写了半句", "Esc keeps the draft");
  await page.locator(".chips button").first().click();
  await page.locator(".thread.on .proposal.pending").waitFor();
  await page.locator(".composer").waitFor({ state: "detached" });
  ok(page.state.requests.at(-1).includes("写了半句，突出成果"), "a chip adds to what was typed");
  ok(await page.locator(".draft-dot").count() === 0, "sending clears the draft");
  await page.context().close();
}

{
  const page = await open();
  await line(page, 0).click();
  const closed = await page.locator(".composer").evaluate((el) => el.offsetHeight);
  ok(closed < 110 && await page.locator(".format").count() === 0, `the composer is compact by default (${closed}px)`);
  const one = await page.locator(".composer textarea").evaluate((el) => el.offsetHeight);
  await page.locator(".composer textarea").fill("一\n二\n三\n四");
  const four = await page.locator(".composer textarea").evaluate((el) => el.offsetHeight);
  ok(four > one * 2, "the input grows with its text");
  await page.locator(".composer textarea").fill("一\n".repeat(30));
  ok(await page.locator(".composer textarea").evaluate((el) => el.offsetHeight) <= 132, "and stops growing");
  await page.locator(".composer textarea").fill("");
  await page.getByRole("button", { name: "展开格式" }).click();
  ok(await page.locator(".format").count() === 1, "T opens the formatting bar");
  ok(await page.locator(".format .color-dot").first().evaluate((el) => el.offsetWidth) === 24, "color dots are 24 wide");
  await reload(page);
  await line(page, 0).click();
  ok(await page.locator(".format").count() === 1, "the formatting bar stays open after a reload");
  ok(await page.getByRole("button", { name: "选中上一级" }).count() === 0, "the parent button is gone");
  const crumbs = await page.locator(".crumbs").innerText();
  ok(/第 1 条/.test(crumbs), `the composer says where it is (${crumbs.replace(/\n/g, " ")})`);
  await page.locator(".crumbs button").first().click();
  ok(!/第 1 条/.test(await page.locator(".crumbs").innerText()), "a crumb selects that level");
  ok(await page.evaluate(() => document.activeElement?.tagName) === "TEXTAREA", "typing still goes to the composer");
  await page.context().close();
}

{
  const page = await open({ viewport: { width: 1280, height: 560 } });
  await page.locator(".zoom").click();
  ok((await page.locator(".zoom").innerText()) === "100%", "the percentage goes to 100%");
  const target = await page.evaluate(() => {
    const canvas = document.querySelector(".canvas");
    const view = canvas.getBoundingClientRect();
    const lines = [...document.querySelectorAll(".page-live li")];
    const n = lines.length - 1;
    canvas.scrollTop += lines[n].getBoundingClientRect().bottom - view.bottom + 40;
    return n;
  });
  await page.waitForTimeout(100);
  await line(page, target).click();
  await page.waitForTimeout(250);
  ok(await page.locator(".composer.above").count() === 1, "the composer flips above a line near the bottom");
  ok(await inCanvas(page, ".composer"), "and is fully visible");
  await page.locator(".composer textarea").fill("看得见");
  ok(await inCanvas(page, ".composer textarea"), "the caret is in view");
  await page.context().close();
}

{
  const page = await open();
  await page.setViewportSize({ width: 1440, height: 620 });
  await comment(page, 0, "第一条");
  await page.evaluate(() => { const c = document.querySelector(".canvas"); c.scrollTop = c.scrollHeight; });
  await page.waitForTimeout(100);
  ok(!(await inCanvas(page, ".pin")), "the pin starts out of view");
  await page.locator(".thread .target").click();
  await page.waitForFunction(() => {
    const view = document.querySelector(".canvas").getBoundingClientRect();
    const pin = document.querySelector(".pin").getBoundingClientRect();
    return pin.top >= view.top && pin.bottom <= view.bottom;
  }, null, { timeout: 2000 });
  ok(true, "opening a comment brings its target into view");
  await page.waitForTimeout(800);
  const before = await page.evaluate(() => document.querySelector(".canvas").scrollTop);
  await page.locator(".proposal").hover();
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => document.querySelector(".canvas").scrollTop) === before, "hovering a proposal never scrolls");
  await page.context().close();
}

{
  const page = await open();
  const name = () => page.locator(".page-live h1").innerText();
  const original = await name();
  await page.getByRole("tab", { name: "版本", exact: true }).click();
  await page.locator(".save-row input").fill("投递版");
  await page.keyboard.press("Enter");
  const rows = page.locator(".version");
  await rows.first().waitFor();
  const count = await rows.count();
  await rows.first().hover();
  await rows.first().getByRole("button", { name: /删除/ }).click();
  ok(await rows.count() === count - 1, "deleting removes the version");
  ok((await page.locator(".toast").innerText()).includes("已删除"), "the toast says so");
  await page.locator(".toast").getByRole("button", { name: "撤销" }).click();
  ok(await rows.count() === count, "undo puts it back");
  await page.getByRole("button", { name: "新建空白简历" }).click();
  await page.waitForFunction((o) => document.querySelector(".page-live h1")?.textContent !== o, original);
  ok(!(await page.locator(".toast").innerText()).includes("可以用撤销退回"), "the toast offers undo instead of explaining it");
  await page.locator(".toast").getByRole("button", { name: "撤销" }).click();
  await page.waitForFunction((o) => document.querySelector(".page-live h1")?.textContent === o, original);
  ok(true, "the toast undoes a replaced resume");
  await page.keyboard.press("Meta+z");
  await page.waitForFunction((o) => document.querySelector(".page-live h1")?.textContent !== o, original);
  ok(true, "and that undo can be undone");
  await page.context().close();
}

{
  const page = await open();
  await comment(page, 0, "第一条");
  const id = await nodeId(line(page, 0));
  const previewed = () => page.evaluate((i) => getComputedStyle(document.querySelector(`.page-live [data-node="${i}"]`)).outlineColor, id);
  await page.mouse.move(2, 2);
  await page.locator(".proposal .actions button").first().focus();
  await page.waitForTimeout(300);
  ok(await previewed() === "rgb(31, 107, 69)", "keyboard focus on accept previews in the --add green");
  await page.locator(".proposal .actions button").first().blur();
  await page.waitForTimeout(300);
  ok(await previewed() !== "rgb(31, 107, 69)", "moving away ends the preview");
  await page.context().close();
}

{
  const page = await open();
  await page.locator(".page-live").focus();
  const id = await nodeId(line(page, 0));
  const steps = await page.evaluate((i) => [...document.querySelectorAll(".page-live [data-node]")].findIndex((el) => el.dataset.node === i), id);
  for (let i = 0; i <= steps; i += 1) await page.keyboard.press("ArrowDown");
  const outline = () => page.evaluate((i) => getComputedStyle(document.querySelector(`.page-live [data-node="${i}"]`)).outlineStyle, id);
  ok(await outline() === "solid", "arrow keys show which component is current");
  await page.keyboard.press("Enter");
  await page.locator(".composer textarea").waitFor();
  ok(await page.evaluate(() => document.activeElement?.tagName) === "TEXTAREA", "Enter opens the composer");
  await page.keyboard.press("Escape");
  ok(await page.evaluate(() => document.activeElement?.classList.contains("page-live")), "Esc returns to the page");
  await page.locator(".composer").waitFor({ state: "detached" });
  ok(await outline() === "solid", "the cursor stays put");
  await page.keyboard.press("Enter");
  await page.keyboard.type("更短");
  await page.keyboard.press("Enter");
  await page.locator(".proposal.pending").waitFor();
  ok(await page.evaluate(() => document.activeElement?.classList.contains("page-live")), "sending returns to the page too");
  await page.locator(".thread .target").focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  ok(await page.evaluate(() => document.activeElement?.closest(".proposal") !== null), "the proposal is reachable by Tab");
  await page.locator(".thread .target").focus();
  await page.keyboard.press("Enter");
  ok(await page.locator(".thread.on").count() === 1, "a comment opens from the keyboard");
  await page.context().close();
}

{
  const page = await open();
  await comment(page, 0, "第一条");
  await comment(page, 1, "第二条");
  const second = await page.locator(".thread").nth(1).getAttribute("data-thread");
  await page.locator(".thread").first().click();
  await page.locator(".thread").first().getByRole("button", { name: "接受", exact: true }).click();
  const next = page.getByRole("button", { name: "下一条待处理" });
  await next.waitFor();
  ok(await next.evaluate((el) => el === document.activeElement), "focus lands on the next-pending button");
  ok(await next.count() === 1, "only one is shown");
  await next.click();
  const card = page.locator(`[data-thread="${second}"]`);
  await card.locator(".actions button").first().waitFor();
  ok(await card.evaluate((el) => el.classList.contains("on")) && await page.locator(".thread").count() === 1, "it opens the next comment, and the decided one moves to 已解决");
  await page.waitForFunction(() => document.activeElement?.closest(".thread.on .proposal.pending"));
  ok(true, "focus moves onto its accept button");
  ok(await next.count() === 0, "the button goes away");
  await page.keyboard.press("Enter");
  await page.locator(".thread.on .proposal.accepted").waitFor();
  ok(await next.count() === 0, "nothing is offered once none are left");
  await page.context().close();
}

{
  const page = await open();
  let release;
  page.state.hold = new Promise((r) => { release = r; });
  await line(page, 0).click();
  await page.locator(".composer textarea").fill("等等");
  await page.keyboard.press("Enter");
  await page.locator(".thinking").waitFor();
  await page.waitForTimeout(100);
  ok((await page.locator(".panel.right > .sr-only").innerText()) === "DeepSeek 正在修改", "screen readers hear the work start");
  await page.locator(".thinking").getByRole("button", { name: "取消" }).click();
  await page.locator(".msg .fail", { hasText: "已取消，可重试。" }).waitFor();
  ok(true, "cancelling leaves a message");
  page.state.hold = null;
  release();
  await page.locator(".thread.on").getByRole("button", { name: "重试" }).click();
  await page.locator(".thread.on .proposal.pending").waitFor();
  ok(true, "and retry works");
  ok(/方案已生成/.test(await page.locator(".panel.right > .sr-only").innerText()), "screen readers hear the result");
  await page.context().close();
}

{
  const page = await open();
  await page.getByRole("button", { name: "导入" }).click();
  await page.waitForTimeout(350);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(350);
  const centers = await sample(page, () => {
    const r = document.querySelector('[role="dialog"]')?.getBoundingClientRect();
    return r ? r.left + r.width / 2 : null;
  }, () => page.getByRole("button", { name: "导入" }).click(), 300);
  const seen = centers.filter((x) => x !== null);
  ok(seen.length > 2 && Math.max(...seen) - Math.min(...seen) < 2, "a dialog appears in place");
  const states = await sample(page, () => document.querySelector('[role="dialog"]')?.dataset.state ?? "gone",
    () => page.keyboard.press("Escape"));
  ok(states.includes("closed"), "a dialog stays while it fades out");
  ok(states.at(-1) === "gone", "and is removed afterwards");

  await line(page, 0).click();
  await page.waitForTimeout(250);
  const composer = await sample(page, () => {
    const el = document.querySelector(".composer");
    return el ? (el.classList.contains("leaving") ? "leaving" : "open") : "gone";
  }, () => page.keyboard.press("Escape"));
  ok(composer.includes("leaving") && composer.at(-1) === "gone", "the composer fades out");

  await page.getByRole("tab", { name: "版本", exact: true }).click();
  await page.getByRole("button", { name: "载入示例" }).click();
  await page.locator(".toast").waitFor();
  const toast = await sample(page, () => {
    const el = document.querySelector(".toast");
    return el ? (el.classList.contains("leaving") ? "leaving" : "open") : "gone";
  }, () => page.locator(".toast").getByRole("button", { name: "撤销" }).click());
  ok(toast.includes("leaving") && toast.at(-1) === "gone", "the toast leaves the way it came");
  await page.context().close();
}

{
  const page = await open();
  const zoom = () => page.locator(".zoom").innerText();
  await page.locator(".zoom").click();
  ok(await zoom() === "100%", "the percentage toggles to 100%");
  await page.locator(".zoom").click();
  ok(await zoom() === "87%", "and on to fit width");
  const canvas = await page.locator(".canvas").boundingBox();
  const panel = await page.locator(".panel.right").boundingBox();
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + 300);
  const under = () => page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("[data-node]")?.dataset.node, [canvas.x + canvas.width / 2, canvas.y + 300]);
  const before = await under();
  const zoomed = page.evaluate(() => devicePixelRatio);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  await page.waitForFunction(() => document.querySelector(".zoom").textContent !== "87%");
  ok(parseInt(await zoom()) > 87, "ctrl-wheel zooms the canvas");
  ok(await page.evaluate(() => devicePixelRatio) === await zoomed, "and not the browser");
  const after = await page.locator(".panel.right").boundingBox();
  ok(after.width === panel.width, "the panels stay the same size");
  ok(await under() === before, `the point under the cursor stays put (${before})`);
  await page.context().close();
}

{
  const page = await open();
  ok((await page.locator(".save-state").innerText()) === "已保存在本机", "the toolbar says where work is kept");
  const color = (selector) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).color);
  const muted = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--muted").trim());
  ok(muted === "#6b6863", "muted text is darker");
  const title = await page.locator(".group h3, .group-title").first().evaluate((el) => {
    const s = getComputedStyle(el);
    return `${s.fontSize}/${s.fontWeight}`;
  });
  ok(title === "14px/600", "group titles lead the panel");
  ok(await page.locator(".form:not([hidden])").evaluate((el) => getComputedStyle(el).animationName) === "none", "switching tabs has no fade");
  await comment(page, 0, "第一条");
  const entrance = () => page.locator(".thread").evaluate((el) => getComputedStyle(el).animationName);
  ok(await entrance() === "fade-up", "a new card comes in");
  await page.waitForTimeout(1100);
  await page.getByRole("tab", { name: /已解决/ }).click();
  await page.getByRole("tab", { name: /批注/ }).click();
  ok(await entrance() === "none", "cards don't replay on tab switches");
  await page.locator(".proposal").getByRole("button", { name: "接受", exact: true }).click();

  await page.getByRole("tab", { name: "版式", exact: true }).click();
  await page.getByRole("tab", { name: "内容", exact: true }).click();
  const add = page.locator(".add").first();
  const box = await add.evaluate((el) => {
    const after = getComputedStyle(el, "::after");
    return el.offsetHeight + parseFloat(after.top) * -2;
  });
  ok(box >= 24, `the add button's hit area is ${box}px tall`);

  const overflowDoc = await stored(page, "doc");
  const it = overflowDoc.resume.sections[0].items[0];
  for (let i = 0; i < 40; i += 1) it.bullets.push({ id: `extra${i}`, text: "一条很长的内容，用来把简历撑到第二页。" });
  await seed(page, { doc: overflowDoc });
  await reload(page);
  await page.locator(".fit.over").waitFor();
  ok(await color(".fit.over") === "rgb(138, 87, 7)", "the page overflow warning is amber, not the red pen");
  await page.context().close();
}

{
  const page = await open();
  await page.getByRole("button", { name: "缩小" }).hover();
  const content = page.locator('[data-radix-popper-content-wrapper] > *').first();
  await content.waitFor();
  const origin = await content.evaluate((el) => getComputedStyle(el).transformOrigin);
  const side = await content.getAttribute("data-side");
  const [, y] = origin.split(" ").map(parseFloat);
  const height = await content.evaluate((el) => el.offsetHeight);
  ok(side === "top" ? y >= height - 1 : y <= 1, `a tooltip grows from its trigger (${origin}, ${side})`);
  // Radix ignores a trigger until the pointer has moved past the last one, so move the way a real mouse does.
  const next = await page.getByRole("button", { name: "放大" }).boundingBox();
  await page.mouse.move(next.x + next.width / 2, next.y + next.height / 2, { steps: 8 });
  await page.mouse.move(next.x + next.width / 2 + 2, next.y + next.height / 2, { steps: 2 });
  const instant = page.locator('[data-radix-popper-content-wrapper] > [data-state="instant-open"]');
  await instant.waitFor();
  ok(await instant.evaluate((el) => getComputedStyle(el).animationName) === "none", "the next tooltip skips the animation");
  await page.context().close();
}

{
  const page = await open({ reducedMotion: "reduce" });
  let release;
  page.state.hold = new Promise((r) => { release = r; });
  await line(page, 0).click();
  await page.locator(".composer textarea").fill("慢一点");
  await page.keyboard.press("Enter");
  const pin = page.locator(".pin .spin");
  await pin.waitFor();
  ok(await pin.evaluate((el) => getComputedStyle(el).animationName) === "breathe", "reduced motion keeps a calm working signal");
  const thinking = await page.locator(".thinking span").evaluate((el) => {
    const s = getComputedStyle(el);
    return { name: s.animationName, color: s.color };
  });
  ok(thinking.name === "none" && thinking.color !== "rgba(0, 0, 0, 0)", "the status text stays readable");
  page.state.hold = null;
  release();
  await page.locator(".thread.on .proposal.pending").waitFor();
  const id = await nodeId(line(page, 0));
  const accept = page.locator(".proposal").getByRole("button", { name: "接受", exact: true });
  const names = await sample(page, new Function(`return () => getComputedStyle(document.querySelector('.page-live [data-node="${id}"]')).animationName`)(),
    () => accept.click(), 200);
  ok(names.includes("redline-calm"), "an accepted change still flashes, without the sweep");
  await page.getByRole("button", { name: "导入" }).click();
  const moved = await page.locator('[role="dialog"]').evaluate((el) => getComputedStyle(el).getPropertyValue("--tw-enter-scale"));
  ok(moved.trim() === "1", "dialogs don't scale");
  await page.context().close();
}

{
  const page = await open({ viewport: { width: 1180, height: 820 }, isMobile: true, hasTouch: true });
  ok(await page.evaluate(() => matchMedia("(hover: none)").matches), "this is a touch screen");
  ok(await page.locator(".entry-tools").first().evaluate((el) => getComputedStyle(el).opacity) === "1", "sort and delete are visible on touch");
  await page.context().close();
}

ok(errors.length === 0, `no page errors ${errors.join(" | ")}`);
await browser.close();
console.log("INTERACTIONS PASSED");
