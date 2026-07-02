// 並べ替えUIの挙動調査（読み取り＋タップ観察のみ・回答確定はしない・保存もしない）。
// 目的: 新UIの並べ替えで「タップすると選択肢が消えるのか／番号バッジが付くのか」と
//       選択肢の実テキスト・aria-label を実機で確定し、answerOrdering の修正方針を決める。
// 使い方: node scripts/drill-probe-ordering.mjs  → ドリルが並べ替え問題を復元したら自動観察して終了。
import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = path.join(__dirname, ".pw-profile");
const START_URL = "https://drill.ma-ji.ai/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  viewport: { width: 430, height: 900 },
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto(START_URL, { waitUntil: "domcontentloaded" }).catch(() => {});

console.log("問題画面の復元を待っています…（最大10分）");
const deadline = Date.now() + 600000;
while (Date.now() < deadline) {
  if (await page.$('[data-testid^="quiz-answer-option-"]')) break;
  await sleep(1000);
}
if (!(await page.$('[data-testid^="quiz-answer-option-"]'))) {
  console.log("問題画面を検出できませんでした。終了します。");
  await ctx.close().catch(() => {});
  process.exit(1);
}
await sleep(1500);

// 選択肢の状態（テキスト・aria-label・data-testid）を読む
async function readOptions(tag) {
  const opts = await page.evaluate(() => {
    const norm = (x) => (x || "").replace(/\s+/g, " ").trim();
    return [...document.querySelectorAll('[data-testid^="quiz-answer-option-"]')].map((e) => ({
      testid: e.getAttribute("data-testid"),
      aria: e.getAttribute("aria-label"),
      text: norm(e.textContent).slice(0, 80),
    }));
  });
  console.log(`\n=== ${tag} === (${opts.length}個)`);
  for (const o of opts) console.log(`  ${o.testid} aria=${JSON.stringify(o.aria)} text=${JSON.stringify(o.text)}`);
  return opts;
}

// 問題文とサブミット状態も
const qtext = await page.evaluate(() => {
  const norm = (x) => (x || "").replace(/\s+/g, " ").trim();
  const els = [...document.querySelectorAll('div[dir="auto"]')].map((e) => norm(e.textContent)).filter((t) => t.length > 20);
  return els.slice(0, 3);
});
console.log("画面上部テキスト候補:", JSON.stringify(qtext, null, 1));

const before = await readOptions("タップ前");
fs.writeFileSync(path.join(__dirname, "drill-dump.probe-ordering-0.html"), await page.content(), "utf-8");

// option-0 をタップ → 変化観察
await page.click('[data-testid="quiz-answer-option-0"]').catch((e) => console.log("tap0 err:", e.message));
await sleep(900);
await readOptions("option-0 タップ後");
fs.writeFileSync(path.join(__dirname, "drill-dump.probe-ordering-1.html"), await page.content(), "utf-8");

// 次の選択肢（残っていれば先頭、消えるUIなら新しい先頭＝元の2番目）をもう1タップ
await page.click('[data-testid^="quiz-answer-option-"]').catch((e) => console.log("tap2 err:", e.message));
await sleep(900);
await readOptions("2タップ後");
fs.writeFileSync(path.join(__dirname, "drill-dump.probe-ordering-2.html"), await page.content(), "utf-8");

// サブミットボタンの有無（押さない）
const hasSubmit = !!(await page.$('[data-testid="quiz-submit"]'));
console.log("\nquiz-submit 存在:", hasSubmit, "（押さずに終了します）");

await ctx.close().catch(() => {});
process.exit(0);
