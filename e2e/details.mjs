import { stored, seed, reload } from "./storage.mjs";
// The second polish pass: focus, motion timing, the toast's clock and the folding left panel.
import { chromium } from "playwright-core";
import { resolve } from "node:path";

const file = resolve(process.env.REDLINE_HTML ?? "dist/index.html");
const ok = (c, m) => { if (!c) throw new Error(`FAIL: ${m}`); console.log(`ok - ${m}`); };
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
const INK = "rgb(33, 31, 27)";
const PEN = [180, 53, 31];

const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];

async function open({ key = true, width = 1440, height = 900 } = {}) {
  const page = await (await browser.newContext({ viewport: { width, height } })).newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.reply = () => ({ action: "edit", reply: "改好了。", why: "更具体", after: { text: "新的写法。" } });
  await page.route("https://api.deepseek.com/**", async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 200, headers: cors });
    const content = JSON.stringify(await page.reply(JSON.parse(route.request().postData())));
    return route.fulfill({
      status: 200, headers: { ...cors, "content-type": "application/json" },
      body: JSON.stringify({ choices: [{ finish_reason: "stop", message: { content } }] }),
    });
  });
  await page.goto(`file://${file}`);
  if (key) {
    await page.evaluate(() => localStorage.setItem("redline.connection.v1", JSON.stringify({ settings: { baseUrl: "https://api.deepseek.com", model: "deepseek-flash" }, key: "sk-test" })));
    await reload(page);
  }
  await page.locator(".page-live").waitFor();
  return page;
}

/** Records `read()` every frame while `act` runs. */
async function sample(page, read, act, ms = 300) {
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

/** [r, g, b, alpha] from any of the ways Chrome writes a computed color; mid-transition it uses oklab. */
function rgba(color) {
  const alpha = (a) => (a === undefined ? 1 : +a);
  let m = color.match(/rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)/);
  if (m) return [+m[1], +m[2], +m[3], alpha(m[4])];
  m = color.match(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/);
  if (m) return [m[1] * 255, m[2] * 255, m[3] * 255, alpha(m[4])];
  m = color.match(/oklab\(([-\d.]+) ([-\d.]+) ([-\d.]+)(?: \/ ([\d.]+))?\)/);
  if (!m) throw new Error(`unknown color ${color}`);
  const [L, a, b] = [+m[1], +m[2], +m[3]];
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const gamma = (x) => 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
  return [
    gamma(4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s),
    gamma(-1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s),
    gamma(-0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s),
    alpha(m[4]),
  ];
}
const isPen = (c) => c && PEN.every((v, i) => Math.abs(c[i] - v) < 2);

async function comment(page, n, text) {
  await page.locator(".page-live li").nth(n).click();
  await page.locator(".composer textarea").fill(text);
  await page.keyboard.press("Enter");
  await page.locator(".thread.on .proposal.pending").waitFor();
}

{
  const page = await open();
  const id = await page.locator(".page-live li").nth(2).getAttribute("data-node");
  const outline = new Function(`return () => getComputedStyle(document.querySelector('.page-live [data-node="${id}"]')).outlineColor`)();
  const hovered = (await sample(page, outline, () => page.locator(".page-live li").nth(2).hover(), 250)).map(rgba).filter((c) => c[3] > 0);
  const alphas = new Set(hovered.map((c) => c[3].toFixed(2)));
  ok(hovered.length > 0 && hovered.every(isPen) && alphas.size > 1, `a hover outline fades in from nothing, never from the text color (${alphas.size} steps)`);

  await page.mouse.move(5, 5);
  await page.waitForTimeout(300);
  await page.locator(".page-live").focus();
  const first = await page.locator(".page-live [data-node]").first().getAttribute("data-node");
  const current = new Function(`return () => getComputedStyle(document.querySelector('.page-live [data-node="${first}"]')).outlineColor`)();
  const roamed = (await sample(page, current, () => page.keyboard.press("ArrowDown"), 200)).map(rgba).filter((c) => c[3] > 0);
  ok(roamed.length > 0 && roamed.every((c) => isPen(c) && c[3] === 1), "arrow keys move the outline without a fade");

  await page.getByLabel("姓名").focus();
  const border = await page.getByLabel("姓名").evaluate((el) => getComputedStyle(el).borderColor);
  ok(border === INK, `a focused field turns ink at once, not red and not fading (${border})`);

  const shadows = await page.evaluate(() => {
    const found = [];
    const walk = (rules) => {
      for (const r of rules) {
        if (r.cssRules) walk(r.cssRules);
        for (const prop of ["box-shadow", "--tw-shadow"]) { const v = r.style?.getPropertyValue(prop); if (v) found.push(v); }
      }
    };
    for (const sheet of document.styleSheets) walk(sheet.cssRules);
    return found;
  });
  const black = shadows.filter((v) => /#0{6}(?!00)|#0{3}(?!0)|rgba?\(0,? 0,? 0(?!(?:,| \/) ?0[),])/i.test(v));
  ok(black.length === 0 && shadows.some((v) => /#1c1917/i.test(v)), `every shadow is the frame's warm stone, none Tailwind's black (${black.join(" | ") || "0 black"})`);
  await page.context().close();
}

{
  const page = await open({ key: false });
  // The key's button lives in the comments panel's head, so the whole frame is checked, not just the top bar.
  // Secondary buttons are white and raised now, so "filled" means the primary's ink fill.
  const filled = () => page.locator(".topbar button, .panel-head button").evaluateAll((els, ink) => els
    .filter((el) => getComputedStyle(el).backgroundColor === ink)
    .map((el) => el.textContent.trim()), INK);
  ok(JSON.stringify(await filled()) === JSON.stringify(["填写 API Key"]), "without a key, the key is the one filled button");
  await page.evaluate(() => localStorage.setItem("redline.connection.v1", JSON.stringify({ settings: { baseUrl: "https://api.deepseek.com", model: "deepseek-flash" }, key: "sk-test" })));
  await reload(page);
  await page.locator(".page-live").waitFor();
  ok(JSON.stringify(await filled()) === JSON.stringify(["导出 PDF"]), "with a key, export is");

  await comment(page, 0, "第一条");
  const entrance = (selector) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).animationName);
  ok(await entrance(".thread") === "fade-up" && await entrance(".msg.ai") === "fade-up", "a new card and its answer come in");
  await page.waitForTimeout(1100);
  await page.getByRole("tab", { name: /已解决/ }).click();
  await page.getByRole("tab", { name: /批注/ }).click();
  ok(await entrance(".thread") === "none" && await entrance(".msg.ai") === "none", "switching tabs doesn't replay them");

  page.reply = (body) => {
    const ids = [...body.messages[1].content.matchAll(/\[([a-z]+_[a-z0-9]+)\]/g)].map((m) => m[1]);
    return {
      summary: "基本匹配。", missing: [],
      edits: [3, 5, 6].map((i) => ({ id: ids[i], requirement: "要求", why: "贴近岗位", text: "更清楚地记录相关工作。" })),
    };
  };
  await page.locator(".pin").evaluate((el) => { el.dataset.old = ""; });
  await page.getByRole("button", { name: "按岗位定制" }).click();
  await page.locator(".dialog textarea").fill("招聘产品经理。");
  await page.getByRole("button", { name: "开始审阅" }).click();
  await page.locator(".job").waitFor();
  const delays = (selector) => page.locator(selector).evaluateAll((els) => els.map((el) => getComputedStyle(el).animationDelay).sort());
  ok(JSON.stringify(await delays(".thread.fresh")) === JSON.stringify(["0.04s", "0.08s", "0s"]), "a batch of new cards arrives one after another");
  ok(JSON.stringify(await delays(".pin:not([data-old])")) === JSON.stringify(["0.04s", "0.08s", "0s"]), "and so do their pins, top to bottom");
  ok(await page.locator(".pin[data-old]").count() === 1, "while the pin that was already there stays put instead of popping again");

  const batch = page.getByRole("button", { name: /未发现明显风险的修改/ });
  const safe = Number((await batch.innerText()).match(/接受 (\d+) 处/)[1]);
  const shown = await page.locator(".thread").count();
  await batch.click();
  await page.waitForTimeout(150);
  const said = (await page.locator(".toast").allInnerTexts()).join("");
  ok(said.includes(`已接受 ${safe} 处，批注移到了「已解决」`) && await page.locator(".thread").count() === shown - safe,
    `accepting the safe edits in one go says where their comments went (${said || "no toast"})`);
  await page.context().close();
}

{
  const page = await open({ key: false });
  await page.getByRole("tab", { name: "版本", exact: true }).click();
  const saveAs = async (name) => { await page.locator(".save-row input").fill(name); await page.locator(".save-row button").click(); };
  const toast = page.locator(".toast");
  await saveAs("一");
  await toast.waitFor();
  await toast.evaluate((el) => { el.dataset.old = ""; });
  await saveAs("二");
  ok(await toast.evaluate((el) => el.dataset.old === undefined) && (await toast.innerText()).includes("二"), "a new notice replaces the old toast with its own entrance");
  await toast.hover();
  await page.waitForTimeout(4600);
  ok(await toast.count() === 1, "the toast waits while the pointer rests on it");
  await page.mouse.move(700, 300);
  const hide = (hidden) => page.evaluate((h) => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => h });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
  await hide(true);
  await page.waitForTimeout(4600);
  ok(await toast.count() === 1, "and while the tab is in the background");
  await hide(false);
  await toast.waitFor({ state: "detached", timeout: 6000 });
  ok(true, "then finishes the time it had left");
  await page.context().close();
}

{
  const page = await open();
  const drift = await page.evaluate(() => {
    const box = (el) => { const r = document.createRange(); r.selectNodeContents(el); const b = r.getBoundingClientRect(); return [b.left, b.top]; };
    return [...document.querySelectorAll('[role="tablist"] > .seg-face')].flatMap((face) => {
      const real = [...face.parentElement.querySelectorAll('[role="tab"]')];
      return [...face.children].map((span, i) => Math.max(...box(span).map((v, k) => Math.abs(v - box(real[i])[k]))));
    });
  });
  const edge = () => page.locator(".panel.left .panel-head").evaluate((el) => {
    const shadow = getComputedStyle(el).boxShadow;
    return shadow === "none" || shadow.startsWith("rgba(0, 0, 0, 0)") ? "none" : shadow;
  });
  ok(await edge() === "none", "with nothing scrolled under the tabs, there's no line beneath them");
  const form = page.locator(".panel.left .form:not([hidden])");
  await form.evaluate((el) => { el.scrollTop = 40; });
  await page.waitForTimeout(250);
  ok((await edge()).startsWith("rgba(28, 25, 23, 0.1)"), "scrolling the form draws it");
  await page.getByRole("tab", { name: "版本", exact: true }).click();
  await page.waitForTimeout(250);
  ok(await edge() === "none", "and a tab that starts at the top has none, whatever the last tab did");
  await page.getByRole("tab", { name: "内容", exact: true }).click();
  await page.waitForTimeout(300);
  ok(await form.evaluate((el) => el.scrollTop) === 40 && (await edge()).startsWith("rgba(28, 25, 23, 0.1)"),
    "coming back to a tab finds it where it was left, line and all");
  ok(drift.length === 5 && Math.max(...drift) < 0.5, `the thumb redraws each label exactly over the real one (${Math.max(...drift).toFixed(2)}px)`);
  await page.getByRole("tab", { name: "版本", exact: true }).click();
  const mid = await page.evaluate(() => {
    const plate = document.querySelector(".panel.left .seg-plate");
    const face = document.querySelector(".panel.left .seg-face");
    [plate, face].flatMap((el) => el.getAnimations()).forEach((a) => { a.pause(); a.currentTime = 90; });
    const left = face.getBoundingClientRect();
    const m = getComputedStyle(face).clipPath.match(/inset\(0px [\d.]+% 0px ([\d.]+)%/);
    const moving = plate.getBoundingClientRect().left - left.left;
    return { moving, clip: m ? (+m[1] / 100) * left.width : NaN, width: left.width };
  });
  ok(mid.moving > 1 && mid.moving < mid.width / 3 * 2 - 1 && Math.abs(mid.moving - mid.clip) < 1,
    `halfway through a switch the plate and the dark label are in the same place (${mid.moving.toFixed(1)} vs ${mid.clip.toFixed(1)})`);
  await page.context().close();
}

{
  const page = await open({ width: 1280, height: 800 });
  const zoom = () => page.locator("button.zoom").innerText();
  const toggleAt = async (name) => JSON.stringify(await page.getByRole("button", { name }).boundingBox());
  const before = await toggleAt("收起左栏");
  const zoomBefore = await zoom();
  const [leftW, rightW, spare] = await page.evaluate(() => {
    const canvas = document.querySelector(".canvas");
    return [document.querySelector(".panel.left").offsetWidth, document.querySelector(".panel.right").offsetWidth,
      canvas.clientWidth - document.querySelector(".stage").offsetWidth];
  });
  ok(leftW < 312 && rightW < 336 && parseInt(zoomBefore) >= 70 && spare >= 0,
    `a narrower window narrows the panels so the page stays readable (${leftW}px and ${rightW}px, page at ${zoomBefore}, ${spare}px spare)`);
  await page.getByRole("button", { name: "收起左栏" }).click();
  ok(await toggleAt("展开左栏") === before, "the toggle stays where it was when the panel folds");
  ok(parseInt(await zoom()) > parseInt(zoomBefore), `the page takes the room (${zoomBefore} to ${await zoom()})`);
  ok(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")) === "展开左栏", "and keeps focus on the toggle");

  await page.getByRole("button", { name: "版式" }).click();
  ok(await page.locator('.panel.left [role="tab"][data-state="active"]').innerText() === "版式", "a dock icon opens its own tab");
  ok(await page.evaluate(() => document.activeElement?.textContent) === "版式", "and hands focus to it");

  await page.getByRole("tab", { name: "内容", exact: true }).click();
  await page.getByLabel("姓名").focus();
  await page.keyboard.press("Meta+Backslash");
  ok(await page.locator(".panel.left.docked").count() === 1, "⌘\\ folds the panel from inside a field");
  await page.waitForTimeout(400);
  ok(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")) === "展开左栏"
    && await page.locator("[data-radix-popper-content-wrapper]").count() === 0, "focus goes to the toggle without opening its tooltip");

  await reload(page);
  await page.locator(".page-live").waitFor();
  ok(await page.locator(".panel.left.docked").count() === 1, "the fold survives a reload");
  const docked = await zoom();
  await page.keyboard.press("Meta+Backslash");
  ok(parseInt(await zoom()) < parseInt(docked), `the layout's own zoom follows the panel (${docked} to ${await zoom()})`);
  await page.keyboard.press("Meta+Backslash");
  await page.getByRole("button", { name: "放大" }).click();
  const chosen = await zoom();
  await page.keyboard.press("Meta+Backslash");
  ok(await zoom() === chosen, `a zoom the user picked stays when the panel opens (${chosen})`);
  await page.keyboard.press("Meta+Backslash");
  await page.getByRole("button", { name: "缩小" }).click();
  const same = await zoom();
  await page.keyboard.press("Meta+Backslash");
  ok(same === docked && await zoom() === same, `and stays even when it matches the layout's own (${same})`);

  await page.getByRole("button", { name: "放大" }).hover();
  await page.locator("[data-radix-popper-content-wrapper]").waitFor();
  await page.emulateMedia({ media: "print" });
  ok(await page.locator("[data-radix-popper-content-wrapper]").evaluate((el) => getComputedStyle(el).display) === "none", "an open tooltip never prints");
  await page.context().close();
}

{
  const page = await open({ key: false });
  const email = page.getByLabel("邮箱");
  ok(await email.evaluate((el) => el.value.length > 15 && el.scrollWidth <= el.clientWidth), "a full email address shows whole in its field");
  const second = await page.locator(".empty.guide li").first().evaluate((li) => {
    const text = [...li.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
    const range = document.createRange();
    const top = (i) => { range.setStart(text, i); range.setEnd(text, i + 1); return range.getBoundingClientRect().top; };
    const first = top(0);
    for (let i = 1; i < text.length; i++) if (top(i) > first + 4) return text.textContent.slice(i);
    return "";
  });
  ok(second.startsWith("或"), `the first guide step wraps at its comma (second line: ${second})`);
  await page.context().close();
}

{
  const page = await open();
  const zoom = () => page.locator("button.zoom").innerText();
  const sideways = () => page.locator(".canvas").evaluate((el) => el.scrollWidth - el.clientWidth);
  const start = await zoom();
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.waitForTimeout(150);
  ok(parseInt(await zoom()) < parseInt(start) && await sideways() === 0, `the layout's zoom follows the window too, and the page still fits (${start} to ${await zoom()})`);
  await page.getByRole("button", { name: "放大" }).click();
  const chosen = await zoom();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(150);
  ok(await zoom() === chosen, `a zoom the user picked stays when the window grows (${chosen})`);
  await page.locator("button.zoom").click();
  await page.locator("button.zoom").click();
  const fit = await zoom();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(150);
  ok(parseInt(await zoom()) < parseInt(fit) && await sideways() === 0, `fitting the width keeps fitting it (${fit} to ${await zoom()})`);

  await page.getByRole("tab", { name: "内容", exact: true }).click();
  await page.locator(".panel.left .form:not([hidden]) [aria-expanded=false]").first().click();
  const opened = await page.locator(".panel.left .form:not([hidden]) [aria-expanded=true]").count();
  await page.getByRole("tab", { name: "版式", exact: true }).click();
  await page.getByRole("tab", { name: "内容", exact: true }).click();
  ok(await page.locator(".panel.left .form:not([hidden]) [aria-expanded=true]").count() === opened, `entries opened on a tab stay open across a switch (${opened})`);

  // The summary belongs to no entry, so selecting it opens nothing and only the tab coming back can reveal it.
  await page.locator(".panel.left .form:not([hidden])").evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await page.getByRole("tab", { name: "版式", exact: true }).click();
  const summary = page.locator(".page-live > * > p[data-node]").first();
  const id = await summary.getAttribute("data-node");
  await summary.click();
  await page.waitForTimeout(700);
  const seen = await page.evaluate((id) => {
    const form = document.querySelector(".panel.left .form:not([hidden])");
    const field = form?.querySelector(`[data-form="${id}"]`)?.getBoundingClientRect();
    const view = form?.getBoundingClientRect();
    return !!field && field.top >= view.top - 1 && field.bottom <= view.bottom + 1;
  }, id);
  ok(seen, "selecting on the page while another tab shows brings 内容 up at that field");

  await page.locator(".panel.left .form:not([hidden])").evaluate((el) => { el.scrollTop = 0; });
  const deep = await page.evaluate(() => [...document.querySelectorAll(".page-live li[data-node]")].map((b) => b.dataset.node)
    .find((id) => !document.querySelector(`.form [data-form="${id}"]`)));
  await page.locator(`.page-live [data-node="${deep}"]`).click();
  await page.waitForTimeout(700);
  const gap = await page.evaluate((id) => {
    const field = document.querySelector(`.form [data-form="${id}"]`).getBoundingClientRect();
    const view = document.querySelector(".panel.left .form:not([hidden])").getBoundingClientRect();
    return Math.min(field.top - view.top, view.bottom - field.bottom);
  }, deep);
  ok(gap >= 8, `a field brought into view stops short of the panel's edge (${gap.toFixed(1)}px)`);
  await page.context().close();
}

{
  // At 100% in a short window the page's last lines can reach the bottom of the view, which flips the composer.
  const page = await open({ key: false, width: 1280, height: 560 });
  await page.locator(".zoom").click();
  const place = (n, at, selector = ".page-live .item li") => page.evaluate(([n, at, selector]) => {
    const canvas = document.querySelector(".canvas");
    const view = canvas.getBoundingClientRect();
    const r = document.querySelectorAll(selector)[n].getBoundingClientRect();
    canvas.scrollTop += at === "top" ? r.top - view.top - 60 : r.bottom - view.bottom + 40;
  }, [n, at, selector]);
  const measure = () => page.evaluate(() => {
    const composer = document.querySelector(".composer");
    const c = composer.getBoundingClientRect();
    const above = composer.classList.contains("above");
    const edge = above ? c.bottom : c.top;
    const cut = [];
    const range = document.createRange();
    const walker = document.createTreeWalker(document.querySelector(".page-live"), NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim()) continue;
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) {
        if (r.right > c.left && r.left < c.right && r.top < edge - 0.5 && edge + 0.5 < r.bottom) cut.push(node.textContent.trim().slice(0, 8));
      }
    }
    // The selected node is the one with a full-strength ring; it reaches its offset plus its drawn width past the node.
    const node = [...document.querySelectorAll(".page-live [data-node]")].find((el) => getComputedStyle(el).outlineColor === "rgb(180, 53, 31)");
    const t = node.getBoundingClientRect();
    const s = getComputedStyle(node);
    const ringLeft = t.left - (parseFloat(s.outlineOffset) + parseFloat(s.outlineWidth)) * (t.width / node.offsetWidth);
    return { above, cut, drift: above ? t.top - c.bottom : c.top - t.bottom, offset: c.left - ringLeft };
  });
  for (const tpl of [0, 2]) {
    await page.getByRole("tab", { name: "版式", exact: true }).click();
    await page.locator(".tpl").nth(tpl).click();
    await page.getByRole("tab", { name: "内容", exact: true }).click();
    const last = (await page.locator(".page-live .item li").count()) - 2;
    for (const [n, at] of [[1, "top"], [last, "bottom"]]) {
      await page.keyboard.press("Escape");
      await place(n, at);
      await page.locator(".page-live .item li").nth(n).click();
      await page.locator(".composer").evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
      const m = await measure();
      const where = `template ${tpl}, line ${n}, ${m.above ? "above" : "below"}`;
      ok(m.above === (at === "bottom"), `${where}: the composer opens on the side with room`);
      ok(m.cut.length === 0, `${where}: its edge runs through no line of text (${m.cut.join(", ") || "none"})`);
      const maxDrift = tpl === 2 && at === "top" ? 42 : 34;
      ok(m.drift >= 10 && m.drift < maxDrift, `${where}: it uses the nearest clear gap (${m.drift.toFixed(1)}px)`);
      ok(Math.abs(m.offset) < 0.5, `${where}: its left edge continues the selection ring's (${m.offset.toFixed(2)}px)`);
    }
    if (tpl === 2) {
      await page.keyboard.press("Escape");
      await place(1, "top", ".page-live .contact-list li");
      await page.locator(".page-live .contact-list li").nth(1).click();
      await page.locator(".composer").evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)));
      const m = await measure();
      ok(m.cut.length === 0, `split contact composer: its edge runs through no line of text (${m.cut.join(", ") || "none"})`);
      ok(m.drift >= 10 && m.drift < 42, `split contact composer finds the nearest clear gap (${m.drift.toFixed(1)}px)`);
    }
  }
  await page.context().close();
}

{
  // Text boxes size themselves to their text when they mount, so the review has to be at its full width by then.
  const page = await open();
  const long = "五年 B 端产品经验，擅长需求分析和跨团队沟通，做事踏实，学习能力强，能独立推动跨部门项目从立项到上线。";
  page.reply = () => ({ basics: { name: "王小明" }, summary: long, sections: [{ kind: "experience", title: "工作经历", items: [{ title: "星河科技", subtitle: "", period: "", bullets: [long] }] }] });
  await page.getByRole("button", { name: "导入", exact: true }).click();
  await page.locator(".import-text").fill(`王小明\n${long}`);
  const review = page.getByRole("dialog", { name: "确认导入" });
  const widths = await sample(page, () => document.querySelector(".dialog")?.offsetWidth ?? 0, async () => {
    await page.getByRole("button", { name: "开始整理" }).click();
    await review.waitFor();
  });
  const steps = [...new Set(widths)].filter(Boolean);
  ok(steps.length === 2, `the dialog widens into the review in one step (${steps.join(" → ")})`);
  const spare = await review.locator("textarea:not([readonly])").evaluateAll((els) => els.map((el) => {
    const { height } = el.style;
    const shown = el.offsetHeight;
    el.style.height = "auto";
    const needed = el.scrollHeight + 2;
    el.style.height = height;
    return shown - needed;
  }));
  ok(spare.length === 2 && spare.every((px) => Math.abs(px) <= 1), `the review's text boxes fit their text (${spare.join(", ")}px spare)`);
  await page.context().close();
}

{
  const page = await open({ key: false });
  await page.getByRole("tab", { name: /已解决/ }).click();
  const hint = (await page.locator(".panel.right .empty .hint").allInnerTexts()).join("");
  ok(hint.startsWith("接受或拒绝方案后"), `the 已解决 tab says how a comment gets there (${hint || "nothing"})`);

  const saved = () => stored(page, "doc").then(d => d.resume);
  const kind = (sections, k) => sections.find((s) => s.kind === k);
  const { sections } = await saved();
  const form = page.locator(".panel.left .form:not([hidden])");
  const entry = (it) => form.locator(`.entry[data-form="${it.id}"]`);
  const unfold = async (it) => {
    const toggle = entry(it).locator(".entry-toggle");
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  };
  const [school] = kind(sections, "education").items;
  const [tools, language] = kind(sections, "skill").items;
  await unfold(school);
  await unfold(tools);
  const repeats = await entry(school).locator("input").evaluateAll((els, title) => els.filter((el) => el.value === title).length, school.title);
  ok(repeats === 1, `an open entry's name is not repeated as a field (${repeats} boxes hold it)`);
  const fields = async (it) => [await entry(it).locator(".entry-title").getAttribute("aria-label"), ...await entry(it).locator(".field > span").allInnerTexts()];
  const named = [await fields(school), await fields(tools)];
  ok(JSON.stringify(named) === JSON.stringify([["学校名称", "专业", "时间"], ["技能类别"]]), `each kind of entry names its own fields (${named.join(" / ")})`);
  const folded = (await entry(language).locator(".entry-sub").allInnerTexts()).join("");
  ok(folded === language.bullets.map((b) => b.text).join(" "), "a folded skill shows its lines");

  const work = kind(sections, "experience");
  await form.locator(`section[data-form="${work.id}"]`).getByRole("button", { name: "添加条目" }).click();
  await form.locator(`section[data-form="${work.id}"] .entry`).last().locator(".entry-title").click();
  await page.keyboard.type("星河科技");
  const typed = kind((await saved()).sections, "experience").items.at(-1).title;
  ok(typed === "星河科技" && await page.evaluate(() => document.activeElement?.classList.contains("entry-title")), `naming a new entry keeps it open (${typed})`);

  const dot = (selector) => page.locator(`.page-live ${selector}`).first().evaluate((el) => {
    const s = getComputedStyle(el, "::before");
    return [s.content, s.width, s.height, s.borderRadius, s.backgroundColor].join(" ");
  });
  ok(await dot(".skill") === await dot(".item li"), `a skill row carries the same dot as the lines above it (${await dot(".skill")})`);
  await entry(tools).getByRole("button", { name: "添加一条" }).click();
  await entry(tools).locator(".bullet textarea").last().fill("Notion、飞书");
  const gap = await page.locator(`.page-live [data-node="${tools.id}"] span`).evaluateAll((els) => els[1].getBoundingClientRect().left - els[0].getBoundingClientRect().right);
  ok(gap > 4, `a skill's lines don't run together (${gap.toFixed(1)}px apart)`);

  await page.getByRole("tab", { name: "版式", exact: true }).click();
  await page.locator(".tpl", { hasText: "书卷" }).click();
  ok(await dot(".skill") === await dot(".item li"), `in 书卷 the skill dot takes the accent too (${await dot(".skill")})`);

  await page.locator(`.page-live [data-node="${tools.id}"] b`).click();
  await page.getByRole("button", { name: "展开格式" }).click();
  await page.getByRole("button", { name: "居中" }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "版式", exact: true }).click();
  await page.locator(".tpl", { hasText: "分栏" }).click();
  const lead = await page.locator(`.page-live [data-node="${tools.id}"]`).evaluate((row) => {
    const box = row.getBoundingClientRect();
    const scale = box.height / row.offsetHeight;
    return (row.querySelector("b").getBoundingClientRect().top - box.top) / (parseFloat(getComputedStyle(row).lineHeight) * scale);
  });
  ok(lead < 0.5, `in 分栏 a centered skill keeps its dot beside its label (label ${lead.toFixed(2)} lines down)`);
  await page.context().close();
}

{
  const page = await open();
  for (const [i, ask] of [[0, "第一条"], [1, "第二条"]]) {
    await page.locator(".page-live li").nth(i).click();
    await page.locator(".composer textarea").fill(ask);
    await page.keyboard.press("Enter");
    await page.locator(".thread").nth(i).locator(".proposal.pending").waitFor();
  }
  const card = page.locator(".thread").first();
  const button = card.getByRole("button", { name: "标记为已解决" });
  await card.hover();
  const b = await button.boundingBox();
  // Radix ignores a trigger until the pointer has moved across it, so move the way a real mouse does.
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.move(b.x + b.width / 2 + 1, b.y + b.height / 2, { steps: 2 });
  const tip = page.locator("[data-radix-popper-content-wrapper] > *", { hasText: "标记为已解决" });
  await tip.waitFor();
  await tip.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  const [shift, clear, aim] = await tip.evaluate((el, b) => {
    const t = el.getBoundingClientRect();
    const arrow = el.querySelector("svg")?.getBoundingClientRect();
    const middle = b.x + b.width / 2;
    return [middle - (t.left + t.width / 2), innerWidth - t.right, arrow ? arrow.left + arrow.width / 2 - middle : NaN];
  }, b);
  ok(shift > 4 && clear >= 7.5, `a tooltip pushed off the window's edge keeps 8px clear of it (${clear.toFixed(1)}px, moved ${shift.toFixed(1)}px)`);
  ok(Math.abs(aim) <= 1, `and its arrow still points at its button (${aim.toFixed(1)}px off)`);
  const [bubble, arrow, ink, weight] = await tip.evaluate((el) => {
    const s = getComputedStyle(el);
    return [s.backgroundColor, getComputedStyle(el.querySelector("svg")).fill, s.color, +s.fontWeight];
  });
  ok(arrow === bubble, `a tooltip's arrow is the color of its bubble (${arrow} on ${bubble})`);
  const lum = (c) => rgba(c).slice(0, 3).map((v) => v / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((a, v, k) => a + v * [0.2126, 0.7152, 0.0722][k], 0);
  const ratio = (Math.max(lum(ink), lum(bubble)) + 0.05) / (Math.min(lum(ink), lum(bubble)) + 0.05);
  ok(weight >= 500 && ratio >= 7, `a tooltip's text is medium weight and reads at 7:1 or better (w${weight}, ${ratio.toFixed(1)}:1)`);
  const [hover, row, panel] = await button.evaluate((el) => [el, el.closest(".thread"), el.closest(".panel")].map((x) => getComputedStyle(x).backgroundColor));
  const [r, g, bl, a] = rgba(hover);
  // The row's wash is translucent, so what's under the button is that wash laid over the panel.
  const [wr, wg, wb, wa] = rgba(row);
  const under = rgba(panel).slice(0, 3).map((c, k) => [wr, wg, wb][k] * wa + c * (1 - wa));
  const shown = [r, g, bl].map((c, k) => c * a + under[k] * (1 - a));
  const contrast = Math.max(...shown.map((c, k) => Math.abs(c - under[k])));
  ok(contrast >= 6, `a quiet button shows its hover even over a hovered row (${hover} over ${row})`);
  await page.context().close();
}

{
  const page = await open({ key: false });
  const form = page.locator(".panel.left .form:not([hidden])");
  const px = (loc) => loc.evaluateAll((els) => els.filter((el) => el.offsetParent).map((el) => parseFloat(getComputedStyle(el).fontSize)));
  const titles = [...await px(form.locator(".group h3")), ...await px(form.locator("input.group-title"))];
  const entries = await px(form.locator(".entry-name, .entry-title"));
  ok(titles.length && entries.length && Math.min(...titles) > Math.max(...entries), `a section title is larger than the entries under it (${Math.min(...titles)}px over ${Math.max(...entries)}px)`);
  const lum = (c) => rgba(c).slice(0, 3).map((v) => v / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((a, v, k) => a + v * [0.2126, 0.7152, 0.0722][k], 0);
  const [heading, label] = await form.locator(".basics-group:has(h4)").first().evaluate((g) => [getComputedStyle(g.querySelector("h4")).color, getComputedStyle(g.querySelector(".field > span")).color]);
  ok((lum(label) + 0.05) / (lum(heading) + 0.05) >= 2, `a subgroup heading stands apart from its field labels (${heading} over ${label})`);

  const { basics } = await stored(page, "doc").then(d => d.resume);
  const toggles = form.locator(".basics-toggle");
  const labels = await form.locator("[data-form=basics] .field > span").allInnerTexts();
  const sums = await form.locator(".basics-sum").allInnerTexts();
  const expected = [[basics.gender, basics.birth, basics.ethnicity, basics.hometown, basics.politics, basics.marital], [basics.years, basics.salary, basics.availability]]
    .map((vs) => vs.map((v) => v.trim()).filter(Boolean).join(" · "));
  ok(await toggles.count() === 2 && !labels.includes("民族") && !labels.includes("期望薪资") && JSON.stringify(sums) === JSON.stringify(expected),
    `the optional groups start folded, each showing what it holds (${sums.join(" / ")})`);
  await toggles.first().click();
  const opened = await form.locator("[data-form=basics] .field > span").allInnerTexts();
  ok(opened.includes("民族") && await toggles.first().getAttribute("aria-expanded") === "true" && !opened.includes("期望薪资"), "unfolding one opens its fields and leaves the other folded");
  await page.context().close();
}

{
  const page = await open();
  const answers = ["主导客户管理系统迭代，转化率提升 [待填写]。", null];
  const line = page.locator(".page-live li").first();
  const before = (await line.allInnerTexts()).join("");
  answers[1] = before.replace(/.{2}(?=，)/, "规划");
  let n = 0;
  page.reply = () => ({ action: "edit", reply: "好。", why: "", after: { text: answers[n++] } });
  for (const [i, ask] of ["重写", "小改"].entries()) {
    await line.click();
    await page.locator(".composer textarea").fill(ask);
    await page.keyboard.press("Enter");
    await page.locator(".proposal.pending").nth(i).waitFor();
  }
  const cards = page.locator(".proposal.pending");
  const [rewrite, edit] = [cards.nth(0), cards.nth(1)];
  const shown = (await rewrite.locator(".diff-after").allInnerTexts()).join("");
  const old = (await rewrite.locator(".diff-before").allInnerTexts()).join("");
  ok(shown === answers[0] && old.endsWith(before) && await rewrite.locator("del, ins").count() === 0,
    `a rewrite shows the new text whole with the old one under it (${shown} / ${old})`);
  ok(await edit.locator(".diff-before").count() === 0 && await edit.locator("del").count() === 1 && await edit.locator("ins").count() === 1,
    "a light edit stays marked inline");

  const bar = page.locator(".preview-bar");
  const barText = async () => (await bar.allInnerTexts()).join("");
  await rewrite.hover();
  await page.locator(".canvas").evaluate((el) => el.scrollBy(0, 300));
  await page.waitForTimeout(200);
  const fromTop = await page.evaluate(() => {
    const pill = document.querySelector(".preview-bar span")?.getBoundingClientRect();
    return pill ? pill.top - document.querySelector(".canvas").getBoundingClientRect().top : NaN;
  });
  ok((await barText()).includes("接受后才会生效") && fromTop >= 0 && fromTop <= 40,
    `hovering a proposal says the page is a preview, at the top of the view even scrolled (${await barText()}, ${fromTop.toFixed(0)}px down)`);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(200);
  ok(await bar.count() === 0, "and the note goes when the preview does");
  await page.context().close();
}

for (const [entry, run, what, pasted] of [["导入", "开始整理", "import", "李明 产品经理 13800000000"], ["按岗位定制", "开始审阅", "tailoring", "招聘高级产品经理，负责增长方向"]]) {
  const page = await open({ key: false });
  const asked = [];
  page.reply = (body) => {
    if (JSON.stringify(body).includes(pasted)) asked.push(body);
    return { action: "edit", reply: "好。", why: "", after: { text: "好。" } };
  };
  await page.getByRole("button", { name: entry, exact: true }).click();
  await page.locator(".import-text").fill(pasted);
  await page.getByRole("button", { name: run }).click();
  await page.locator(".dialog input[type=password]").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".dialog input[type=password]").waitFor({ state: "detached" });
  await page.waitForTimeout(300);
  const kept = (await page.locator(".import-text").evaluateAll((els) => els.map((el) => el.value))).join("");
  ok(kept === pasted && asked.length === 0, `closing the key dialog goes back to the ${what} with its text, and runs nothing (${kept || "empty"}, ${asked.length} sent)`);
  await page.getByRole("button", { name: run }).click();
  await page.locator(".dialog input[type=password]").fill("sk-verify-fake-not-real");
  await page.getByRole("button", { name: "验证并保存" }).click();
  for (let t = 0; t < 30 && !asked.length; t++) await page.waitForTimeout(100);
  ok(asked.length === 1, `saving the key carries on with the ${what} that asked for it (${asked.length} sent)`);
  await page.context().close();
}

{
  // The third pass: bullets edit as blocks, Enter accepts, the panels resize, a click folds with a slide, the card and its pin answer each other.
  const page = await open();
  const saved = () => stored(page, "doc").then(d => d.resume.sections[0].items[0].bullets.map(b => b.text));
  const lines = await saved();
  const first = page.locator(".panel.left .form:not([hidden]) .entry .bullet textarea").first();
  await first.click();
  await first.evaluate((el) => el.setSelectionRange(6, 6));
  await page.keyboard.press("Enter");
  const split = await saved();
  const caret = await page.evaluate(() => [document.activeElement.value, document.activeElement.selectionStart]);
  ok(split.length === lines.length + 1 && split[0] === lines[0].slice(0, 6) && split[1] === lines[0].slice(6) && caret[0] === lines[0].slice(6) && caret[1] === 0,
    `Enter splits a bullet at the caret and carries on in the new one (${split.slice(0, 2).join(" | ")})`);
  await page.keyboard.press("Backspace");
  const joined = await saved();
  ok(JSON.stringify(joined) === JSON.stringify(lines) && await page.evaluate(() => document.activeElement.selectionStart) === 6,
    "Backspace at a bullet's start joins it to the one above, caret at the seam");

  await comment(page, 0, "第一条");
  ok(await page.locator(".thread.on .proposal.pending [data-primary] kbd").count() === 1, "the open card's accept button shows its key");
  await page.locator(".thread.on .msg .user").first().click();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
  ok(await page.locator(".thread .proposal.accepted").count() === 1 && (await saved())[0] === "新的写法。", "Enter accepts the open card's change");

  await page.locator(".page-live li").nth(1).click();
  await page.locator(".composer textarea").fill("第二条");
  await page.keyboard.press("Enter");
  await page.locator(".thread.on .proposal.pending").waitFor();
  await page.locator(".thread.on .thread-head").hover();
  ok(await page.locator(".pin.hot").count() === 1, "pointing at a card lights its pin on the page");
  await page.mouse.move(700, 300);
  ok(await page.locator(".pin.hot").count() === 0, "and lets it go with the pointer");

  await page.keyboard.press("Escape");
  await page.locator(".page-live").focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  const said = (await page.locator(".canvas > p.sr-only").allInnerTexts()).join("");
  const tag = (await page.locator(".sel-tag").allInnerTexts()).join("");
  ok(said && tag === said, `stepping with the keys tags the component with its name (${tag || "no tag"})`);
  await page.keyboard.press("Enter");
  ok(await page.locator(".sel-tag").count() === 0, "and the tag gives way to the composer's breadcrumb once it opens");
  await page.keyboard.press("Escape");

  const zoom = () => page.locator("button.zoom").innerText();
  const width = () => page.locator(".panel.left").evaluate((el) => el.offsetWidth);
  const [w0, z0] = [await width(), await zoom()];
  const edge = await page.locator(".resize.left").boundingBox();
  await page.mouse.move(edge.x + edge.width / 2, edge.y + 200);
  await page.mouse.down();
  await page.mouse.move(edge.x + edge.width / 2 + 80, edge.y + 200, { steps: 6 });
  await page.mouse.up();
  ok(Math.abs(await width() - (w0 + 80)) <= 1 && parseInt(await zoom()) < parseInt(z0), `dragging the left panel's edge widens it and the page makes room (${w0} to ${await width()}px, ${z0} to ${await zoom()})`);
  await reload(page);
  await page.locator(".page-live").waitFor();
  ok(Math.abs(await width() - (w0 + 80)) <= 1, "the width survives a reload");
  await page.locator(".resize.left").dblclick();
  ok(await width() === w0 && await page.evaluate(() => localStorage.getItem("redline.panelWidths")) === null, "a double-click puts it back");

  const folding = () => page.locator(".workspace").evaluate((el) => el.classList.contains("folding") && getComputedStyle(el).transitionDuration === "0.16s");
  await page.getByRole("button", { name: "收起左栏" }).click();
  ok(await folding(), "a click folds the panel with a short slide");
  await page.waitForTimeout(300);
  await page.keyboard.press("Meta+Backslash");
  ok(!(await folding()) && await page.locator(".panel.left.docked").count() === 0, "⌘\\ unfolds it at once, with no slide");
  await page.context().close();
}

{
  // A thread of formatting rounds stays short: each card lists only what it changes, a decided one folds to a line,
  // the answer above a card keeps only what can't be done, and the user's turns sit on a quiet ring.
  const page = await open();
  const rounds = [
    { action: "node_style", reply: "好", why: "右对齐、蓝色并加粗", patch: { align: "right", bold: true, color: "#1F4E8C" } },
    { action: "node_style", reply: "好", why: "改回左对齐，保留加粗和蓝色", patch: { align: "left", bold: true, color: "#1F4E8C" }, unsupported: ["字号"] },
  ];
  let n = 0;
  page.reply = () => rounds[n++];
  await page.locator(".page-live li").first().click();
  await page.locator(".composer textarea").fill("往右移，蓝色加粗");
  await page.keyboard.press("Enter");
  await page.locator(".thread.on .proposal.pending [data-primary]").click();
  await page.locator(".thread.on .reply textarea").fill("别移这么多，字号也大一点");
  await page.keyboard.press("Enter");
  await page.locator(".thread.on .proposal.pending").waitFor();
  const card = await page.locator(".thread.on .proposal.pending .style-changes li").allInnerTexts();
  ok(card.length === 1 && /对齐[\s\S]*右对齐[\s\S]*左对齐/.test(card[0]), `a follow-up formatting card lists only what it changes (${card.join(" | ")})`);
  const folded = await page.locator(".thread.on .proposal.accepted").evaluate((el) => ({
    line: el.innerText.replace(/\s+/g, " ").trim(), folded: el.classList.contains("folded"), detail: el.querySelectorAll(".style-changes, .why").length,
  }));
  ok(folded.folded && folded.detail === 0 && folded.line.includes("已接受 · 右对齐、加粗、文字颜色 #1F4E8C"),
    `a decided formatting card folds to one line saying what it did (${folded.line})`);
  const said = await page.locator(".thread.on .msg.ai").evaluateAll((els) => els.map((el) => el.querySelector(":scope > p")?.innerText ?? ""));
  ok(said[0] === "" && said[1] === "暂时做不到：字号。", `above a formatting card only what can't be done is said (${said.join(" | ") || "nothing"})`);
  const ring = await page.locator(".thread.on .msg:not(.ai):not(.first)").first().evaluate((el) => {
    const s = getComputedStyle(el, "::before");
    return { content: s.content, fill: s.backgroundColor, size: parseFloat(s.width) };
  });
  ok(ring.content === '""' && ring.fill === "rgba(0, 0, 0, 0)" && ring.size <= 8, `the user's turn sits on a quiet ring, not a filled badge (${ring.content}, ${ring.fill}, ${ring.size}px)`);
  await page.context().close();
}

// The glow that sweeps the canvas when the composer opens. Reads the overlay's pixels in the frame it was drawn,
// before the browser clears them: opaque pixels are the bent page, translucent ones only tint.
const glowPixels = (page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => {
  const el = document.querySelector(".shockwave");
  if (getComputedStyle(el).display === "none") return done(null);
  const img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let drawn = 0, opaque = 0, maxTint = 0;
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] > 0) drawn++;
      if (d[i] === 255) opaque++; else maxTint = Math.max(maxTint, d[i] / 255);
    }
    done({ drawn, opaque, maxTint });
  };
  img.src = el.toDataURL();
})));
const glowShown = (page) => page.locator(".shockwave").evaluate((el) => getComputedStyle(el).display !== "none");

{
  const page = await open();
  // Let the page settle long enough to be photographed for the lens.
  await page.waitForTimeout(2500);
  ok(!(await glowShown(page)), "at rest the glow isn't drawn");
  await page.locator(".page-live li").nth(2).click();
  await page.waitForTimeout(150);
  const box = await page.evaluate(() => {
    const g = document.querySelector(".shockwave").getBoundingClientRect();
    const canvas = document.querySelector(".canvas");
    const c = canvas.getBoundingClientRect();
    // Pins and the preview pill may not be on the page yet; a probe with their class reads their layer.
    const z = (cls) => {
      const probe = document.createElement("div");
      probe.className = cls;
      document.querySelector(".stage").append(probe);
      const layer = Number(getComputedStyle(probe).zIndex);
      probe.remove();
      return layer;
    };
    return {
      fits: Math.abs(g.left - c.left) < 0.5 && Math.abs(g.top - c.top) < 0.5 && Math.abs(g.width - canvas.clientWidth) < 0.5 && Math.abs(g.height - canvas.clientHeight) < 0.5,
      clearOfTop: g.top >= document.querySelector(".topbar").getBoundingClientRect().bottom - 0.5,
      under: ["composer", "pin", "preview-bar"].every((c) => z("shockwave") < z(c)),
      through: getComputedStyle(document.querySelector(".shockwave")).pointerEvents === "none",
    };
  });
  ok(box.fits && box.clearOfTop && box.under && box.through, `opening the composer sweeps a glow over the canvas only, under the composer and pins, never catching the pointer (${JSON.stringify(box)})`);
  const lit = await glowPixels(page);
  ok(lit && lit.drawn > 1000 && lit.opaque > 1000, `the glow tints the page and bends it as a lens (${JSON.stringify(lit)})`);
  await page.keyboard.type("改");
  ok(await page.locator(".composer textarea").inputValue() === "改", "the composer takes typing while the glow runs");
  await page.emulateMedia({ media: "print" });
  ok(!(await glowShown(page)), "the glow never prints");
  await page.emulateMedia({ media: "screen" });
  // A second component half way through starts the sweep over; it then runs its full second from there.
  await page.waitForTimeout(400);
  await page.keyboard.press("Escape");
  await page.locator(".page-live li").nth(5).click();
  await page.waitForTimeout(800);
  ok(await glowShown(page), "opening the composer on another component restarts the sweep");
  await page.waitForTimeout(600);
  const frames = await page.evaluate(() => new Promise((done) => {
    let n = 0;
    const raf = window.requestAnimationFrame;
    window.requestAnimationFrame = (f) => { n++; return raf(f); };
    setTimeout(() => { window.requestAnimationFrame = raf; done(n); }, 500);
  }));
  ok(!(await glowShown(page)) && frames === 0, `after its second the glow is gone and nothing keeps drawing (${frames} frames asked for)`);
  await page.context().close();
}

{
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" })).newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`file://${file}`);
  await page.locator(".page-live").waitFor();
  await page.waitForTimeout(2500);
  await page.locator(".page-live li").nth(2).click();
  await page.waitForTimeout(300);
  const calm = await glowPixels(page);
  ok(calm && calm.drawn > 1000 && calm.opaque === 0 && calm.maxTint <= 0.13, `with reduced motion the glow only fades in place at half strength, no bend (${JSON.stringify(calm)})`);
  await page.waitForTimeout(450);
  ok(!(await glowShown(page)), "and is gone after 600ms");
  await page.context().close();
}

{
  // Each card says where its comment stands, for tests and agents: lib/threads.ts's threadState.
  const page = await open();
  const answer = page.reply;
  let release;
  page.reply = () => new Promise((r) => { release = () => r(answer()); });
  const states = async () => page.locator(".thread").evaluateAll((els) => els.map((el) => el.dataset.state));
  await page.locator(".page-live li").first().click();
  await page.locator(".composer textarea").fill("等等");
  await page.keyboard.press("Enter");
  await page.locator(".thinking").waitFor();
  const asking = await states();
  await page.locator(".thinking").getByRole("button", { name: "取消" }).click();
  const said = await page.locator(".msg .fail").waitFor({ timeout: 3000 }).then(() => true, () => false);
  ok(said, "a comment card says where it stands: cancelling it leaves a retry");
  const failed = await states();
  release();
  page.reply = answer;
  await page.locator(".thread.on").getByRole("button", { name: "重试" }).click();
  await page.locator(".thread.on .proposal.pending").waitFor();
  const deciding = await states();
  await page.locator(".thread.on").getByRole("button", { name: "接受", exact: true }).click();
  await page.locator(".thread.on .proposal.accepted").waitFor();
  const resolved = await states();
  ok([asking, failed, deciding, resolved].map(String).join(" ") === "asking failed deciding resolved",
    `a comment card says where it stands (${[asking, failed, deciding, resolved].map(String).join(" ")})`);
  await page.context().close();
}

ok(errors.length === 0, `no page errors ${errors.join(" | ")}`);
await browser.close();
console.log("DETAILS PASSED");
