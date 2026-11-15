#!/usr/bin/env node
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const path = (p) => join(root, p);
let failures = 0;
const pass = (m) => console.log(`ok    ${m}`);
const warn = (m) => console.log(`warn  ${m}`);
const fail = (m) => { failures += 1; console.log(`fail  ${m}`); };
const check = (good, yes, no, report = fail) => (good ? pass(yes) : report(no));

const onPath = (tool) => {
  try { execFileSync("/usr/bin/which", [tool], { stdio: "ignore" }); return true; } catch { return false; }
};
const newestIn = (dir) => Math.max(...readdirSync(dir, { withFileTypes: true, recursive: true })
  .filter((e) => e.isFile())
  .map((e) => statSync(join(e.parentPath, e.name)).mtimeMs));
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

for (const tool of ["pdfinfo", "pdftotext"]) check(onPath(tool), `${tool} found`, `${tool} missing. Run brew install poppler.`);
for (const tool of ["pdfimages", "pdffonts"]) check(onPath(tool), `${tool} found`, `${tool} missing. e2e/features.mjs needs it. Run brew install poppler.`);
check(onPath("textutil"), "textutil found", "textutil missing. e2e/features.mjs needs it and it exists only on macOS.", warn);

try {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  pass(`Chrome ${browser.version()} launches through playwright-core`);
  await browser.close();
} catch (error) {
  fail(`Chrome does not launch: ${error.message.split("\n")[0]}`);
}

const dist = path("dist/index.html");
if (!existsSync(dist)) {
  fail("dist/index.html missing. Run npm run build.");
} else {
  const built = statSync(dist).mtimeMs;
  const sources = Math.max(newestIn(path("src")), statSync(path("index.html")).mtimeMs);
  check(built >= sources, "dist/index.html is newer than src", "dist/index.html is older than src. Run npm run build.");
  const shipped = path("Redline.html");
  check(existsSync(shipped) && sha(shipped) === sha(dist), "Redline.html matches dist/index.html", "Redline.html differs from dist/index.html. Run cp dist/index.html Redline.html before you test the deliverable.", warn);

  const needed = ["e2e/out/1-start.png", "e2e/out/qingjun.pdf", "e2e/out/fenlan.pdf"];
  const missing = needed.filter((p) => !existsSync(path(p)));
  const stale = needed.filter((p) => existsSync(path(p)) && statSync(path(p)).mtimeMs < built);
  check(!missing.length, "e2e/features.mjs inputs exist", `e2e/features.mjs inputs missing: ${missing.join(", ")}. Run node e2e/run.mjs first.`, warn);
  check(!stale.length, "e2e/features.mjs inputs match this build", `e2e/features.mjs inputs predate this build: ${stale.join(", ")}. Run node e2e/run.mjs first.`, warn);
}

console.log(failures ? `DOCTOR FAILED ${failures}` : "DOCTOR OK");
process.exit(failures ? 1 : 0);
