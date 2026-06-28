// コース完了→次コースへの「最後の1ピース」を、前半は自動・最後だけ手動記録で確定する（非破壊・無課金）。
// フロー:
//   1) あなたが「取り込み済みコースの最終レッスン Q1」まで進める（例: Web開発実践/Next.jsとレンダリング/Lesson8 総復習）。
//   2) （前回と同じ自動進行）保存済み正解で最終レッスンを自動回答 → コース完了を見る → 次のコースへ →
//      シリーズのコース一覧まで“自動”で到達（AI再課金なし／POSTなし）。
//   3) コース一覧で一旦停止。あなたが「次コースへ入る実際のボタン（STARTの少し上の矢印/再生マーク）」を手動クリック。
//      → そのクリック対象の要素・祖先チェーンを記録し、以降の画面（コース紹介→Lesson1 Q1）も自動採取する。
//   ログは私(アシスタント)が読む。あなたは物理操作だけ。

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

const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
const bodyHead = async (page) => page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 220)).catch(() => "");
const tabList = async (page) => page.evaluate(() => {
  const n = (s) => (s || "").replace(/\s+/g, " ").trim();
  return [...new Set([...document.querySelectorAll('[tabindex="0"]')].map((e) => n(e.textContent)).filter((t) => t && t.length <= 60))];
}).catch(() => []);

async function dump(page, tag) {
  const body = await bodyHead(page);
  const tabs = await tabList(page);
  try { fs.writeFileSync(path.join(__dirname, `drill-dump.ho-${tag}.html`), await page.content(), "utf-8"); } catch {}
  console.log(`\n----- 画面ダンプ [${tag}] -----`);
  console.log(`  tabindex=0: ${JSON.stringify(tabs)}`);
  console.log(`  本文(先頭220字): ${body}`);
  console.log(`  （DOM保存: scripts/drill-dump.ho-${tag}.html）`);
  return { body, tabs };
}

function waitForGo(promptText) {
  console.log(promptText);
  console.log(`  → ${GO_FILE} を作成すると進みます（中身は何でも可）。`);
  return new Promise((resolve) => {
    const t = setInterval(() => {
      if (fs.existsSync(GO_FILE)) { clearInterval(t); try { fs.unlinkSync(GO_FILE); } catch {} resolve(true); }
    }, 1000);
  });
}

// 可視要素だけを順に試して最初に押せたものをクリック（SPAの隠し要素=.first()誤爆を回避）。
async function clickFirstVisible(loc) {
  const n = await loc.count().catch(() => 0);
  for (let i = 0; i < n; i++) { const el = loc.nth(i); if (await el.isVisible().catch(() => false)) { await el.click({ timeout: 4000 }).catch(() => {}); return true; } }
  return false;
}
async function clickByLabel(page, label) {
  if (await clickFirstVisible(page.locator('[tabindex="0"]').filter({ hasText: label }))) return true;
  if (await clickFirstVisible(page.getByText(label, { exact: true }))) return true;
  return false;
}

const index = await fetchIndex(STUDYLOG_API);

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: false, viewport: { width: 430, height: 900 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());

// クリック捕捉（capture段で対象とその祖先をキューに積む）。手動クリックの記録に使う。
await page.addInitScript(() => {
  window.__clicks = [];
  const desc = (e) => {
    if (!e) return null;
    const cls = (typeof e.className === "string" ? e.className : "").trim().split(/\s+/).filter(Boolean);
    const r = e.getBoundingClientRect();
    return { tag: e.tagName.toLowerCase(), role: e.getAttribute && e.getAttribute("role"), tabindex: e.getAttribute && e.getAttribute("tabindex"),
      testid: e.getAttribute && e.getAttribute("data-testid"), aria: e.getAttribute && (e.getAttribute("aria-label") || e.getAttribute("aria-labelledby")),
      cls, text: (e.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40), rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
  };
  document.addEventListener("pointerdown", (ev) => {
    const chain = []; let cur = ev.target;
    for (let i = 0; i < 8 && cur; i++) { chain.push(desc(cur)); cur = cur.parentElement; }
    window.__clicks.push({ t: Date.now(), point: { x: Math.round(ev.clientX), y: Math.round(ev.clientY) }, chain });
  }, true);
});
await page.goto(START_URL, { waitUntil: "domcontentloaded" }).catch(() => {});

console.log("\n==============================================");
console.log(" コース完了→次コースへ：前半自動・最後だけ手動記録（非破壊・無課金）");
console.log(" 取り込み済みコースの『最終レッスンの Q1』まで進めて放置してください。");
console.log("==============================================\n");

console.log("最終レッスンの問題画面（解答ボタン）を待っています…（最大10分）");
const deadline = Date.now() + 600000;
while (Date.now() < deadline) { if (await page.$('[data-testid^="quiz-answer-option-"]')) break; await sleep(1000); }
if (!(await page.$('[data-testid^="quiz-answer-option-"]'))) { console.log("問題画面を検出できませんでした。終了。"); await ctx.close().catch(() => {}); process.exit(1); }

const first = await readState(page);
console.log("=== 観察対象（最終レッスン）===");
console.log(`  ${first.contextLabel || "?"} / ${first.title || "?"}  （総 ${first.total ?? "?"} 問）`);
await waitForGo("\n  → これが“取り込み済みコースの最終レッスン”なら .cc-go を作成して開始… ");

// (A) 最終レッスンを保存済み正解で自動回答（POSTなし）→ レッスン完了。
console.log("\n=== 最終レッスンを自動回答（AI再課金なし）===");
const r = await clearReview(page, index, { auto: true, maxQuestions: 60, dumpDir: __dirname });
console.log(`  clearReview: 既知${r.known}/自己訂正${r.corrected}/未知${r.unknownList.length}/次レッスン遷移=${r.advanced}`);
await sleep(1500);
await dump(page, "0-lessoncomplete");

// (B) コース完了を見る → コース完了画面
console.log("\n[自動] 「コース完了を見る」をクリック…");
await clickByLabel(page, "コース完了を見る");
await sleep(2500);
await dump(page, "1-coursecomplete");

// (C) 次のコースへ → シリーズのコース一覧
console.log("\n[自動] 「次のコースへ」をクリック…");
await clickByLabel(page, "次のコースへ");
await sleep(2500);
await dump(page, "2-courselist");

// (D) ここで停止。あなたが“次コースへ入る実際のボタン”を手動クリック → 記録 + 以降を自動採取。
await page.evaluate(() => { window.__clicks = []; }).catch(() => {}); // ここまでの記録はクリア
console.log("\n==============================================");
console.log(" ★ ここで一旦停止。コース一覧で『次コースへ入るボタン（STARTの少し上の矢印/再生マーク）』を");
console.log("   あなたが手で押してください。押した要素を記録し、コース紹介→Lesson1 Q1 まで自動採取します。");
console.log("==============================================\n");

let lastBody = await bodyHead(page);
let snap = 3;
const obsDeadline = Date.now() + 1800000; // 30分
while (Date.now() < obsDeadline) {
  const clicks = await page.evaluate(() => { const c = window.__clicks || []; window.__clicks = []; return c; }).catch(() => []);
  for (const c of clicks) {
    console.log(`\n🖱  クリック記録 @${new Date(c.t).toLocaleTimeString()} point=${JSON.stringify(c.point)}`);
    c.chain.forEach((d, i) => { if (!d) return; const cls = (d.cls || []).slice(0, 4).join("."); console.log(`   [${i}] ${d.tag}[role=${d.role}][tabindex=${d.tabindex}]${d.testid ? `[testid=${d.testid}]` : ""}${d.aria ? `[aria=${d.aria}]` : ""} .${cls} rect=${JSON.stringify(d.rect)} text=${JSON.stringify(d.text)}`); });
  }
  const body = await bodyHead(page);
  if (body && body !== lastBody) {
    lastBody = body;
    await dump(page, `${snap}-after`);
    if (await page.$('[data-testid^="quiz-answer-option-"]')) { console.log("  ✅ 解答ボタン検出＝次コース Lesson1 Q1 に到達！"); }
    snap += 1;
  }
  await sleep(700);
}
console.log("\n=== 観察タイムアウト。ブラウザは開いたまま。Ctrl+C で終了。===");
