// 次コース自動ナビ（advanceToNextCourse）を“非破壊・無課金”で検証する。
// 取り込み済みコースの最終レッスンを保存済み正解で自動回答（POSTなし）→ コース完了→次のコースへ→
// STARTタイル→Lesson1 の自動ナビを実走 → 次コースの Q1 に到達できたかを判定する。/api へPOSTしない。
//
// 使い方:
//   1) dev (:3000)。  2) node scripts/drill-verify-nextcourse.mjs
//   3) Chromium で取り込み済みコースの『最終レッスン Q1』まで進めて放置 → 確認後 .cc-go で開始。
//   4) 自動ナビが走り、最後に「✅ 次コース Q1 到達 / コース名」を表示。ログは私(アシスタント)が読む。

import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { readState, sleep } from "./drill-dom.mjs";
import { fetchIndex, clearReview, advanceToNextCourse } from "./drill-review-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GO_FILE = path.join(__dirname, ".cc-go");
const PROFILE_DIR = path.join(__dirname, ".pw-profile");
const START_URL = "https://drill.ma-ji.ai/";
const STUDYLOG_API = process.env.REVIEW_API ?? "http://localhost:3000/api/study-log";

function waitForGo(promptText) {
  console.log(promptText);
  console.log(`  → ${GO_FILE} を作成すると開始（中身は何でも可）。`);
  return new Promise((resolve) => {
    const t = setInterval(() => {
      if (fs.existsSync(GO_FILE)) { clearInterval(t); try { fs.unlinkSync(GO_FILE); } catch {} resolve(true); }
    }, 1000);
  });
}

const index = await fetchIndex(STUDYLOG_API);
const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: false, viewport: { width: 430, height: 900 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto(START_URL, { waitUntil: "domcontentloaded" }).catch(() => {});

console.log("\n=== 次コース自動ナビ 検証（非破壊・無課金）===");
console.log("取り込み済みコースの『最終レッスンの Q1』まで進めて放置してください…（最大10分）");
const deadline = Date.now() + 600000;
while (Date.now() < deadline) { if (await page.$('[data-testid^="quiz-answer-option-"]')) break; await sleep(1000); }
if (!(await page.$('[data-testid^="quiz-answer-option-"]'))) { console.log("問題画面を検出できず。終了。"); await ctx.close().catch(() => {}); process.exit(1); }

const first = await readState(page);
console.log("=== 観察対象（最終レッスン）===");
console.log(`  ${first.contextLabel || "?"} / ${first.title || "?"}  （総 ${first.total ?? "?"} 問）`);
await waitForGo("\n  → これが最終レッスンなら .cc-go を作成して開始… ");

console.log("\n=== 最終レッスンを自動回答（AI再課金なし）===");
const r = await clearReview(page, index, { auto: true, maxQuestions: 60, dumpDir: __dirname });
console.log(`  clearReview: 既知${r.known}/自己訂正${r.corrected}/未知${r.unknownList.length}/次レッスン遷移=${r.advanced}`);
await sleep(1500);

console.log("\n=== advanceToNextCourse 実走 ===");
const ok = await advanceToNextCourse(page);
await sleep(800);
const after = await readState(page).catch(() => ({}));
try { fs.writeFileSync(path.join(__dirname, "drill-dump.verify-nextcourse.html"), await page.content(), "utf-8"); } catch {}

console.log("\n=== 検証結果 ===");
if (ok) {
  console.log(`  ✅ 次コースの Q1 に到達。  コース: ${after.contextLabel || "?"} / レッスン: ${after.title || "?"} / 総 ${after.total ?? "?"} 問`);
  console.log("  → これで MANUAL_NEXT_COURSE なしのシリーズ一括（MAX_COURSES>1）が自動でコースを跨げます。");
} else {
  console.log("  ⚠ Q1 に到達できませんでした。drill-dump.verify-nextcourse.html と上のログで詰まり箇所を確認します。");
}
console.log("  ブラウザは開いたまま。Ctrl+C で終了。");
