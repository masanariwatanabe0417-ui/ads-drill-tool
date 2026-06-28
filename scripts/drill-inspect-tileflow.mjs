// 実フロー（最終レッスン→コース完了→次のコースへ→コース一覧）の“中で” STARTタイルのクリック手段を
// 実測する診断（非破壊・無課金）。★この経路で来た時だけ裏にホーム画面が残ってタイルを覆うため、
// 直接コース一覧へ行く単体診断では失敗条件を再現できない（操作者の指摘 2026-06-28k）。
//
// 使い方: node scripts/drill-inspect-tileflow.mjs → 取り込み済みコースの『最終レッスン Q1』まで進めて放置 → .cc-go で開始。
//   自動で 12問回答 → コース完了を見る → 次のコースへ → コース一覧。そこで複数のクリック手段を順に試し、
//   どれで次コースへ遷移できるかを報告する（POSTなし）。ログは私(アシスタント)が読む。

import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { readState, sleep } from "./drill-dom.mjs";
import { fetchIndex, clearReview } from "./drill-review-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GO_FILE = path.join(__dirname, ".cc-go");
const PROFILE_DIR = path.join(__dirname, ".pw-profile");
const START_URL = "https://drill.ma-ji.ai/";
const STUDYLOG_API = process.env.REVIEW_API ?? "http://localhost:3000/api/study-log";

function waitForGo(t) { console.log(t); console.log(`  → ${GO_FILE} を作成すると開始。`); return new Promise((res) => { const iv = setInterval(() => { if (fs.existsSync(GO_FILE)) { clearInterval(iv); try { fs.unlinkSync(GO_FILE); } catch {} res(true); } }, 1000); }); }
async function clickFirstVisible(loc, opts = {}) { const n = await loc.count().catch(() => 0); for (let i = 0; i < n; i++) { const el = loc.nth(i); if (await el.isVisible().catch(() => false)) { await el.click({ timeout: 5000, ...opts }).catch(() => {}); return true; } } return false; }
async function firstVisible(loc) { const n = await loc.count().catch(() => 0); for (let i = 0; i < n; i++) { const el = loc.nth(i); if (await el.isVisible().catch(() => false)) return el; } return null; }

const index = await fetchIndex(STUDYLOG_API);
const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: false, viewport: { width: 430, height: 900 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto(START_URL, { waitUntil: "domcontentloaded" }).catch(() => {});

console.log("\n=== STARTタイル クリック手段の診断（実フロー・非破壊・無課金）===");
console.log("取り込み済みコースの『最終レッスンの Q1』まで進めて放置…（最大10分）");
const dl = Date.now() + 600000;
while (Date.now() < dl) { if (await page.$('[data-testid^="quiz-answer-option-"]')) break; await sleep(1000); }
if (!(await page.$('[data-testid^="quiz-answer-option-"]'))) { console.log("問題画面を検出できず。終了。"); await ctx.close().catch(() => {}); process.exit(1); }
const first = await readState(page);
console.log(`=== 観察対象: ${first.contextLabel || "?"} / ${first.title || "?"}（総 ${first.total ?? "?"} 問）===`);
await waitForGo("\n  → これが最終レッスンなら .cc-go を作成して開始… ");

console.log("\n=== 最終レッスンを自動回答（AI再課金なし）===");
const r = await clearReview(page, index, { auto: true, maxQuestions: 60, dumpDir: __dirname });
console.log(`  clearReview: 既知${r.known}/未知${r.unknownList.length}/次レッスン遷移=${r.advanced}`);
await sleep(1500);

console.log("\n[自動] コース完了を見る → 次のコースへ（コース一覧へ・裏にホームが残る条件を再現）");
await clickFirstVisible(page.locator('[tabindex="0"]').filter({ hasText: "コース完了を見る" })); await sleep(2500);
await clickFirstVisible(page.locator('[tabindex="0"]').filter({ hasText: "次のコースへ" })); await sleep(2500);

const listMarker = "コース完了 (50%)";
const onList = async () => page.evaluate((t) => (document.body.innerText || "").includes(t), listMarker).catch(() => false);
const bodyHead = async () => page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 150)).catch(() => "");
async function navigated() { for (let i = 0; i < 8; i++) { if (!(await onList())) return true; await sleep(500); } return false; }

if (!(await onList())) { console.log("⚠ コース一覧に到達できず（次のコースへが効いていない）。終了。"); }
else {
  // 接地点の実測（裏のホームに覆われているか）。
  const diag = await page.evaluate(() => {
    const desc = (e) => e ? `${e.tagName.toLowerCase()}[role=${e.getAttribute("role")}]` : "(none)";
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const btn = [...document.querySelectorAll('button[role="button"]')].find((e) => /START/.test(e.textContent || ""));
    const circ = btn && btn.querySelector("div.rounded-full");
    const probe = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); const cx = r.x + r.width / 2, cy = r.y + r.height / 2; const top = document.elementFromPoint(cx, cy); return { point: { x: Math.round(cx), y: Math.round(cy) }, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, hit: desc(top), hitText: norm(top?.textContent).slice(0, 24), covered: !(e.contains(top) || top === e) }; };
    return { btnText: norm(btn?.textContent).slice(0, 30), tile: probe(btn), circle: circ ? probe(circ) : "(no circle)" };
  });
  console.log("\n----- 接地点診断（covered=trueなら裏要素に覆われている）-----");
  console.log(JSON.stringify(diag, null, 2));

  const startBtn = page.locator('button[role="button"]').filter({ hasText: "START" });
  const circle = startBtn.locator("div.rounded-full");
  const strategies = [
    ["A: circle.click()", async () => { const el = await firstVisible(circle); if (!el) throw new Error("no circle"); await el.click({ timeout: 3000 }); }],
    ["B: circle.click(force)", async () => { const el = await firstVisible(circle); if (!el) throw new Error("no circle"); await el.click({ force: true, timeout: 3000 }); }],
    ["C: mouse at circle box", async () => { const el = await firstVisible(circle); if (!el) throw new Error("no circle"); const b = await el.boundingBox(); if (!b) throw new Error("no box"); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); }],
    ["D: dispatch on button", async () => { const el = await firstVisible(startBtn); if (!el) throw new Error("no btn"); await el.evaluate((n) => ["pointerdown","mousedown","pointerup","mouseup","click"].forEach((t) => n.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })))); }],
    ["E: tile.click(force)", async () => { const el = await firstVisible(startBtn); if (!el) throw new Error("no btn"); await el.click({ force: true, timeout: 3000 }); }],
  ];
  let won = null;
  for (const [name, fn] of strategies) {
    if (!(await onList())) { console.log("（既に一覧を離脱：直前の手段で遷移済み）"); break; }
    console.log(`\n--- 試行 ${name} ---`);
    try { await fn(); } catch (e) { console.log(`  例外: ${String(e).slice(0, 100)}`); }
    if (await navigated()) { console.log(`  ✅ 遷移成功！ 本文: ${await bodyHead()}`); won = name; break; }
    console.log("  ✗ 遷移せず");
  }
  console.log("\n=== 結果 ===");
  console.log(won ? `遷移できた手段: ${won}` : "どの手段でも遷移しませんでした。");
}
try { fs.writeFileSync(path.join(__dirname, "drill-dump.tileflow-after.html"), await page.content(), "utf-8"); } catch {}
console.log("本文:", await bodyHead(), " ／ ブラウザは開いたまま。Ctrl+C で終了。");
