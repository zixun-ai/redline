#!/usr/bin/env node
import { stored, reload } from "../../../../e2e/storage.mjs";
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const html = resolve(process.env.REDLINE_HTML ?? `${root}/dist/index.html`);
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const evidence = resolve(process.env.VERIFY_OUT ?? `${root}/e2e/out/verify/${runId}`);
const FAKE_KEY = "sk-verify-fake-not-real";

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function open(browser, id) {
  const dir = `${evidence}/${id}`;
  mkdirSync(dir, { recursive: true });
  const result = { id, status: "running", checks: [], aiRequests: [], blockedRequests: [], failure: null };
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);

  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => m.type() === "error" && pageErrors.push(m.text()));
  await page.addInitScript(() => {
    window.__prints = [];
    window.print = () => window.__prints.push(document.title);
  });

  const replies = [];
  // A journey sets `until` to a promise to keep DeepSeek's answer on its way while it acts.
  const hold = { until: null };
  await ctx.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.protocol === "file:") return route.continue();
    if (url.origin !== "https://api.deepseek.com") {
      result.blockedRequests.push(request.url());
      return route.abort();
    }
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 200, headers: cors });
    const body = request.postDataJSON();
    const isKeyCheck = body.max_tokens === 1;
    result.aiRequests.push({
      path: url.pathname,
      model: body.model,
      jsonMode: body.response_format?.type === "json_object",
      usesFakeKey: request.headers().authorization === `Bearer ${FAKE_KEY}`,
      kind: isKeyCheck ? "key-check" : "completion",
    });
    if (!isKeyCheck && !replies.length) {
      result.blockedRequests.push(`unexpected AI request: ${request.url()}`);
      return route.fulfill({ status: 500, headers: cors, body: "{}" });
    }
    const content = JSON.stringify(isKeyCheck ? {} : replies.shift());
    if (!isKeyCheck) await hold.until;
    return route.fulfill({
      status: 200,
      headers: { ...cors, "content-type": "application/json" },
      body: JSON.stringify({ choices: [{ finish_reason: "stop", message: { content } }] }),
    }).catch(() => {});
  });

  let shots = 0;
  const j = {
    id, dir, page, replies, hold, result, pageErrors, ctx,
    ok(condition, check) {
      if (!condition) throw new Error(`FAIL: ${check}`);
      result.checks.push(check);
      console.log(`  ok - ${check}`);
    },
    async until(check, name) {
      const deadline = Date.now() + 4000;
      while (Date.now() < deadline) {
        if (await check()) return j.ok(true, name);
        await page.waitForTimeout(50);
      }
      j.ok(false, name);
    },
    shot: (name) => page.screenshot({ path: `${dir}/${String(++shots).padStart(2, "0")}-${name}.png` }),
    stored: (key) => stored(page, key),
    doc: () => j.stored("redline.doc.v1"),
    threads: async () => (await j.stored("redline.threads.v1")) ?? [],
    async statuses() {
      return (await j.threads()).flatMap((t) => t.messages.flatMap((m) => m.proposal?.status ?? []));
    },
    toolbar: (name) => page.locator(".tools").getByRole("button", { name, exact: true }),
    firstItem: page.locator(".page-live .item").first(),
    secondItem: page.locator(".page-live .item").nth(1),
    bullets: (item) => item.locator("li").allInnerTexts(),
    async comment(target, text) {
      await target.click();
      await page.locator(".composer textarea").fill(text);
      await page.keyboard.press("Enter");
    },
  };
  return j;
}

async function start(j) {
  await j.page.goto(`file://${html}`);
  await j.until(async () => (await j.doc()) !== null, "a fresh browser context loads the sample resume");
  j.ok((await j.page.evaluate(() => localStorage.getItem("redline.apiKey") === null && !JSON.parse(localStorage.getItem("redline.connection.v1") ?? "null")?.key)), "the isolated context holds no API key");
}

/** Comments on the first entry and accepts one of the two suggested rows, the way a user does with the mouse. */
async function acceptOneRow(j) {
  const { page } = j;
  await start(j);
  const originalDoc = await j.doc();
  const originals = await j.bullets(j.firstItem);
  const source = originalDoc.resume.sections[0].items[0];
  j.ok(originals.length === 3, "the first entry has the three lines this journey edits");

  await j.comment(j.firstItem.locator(".item-head"), "整段更具体");
  await page.getByRole("dialog", { name: "连接 DeepSeek" }).waitFor();
  j.ok(true, "commenting without a key opens the key dialog");
  await page.getByRole("textbox", { name: "API Key", exact: true }).fill(FAKE_KEY);
  if (j.id === "review") await page.getByRole("checkbox", { name: "记住 API Key", exact: true }).check();
  await page.getByRole("button", { name: "验证并保存" }).click();
  await page.locator(".dialog").waitFor({ state: "detached" });
  j.ok((await page.locator(".composer textarea").inputValue()) === "整段更具体", "the draft comment survives the key dialog");

  j.replies.push({
    action: "edit", reply: "改了两条。", why: "更具体",
    after: { title: source.title, subtitle: source.subtitle, period: source.period, bullets: [originals[0], "第二条新写法。", "第三条新写法。"] },
  });
  await page.locator(".composer textarea").press("Enter");
  await page.locator(".row").nth(1).waitFor();
  j.ok((await page.locator(".row").count()) === 2, "the suggestion lists only the two changed rows");
  j.ok(same(await j.doc(), originalDoc), "a suggestion changes nothing until it is accepted");
  await j.shot("suggestion");

  await page.locator('.row [role="checkbox"]').nth(1).uncheck();
  await page.getByRole("button", { name: "接受 1/2 处" }).click();
  const partial = [originals[0], "第二条新写法。", originals[2]];
  await j.until(async () => same(await j.bullets(j.firstItem), partial), "partial accept applies only the checked row");
  await j.until(async () => same((await j.doc()).resume.sections[0].items[0].bullets.map((b) => b.text), partial), "the partial edit reaches saved state");
  await j.shot("partial-accepted");
  return { originalDoc, originals, partial, acceptedDoc: await j.doc() };
}

const journeys = {
  async review(j) {
    const { page } = j;
    const { partial, acceptedDoc } = await acceptOneRow(j);
    const secondOriginals = await j.bullets(j.secondItem);
    const source = acceptedDoc.resume.sections[0].items[1];
    j.replies.push({
      action: "edit", reply: "两条都改了。", why: "",
      after: { title: source.title, subtitle: source.subtitle, period: source.period, bullets: ["被拒绝的一条。", "被拒绝的另一条。"] },
    });
    await j.comment(j.secondItem.locator(".item-head"), "这段也改");
    await page.getByRole("button", { name: "全部拒绝" }).click();
    await j.until(async () => same(await j.statuses(), ["accepted", "rejected"]), "reject records the decision");
    j.ok(same(await j.bullets(j.secondItem), secondOriginals) && same(await j.doc(), acceptedDoc), "reject leaves the resume unchanged");
    await page.getByText("已拒绝").waitFor();
    await j.shot("rejected");

    await reload(page);
    await j.firstItem.waitFor();
    j.ok(same(await j.bullets(j.firstItem), partial) && (await page.locator(".thread").count()) === 0
      && same((await j.threads()).map((t) => t.resolved), [true, true]), "the edit survives a reload, and both decided threads come back resolved");
    await page.getByRole("tab", { name: /已解决/ }).click();
    j.ok((await page.locator(".thread").count()) === 2, "both threads are listed under 已解决");
    j.ok(await page.getByRole("button", { name: "已连接" }).isVisible(), "the explicitly remembered fake key survives a reload");
  },

  async "review-history"(j) {
    const { originalDoc, originals, partial, acceptedDoc } = await acceptOneRow(j);
    await j.toolbar("撤销").click();
    await j.until(async () => same(await j.bullets(j.firstItem), originals), "undo restores the page");
    await j.until(async () => same(await j.doc(), originalDoc), "undo restores saved state");
    await j.until(async () => same(await j.statuses(), ["pending"]), "undo returns the suggestion to pending");
    await j.shot("undone");

    await j.toolbar("重做").click();
    await j.until(async () => same(await j.bullets(j.firstItem), partial), "redo reapplies the partial edit");
    await j.until(async () => same(await j.doc(), acceptedDoc), "redo restores saved state");
    await j.until(async () => same(await j.statuses(), ["accepted"]), "redo marks the suggestion accepted again");
    await j.shot("redone");
  },

  /** A comment is resolved once its last suggestion is decided, and its card stays put until the user moves on. */
  async resolve(j) {
    const { page } = j;
    await start(j);
    await page.getByRole("button", { name: "填写 API Key" }).click();
    await page.getByRole("textbox", { name: "API Key", exact: true }).fill(FAKE_KEY);
    await page.getByRole("button", { name: "验证并保存" }).click();
    await page.locator(".dialog").waitFor({ state: "detached" });

    const panel = page.locator(".panel.right");
    const lines = j.firstItem.locator("li");
    const tabs = async () => (await panel.getByRole("tab").allInnerTexts()).map((t) => t.replace(/\s+/g, ""));
    const cards = () => panel.locator(".thread").evaluateAll((els) => els.map((el) => el.dataset.thread));
    const resolved = async (id) => (await j.threads()).find((t) => t.id === id)?.resolved;
    const edit = (text) => ({ action: "edit", reply: "改好了。", why: "", after: { text } });

    j.replies.push(edit("第一条的新写法。"));
    await j.comment(lines.nth(0), "第一条");
    await panel.locator(".proposal.pending").waitFor();
    j.replies.push(edit("第二条的新写法。"));
    await j.comment(lines.nth(1), "第二条");
    // Only the open comment shows its suggestion; the other folds to its first line.
    await panel.locator('.thread[data-state="deciding"]').nth(1).waitFor();
    const [a, b] = await cards();
    j.ok(same(await tabs(), ["批注2", "已解决"]), "two comments wait under 批注");

    const cardA = panel.locator(`[data-thread="${a}"]`);
    await cardA.locator(".target").click();
    await cardA.getByRole("button", { name: "接受", exact: true }).click();
    await j.until(async () => (await resolved(a)) === true && (await resolved(b)) === false, "accepting a comment's only suggestion resolves it");
    j.ok(same(await tabs(), ["批注1", "已解决1"]), "both tab counts move at once");
    j.ok(same(await cards(), [a, b]) && (await cardA.locator(".num.done").count()) === 1, "the decided card stays where it was, marked resolved");
    await j.shot("held");

    await cardA.getByRole("button", { name: "下一条待处理" }).click();
    await j.until(async () => same(await cards(), [b]), "moving on to the next comment puts the decided card away");
    await panel.getByRole("tab", { name: /已解决/ }).click();
    j.ok(same(await cards(), [a]), "it is listed under 已解决");
    await panel.getByRole("tab", { name: /批注/ }).click();

    const cardB = panel.locator(`[data-thread="${b}"]`);
    let answer;
    j.hold.until = new Promise((r) => { answer = r; });
    j.replies.push(edit("第二条更短的写法。"));
    await cardB.locator(".reply textarea").fill("再短一点");
    await cardB.locator(".reply textarea").press("Enter");
    await cardB.locator(".thinking").waitFor();
    await cardB.locator(".proposal.pending").getByRole("button", { name: "接受", exact: true }).click();
    await j.until(async () => (await j.statuses()).filter((s) => s === "accepted").length === 2, "an earlier suggestion can be accepted while DeepSeek answers a follow-up");
    j.ok((await resolved(b)) === false && same(await tabs(), ["批注1", "已解决1"]), "a comment DeepSeek is still answering stays open");
    answer();
    j.hold.until = null;
    await cardB.locator(".proposal.pending").waitFor();

    await cardB.locator(".proposal.pending").getByRole("button", { name: "拒绝" }).click();
    await j.until(async () => (await resolved(b)) === true, "rejecting the last suggestion resolves it too");

    j.replies.push(edit("第二条换个说法。"));
    await cardB.locator(".reply textarea").fill("换个说法");
    await cardB.locator(".reply textarea").press("Enter");
    await j.until(async () => (await resolved(b)) === false && same(await tabs(), ["批注1", "已解决1"]), "replying reopens it");
    await cardB.locator(".proposal.pending").getByRole("button", { name: "接受", exact: true }).click();
    await j.until(async () => (await resolved(b)) === true, "accepting the new suggestion resolves it again");
    await cardB.locator(".proposal.accepted").last().getByRole("button", { name: "撤销" }).click();
    await j.until(async () => (await resolved(b)) === false && same(await cards(), [b]), "undoing the decision reopens it in place");
    await j.shot("reopened");

    await cardB.getByRole("button", { name: "标记为已解决" }).click();
    await j.until(async () => (await resolved(b)) === true && (await cards()).length === 0, "the check puts even the card just worked on away at once");

    await reload(page);
    await page.locator(".page-live").waitFor();
    j.ok((await cards()).length === 0 && same(await tabs(), ["批注", "已解决2"]), "after a reload nothing waits under 批注");
    await panel.getByRole("tab", { name: /已解决/ }).click();
    j.ok(same(await cards(), [a, b]), "and both comments are under 已解决");
    // Answers under a second old still fade in after the reload, so the picture waits for them.
    await panel.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((x) => x.finished)));
    await j.shot("resolved");
  },

  async import(j) {
    const { page } = j;
    const { acceptedDoc } = await acceptOneRow(j);
    const threadsBefore = await j.threads();
    const source = "王小明\n星河科技 2020-2024 产品经理\n负责增长";
    const structured = {
      basics: { name: "王小明", title: "产品经理", phone: "", email: "", location: "", website: "" },
      summary: "",
      sections: [{ kind: "experience", title: "工作经历", items: [{ title: "星河科技", subtitle: "产品经理", period: "2020-2024", bullets: ["负责增长，提升 30%"] }] }],
    };
    await page.getByRole("button", { name: "导入", exact: true }).click();
    await page.locator(".import-text").fill(source);
    j.replies.push(structured, structured);
    await page.getByRole("button", { name: "开始整理" }).click();
    const confirm = page.getByRole("dialog", { name: "确认导入" });
    await confirm.waitFor();
    j.ok((await confirm.getByLabel("导入原文").inputValue()) === source, "the confirm dialog shows the source text");
    j.ok((await confirm.locator(".unsupported").innerText()).includes("30%"), "the confirm dialog flags content missing from the source");
    j.ok(same(await j.doc(), acceptedDoc), "importing changes nothing before confirmation");
    await j.shot("import-confirm");

    await confirm.getByRole("button", { name: "返回" }).click();
    await page.getByRole("button", { name: "开始整理" }).waitFor();
    j.ok(same(await j.doc(), acceptedDoc), "going back from the confirm dialog discards the import");
    await page.getByRole("button", { name: "开始整理" }).click();
    await confirm.waitFor();
    await confirm.locator('[data-form="basics"] input').first().fill("王小明（已核对）");
    await confirm.getByRole("button", { name: "替换当前简历" }).click();
    await j.until(async () => (await j.doc()).resume.basics.name === "王小明（已核对）", "confirming imports the reviewed edit");
    await j.until(async () => (await j.threads()).length === 0, "confirming an import clears the threads");
    const importedDoc = await j.doc();
    await j.shot("imported");

    await j.toolbar("撤销").click();
    await j.until(async () => same(await j.doc(), acceptedDoc), "undo brings back the resume from before the import");
    await j.until(async () => same(await j.threads(), threadsBefore), "undo brings back the threads from before the import");
    await j.toolbar("重做").click();
    await j.until(async () => same(await j.doc(), importedDoc), "redo repeats the import");
  },

  async backup(j) {
    const { page } = j;
    const { acceptedDoc } = await acceptOneRow(j);
    const threadsBefore = await j.threads();
    await page.getByRole("tab", { name: "版本", exact: true }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载备份" }).click();
    await (await download).saveAs(`${j.dir}/backup.json`);
    const raw = readFileSync(`${j.dir}/backup.json`, "utf8");
    const backup = JSON.parse(raw);
    j.ok(same(backup.doc, acceptedDoc) && same(backup.threads, threadsBefore), "the backup file holds the resume and threads");
    j.ok(!raw.includes(FAKE_KEY), "the backup file holds no API key");

    j.replies.push({ action: "ask", reply: "备份之后的问题", options: [] });
    await j.comment(j.secondItem.locator(".item-head"), "备份之后的批注");
    await page.getByText("备份之后的问题").waitFor();
    await j.until(async () => (await j.threads()).length === threadsBefore.length + 1, "a comment made after the backup changes the threads");

    await page.getByRole("tab", { name: "版本", exact: true }).click();
    await page.getByRole("button", { name: "新建空白简历" }).click();
    await j.until(async () => (await page.locator(".page-live .item").count()) < 3, "a blank resume replaces the content");
    const blankDoc = await j.doc();
    writeFileSync(`${j.dir}/invalid-backup.json`, JSON.stringify({ app: "redline" }));
    const input = page.locator('input[type=file][accept=".json"]');
    await input.setInputFiles(`${j.dir}/invalid-backup.json`);
    await page.getByText("这个文件不是有效的 Redline 备份").waitFor();
    j.ok(same(await j.doc(), blankDoc), "an invalid backup is refused and changes nothing");
    await input.setInputFiles(`${j.dir}/backup.json`);
    await page.getByText("已从备份恢复").waitFor();
    await j.until(async () => same(await j.doc(), backup.doc), "restoring the backup brings back the resume");
    await j.until(async () => same(await j.threads(), backup.threads), "restoring the backup brings back the threads");
    await j.shot("backup-restored");
  },

  async "closing-summary"(j) {
    const { page, ctx } = j;
    await start(j);
    const form = page.locator(".panel.left .form:not([hidden])");
    const headings = () => page.locator(".page-live .sec h2").allInnerTexts();
    // Read without waiting, so a missing passage fails its check instead of timing out.
    const ending = async () => (await page.locator(".page-live .sec").last().locator(".passage").allInnerTexts()).join("\n");
    const { resume } = await j.doc();
    const profile = resume.summary.text;

    await form.locator(".add-section").getByRole("button", { name: "个人总结", exact: true }).click();
    await form.locator("section.group").last().locator("textarea").fill(profile);
    await form.locator(`[data-form="${resume.summary.id}"] textarea`).fill("");
    await j.until(async () => (await headings()).at(-1) === "个人总结" && (await ending()) === profile, "a 个人总结 added from the panel shows its text at the end of the page");
    j.ok((await page.locator(".page-live .summary").count()) === 0, "the moved text no longer sits under the name");
    const added = (await j.doc()).resume.sections.at(-1);
    j.ok(added.kind === "text" && added.title === "个人总结" && added.body.text === profile, "it is saved as a text module");
    const group = form.locator(`section[data-form="${added.id}"]`);
    await group.getByRole("button", { name: "上移模块" }).click();
    await j.until(async () => same((await headings()).slice(-2), ["个人总结", "专业技能"]), "it moves up like any other module");
    await group.getByRole("button", { name: "下移模块" }).click();
    await j.until(async () => (await headings()).at(-1) === "个人总结", "and back down to the end");
    await j.shot("moved-by-hand");

    await page.emulateMedia({ media: "print" });
    const moved = `${j.dir}/moved.pdf`;
    writeFileSync(moved, await page.pdf({ preferCSSPageSize: true, printBackground: true }));
    await page.emulateMedia({ media: "screen" });
    const printed = execFileSync("pdftotext", [moved, "-"]).toString();
    writeFileSync(`${j.dir}/moved.txt`, printed);
    j.ok(printed.indexOf("专业技能") < printed.indexOf("个人总结") && printed.indexOf("个人总结") < printed.indexOf("协同办公"), "the PDF prints 个人总结 last, with its text under it");

    await page.getByRole("button", { name: "填写 API Key" }).click();
    await page.getByRole("textbox", { name: "API Key", exact: true }).fill(FAKE_KEY);
    await page.getByRole("button", { name: "验证并保存" }).click();
    await page.locator(".dialog").waitFor({ state: "detached" });

    // A resume made elsewhere, ending in a 个人总结 long enough to wrap in the PDF.
    const closing = "五年 B 端产品经验，擅长需求分析和跨团队沟通，做事踏实，学习能力强，能独立推动跨部门项目从立项到上线。";
    const maker = await ctx.newPage();
    await maker.setContent(`<meta charset="utf-8"><body style="width: 150mm; font: 11pt/1.6 sans-serif">
      <h1>王小明</h1><p>产品经理 · 138-0000-0000 · xiaoming@example.com</p>
      <h2>工作经历</h2><p>星河科技 产品经理 2020-2024</p><p>负责增长策略和数据分析。</p>
      <h2>教育经历</h2><p>华东师范大学 本科 2016-2020</p>
      <h2>专业技能</h2><p>Figma、SQL</p>
      <h2>个人总结</h2><p>${closing}</p></body>`);
    const pdf = `${j.dir}/closing.pdf`;
    writeFileSync(pdf, await maker.pdf({ format: "A4" }));
    await maker.close();

    const basics = { name: "王小明", title: "产品经理", phone: "138-0000-0000", email: "xiaoming@example.com" };
    const modules = [
      { kind: "experience", title: "工作经历", items: [{ title: "星河科技", subtitle: "产品经理", period: "2020-2024", bullets: ["负责增长策略和数据分析。"] }] },
      { kind: "education", title: "教育经历", items: [{ title: "华东师范大学", subtitle: "本科", period: "2016-2020", bullets: [] }] },
      { kind: "skill", title: "专业技能", items: [{ title: "", subtitle: "", period: "", bullets: ["Figma、SQL"] }] },
    ];
    const answers = [
      ["as the prompt asks", { basics, summary: "", sections: [...modules, { kind: "text", title: "个人总结", paragraphs: [closing] }] }],
      ["when the model files it as the summary", { basics, summary: closing, sections: modules }],
    ];
    for (const [how, answer] of answers) {
      await page.getByRole("button", { name: "导入", exact: true }).click();
      await page.locator(".file-pick input").setInputFiles(pdf);
      await j.until(async () => (await page.locator(".import-text").inputValue()).includes("个人总结"), `the PDF is read in the browser (${how})`);
      const source = await page.locator(".import-text").inputValue();
      j.ok(source.indexOf("专业技能") < source.indexOf("个人总结") && !source.includes(closing), "its text keeps 个人总结 last, wrapped where the PDF wrapped it");
      j.replies.push(answer);
      await page.getByRole("button", { name: "开始整理" }).click();
      const confirm = page.getByRole("dialog", { name: "确认导入" });
      await confirm.waitFor();
      const groups = confirm.locator("section.group");
      j.ok((await groups.last().locator("input.group-title").inputValue()) === "个人总结" && (await groups.last().locator("textarea").inputValue()) === closing
        && (await groups.nth(1).locator("textarea").inputValue()) === "", `the review lists 个人总结 last and leaves 个人简介 empty, ${how}`);
      await groups.last().scrollIntoViewIfNeeded();
      await j.shot(`review-${answers.findIndex(([h]) => h === how) + 1}`);
      await confirm.getByRole("button", { name: "替换当前简历" }).click();
      await confirm.waitFor({ state: "detached" });
      await j.until(async () => same(await headings(), ["工作经历", "教育经历", "专业技能", "个人总结"]) && (await ending()) === closing
        && (await page.locator(".page-live .summary").count()) === 0, `the imported page ends with 个人总结, ${how}`);
      const saved = (await j.doc()).resume;
      j.ok(saved.summary.text === "" && saved.sections.at(-1).kind === "text" && saved.sections.at(-1).body.text === closing, `and saves it as a text module, ${how}`);
    }
    await j.shot("imported");
  },

  async pdf(j) {
    const { page } = j;
    const { originals, acceptedDoc } = await acceptOneRow(j);
    const prints = () => page.evaluate(() => window.__prints);
    await page.locator(".form textarea").first().fill("待补充 [待填写：核心成果]");
    await j.until(async () => (await j.doc()).resume.summary.text.includes("待填写"), "a placeholder reaches the resume");
    await page.getByRole("button", { name: "导出 PDF" }).click();
    await page.getByRole("dialog", { name: "还有内容没填" }).waitFor();
    j.ok(same(await prints(), []), "a placeholder blocks the print dialog");
    await j.shot("export-blocked");
    await page.getByRole("button", { name: "知道了" }).click();
    await page.locator(".form textarea").first().fill(acceptedDoc.resume.summary.text);
    await j.until(async () => same(await j.doc(), acceptedDoc), "removing the placeholder restores the resume");

    const titleBefore = await page.title();
    await page.getByRole("button", { name: "导出 PDF" }).click();
    await j.until(async () => same(await prints(), [`${acceptedDoc.resume.basics.name}-简历`]), "the export button prints once under the resume's name");
    j.ok((await page.title()) === titleBefore, "the page title returns after printing");

    await page.emulateMedia({ media: "print" });
    const pdf = `${j.dir}/export.pdf`;
    writeFileSync(pdf, await page.pdf({ preferCSSPageSize: true, printBackground: true }));
    await page.emulateMedia({ media: "screen" });
    const text = execFileSync("pdftotext", [pdf, "-"]).toString();
    writeFileSync(`${j.dir}/export.txt`, text);
    j.ok(/Pages:\s+1\b/.test(execFileSync("pdfinfo", [pdf]).toString()), "the PDF is one page");
    j.ok(text.includes(acceptedDoc.resume.basics.name) && text.includes("第二条新写法"), "the PDF has selectable text with the accepted edit");
    j.ok(!text.includes(originals[1]), "the PDF does not contain the replaced text");
    j.ok(!/批注|导出 PDF|按岗位定制/.test(text), "the PDF has no app interface text");
  },
};

function closeOut(j) {
  const { result, replies, pageErrors } = j;
  j.ok(same(pageErrors, []), `the page logged no errors ${pageErrors.join(" | ")}`);
  j.ok(replies.length === 0, "the app consumed every mocked reply");
  j.ok(result.blockedRequests.length === 0, `no request left the mock boundary ${result.blockedRequests.join(" | ")}`);
  j.ok(result.aiRequests.length > 0 && result.aiRequests.every((r) => r.usesFakeKey), "every AI request carried only the fake key");
  j.ok(result.aiRequests.filter((r) => r.kind === "completion").every((r) => r.path === "/chat/completions" && r.model === "deepseek-flash" && r.jsonMode), "completions use the documented DeepSeek request shape");
}

const requested = process.argv.slice(2);
const unknown = requested.filter((id) => !(id in journeys));
if (unknown.length) {
  console.error(`unknown journey: ${unknown.join(", ")}. Choose from: ${Object.keys(journeys).join(", ")}`);
  process.exit(2);
}

mkdirSync(evidence, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const report = {
  html: relative(root, html),
  htmlSha256: createHash("sha256").update(readFileSync(html)).digest("hex"),
  browser: browser.version(),
  journeys: [],
};
for (const id of requested.length ? requested : Object.keys(journeys)) {
  console.log(`journey ${id}`);
  const j = await open(browser, id);
  try {
    await journeys[id](j);
    closeOut(j);
    j.result.status = "passed";
  } catch (error) {
    j.result.status = "failed";
    j.result.failure = error.message;
    console.error(`  ${error.message}`);
    await j.page.screenshot({ path: `${j.dir}/failure.png` }).catch(() => {});
  }
  await j.ctx.close();
  report.journeys.push(j.result);
}
await browser.close();

const failed = report.journeys.filter((r) => r.status === "failed");
report.status = failed.length ? "failed" : "passed";
writeFileSync(`${evidence}/report.json`, JSON.stringify(report, null, 2));
for (const r of report.journeys) console.log(`${r.status.toUpperCase().padEnd(6)} ${r.id} (${r.checks.length} checks)`);
console.log(`evidence: ${evidence}`);
process.exit(failed.length ? 1 : 0);
