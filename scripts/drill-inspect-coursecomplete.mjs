// コース完了画面の“その先”を1ステップずつ観察する（非破壊・無課金）。
// 目的: シリーズ一括取り込み（コース跨ぎ自動化）の設計材料として、コース最終レッスンの
//   完了画面に出る「コース完了を見る」を押した後、どんな画面・ボタンが現れ、次コースへ
//   どう辿れるかを実機で確認する。/api/import-question へは一切POSTしない（AI再課金なし）。
//
// 使い方:
//   1) dev サーバ起動済み（preview :3000）。保存済み studyLog で完了画面まで自動到達する。
//   2) node scripts/drill-inspect-coursecomplete.mjs
//   3) Chromium で「取り込み済みコースの“最終レッスン”の Q1」まで進めて放置 → 開始合図（Enter / .cc-go）。
//      （例: Web開発実践シリーズ / Next.jsとレンダリング / Lesson 8 総復習 の Q1）
//   4) clearReview が全問を保存済み正解で解いて“レッスン完了!”（=コース完了を見る がある画面）に到達。
//   5) 以降は対話ステッパー: 各画面の tabindex ボタンと見出しをダンプ → scripts/.cc-go の“中身”に
//      押したいボタン名を書くとそのボタンをクリック → 次の画面をダンプ。中身が STOP / 空 なら終了。
//      （操作者はログを見られないので、ログは私(アシスタント)が読み、押すボタンは .cc-go で指示する）

import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { readState, sleep } from "./drill-dom.mjs";
import { fetchIndex, clearReview } from "./drill-review-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GO_FILE = path.join(__dirname, ".cc-go");       // 開始合図 兼 ステップ指示（中身=押すボタン名）
const PROFILE_DIR = path.join(__dirname, ".pw-profile");
const START_URL = "https://drill.ma-ji.ai/";
const STUDYLOG_API = process.env.REVIEW_API ?? "http://localhost:3000/api/study-log";
const DUMP_DIR = __dirname;

// 画面の「観察結果」を採取する: 見出し相当の本文先頭・tabindex=0 のボタン文言・主要キーワード。
async function snapshot(page, tag) {
  const info = await page.evaluate(() => {
    const strip = (s) => (s || "").replace(/[-]/g, "");
    const norm = (s) => strip(s).replace(/\s+/g, " ").trim();
    const tabs = [...document.querySelectorAll('[tabindex="0"]')]
      .map((e) => norm(e.textContent))
      .filter((t) => t && t.length <= 40);
    const body = norm(document.body.innerText).slice(0, 600);
    return { tabs: [...new Set(tabs)], body };
  }).catch(() => ({ tabs: [], body: "" }));
  try { fs.writeFileSync(path.join(DUMP_DIR, `drill-dump.cc-${tag}.html`), await page.content(), "utf-8"); } catch {}
  console.log(`\n----- 画面ダンプ [${tag}] -----`);
  console.log(`  tabindex=0 ボタン: ${JSON.stringify(info.tabs)}`);
  console.log(`  本文(先頭600字): ${info.body}`);
  console.log(`  （DOM保存: scripts/drill-dump.cc-${tag}.html）`);
  return info;
}

// .cc-go の出現を待ち、その「中身」（押すボタン名 / STOP）を返す。TTY なら標準入力から1行。
function waitForStep(promptText) {
  console.log(promptText);
  console.log(`  → 次に押すボタン名を ${GO_FILE} に書いてください（STOP で終了）。`);
  return new Promise((resolve) => {
    const t = setInterval(() => {
      if (fs.existsSync(GO_FILE)) {
        clearInterval(t);
        let v = "";
        try { v = fs.readFileSync(GO_FILE, "utf-8").trim(); } catch {}
        try { fs.unlinkSync(GO_FILE); } catch {}
        resolve(v);
      }
    }, 1000);
  });
}

async function clickByLabel(page, label) {
  // 「次のレッスンへ」等と同じ tabindex=0 div を想定。部分一致 → 完全一致の順で堅牢に。
  const byTab = page.locator('div[tabindex="0"]').filter({ hasText: label });
  if ((await byTab.count().catch(() => 0)) > 0) { await byTab.first().click().catch(() => {}); return true; }
  const byText = page.getByText(label, { exact: true });
  if ((await byText.count().catch(() => 0)) > 0) { await byText.first().click().catch(() => {}); return true; }
  return false;
}

const index = await fetchIndex(STUDYLOG_API);

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  viewport: { width: 430, height: 900 },
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto(START_URL, { waitUntil: "domcontentloaded" }).catch(() => {});

console.log("\n==============================================");
console.log(" コース完了画面の“その先”を観察（非破壊・無課金）");
console.log(" 1) drill.ma-ji.ai にログイン");
console.log(" 2) 取り込み済みコースの『最終レッスンの Q1』まで進める");
console.log(" 3) そのまま放置（保存済み正解で自動回答→完了画面まで到達）");
console.log("==============================================\n");

console.log("最終レッスンの問題画面（解答ボタン）が出るのを待っています…（最大10分）");
const deadline = Date.now() + 600000;
while (Date.now() < deadline) {
  if (await page.$('[data-testid^="quiz-answer-option-"]')) break;
  await sleep(1000);
}
if (!(await page.$('[data-testid^="quiz-answer-option-"]'))) {
  console.log("問題画面を検出できませんでした（10分）。終了します。");
  await ctx.close().catch(() => {});
  process.exit(1);
}

const first = await readState(page);
console.log("=== 観察対象（最終レッスン）===");
console.log(`  ${first.contextLabel || "?"} / ${first.title || "?"}  （総 ${first.total ?? "?"} 問）`);
console.log("  ※ これが“取り込み済みコースの最終レッスン”であることを確認してから開始合図を出します。");

// 開始合図（中身は不問。存在すれば開始）
await waitForStep("\n  → 開始するには .cc-go を作成してください（中身は何でも可）… ");

// 保存済み正解で最終レッスンを解いて“レッスン完了!”（=コース完了を見る がある画面）へ。POSTなし。
console.log("\n=== 保存済み正解で最終レッスンを自動回答（AI再課金なし）===");
const r = await clearReview(page, index, { auto: true, maxQuestions: 60, dumpDir: DUMP_DIR });
console.log(`  clearReview 完了: 既知${r.known} / 自己訂正${r.corrected} / 未知${r.unknownList.length} / 次レッスン遷移=${r.advanced}`);
await sleep(1500);

// ここから対話ステッパー: 画面を採取 → 指示されたボタンを押す → 次画面採取 …
let step = 0;
let snap = await snapshot(page, `step${step}`);
while (true) {
  const choice = await waitForStep(`\n  [step${step}] 上のボタンから押すものを選んでください。`);
  if (!choice || /^stop$/i.test(choice)) { console.log("  STOP を受領。観察を終了します。"); break; }
  const ok = await clickByLabel(page, choice);
  if (!ok) { console.log(`  ⚠ ボタン「${choice}」が見つかりませんでした。もう一度指定してください。`); continue; }
  console.log(`  「${choice}」をクリック。画面遷移を待ちます…`);
  await sleep(2500);
  step += 1;
  snap = await snapshot(page, `step${step}`);
}

console.log("\n=== 観察終了 ===  ブラウザは開いたままにします（手動確認可）。Ctrl+C で終了。");
// ブラウザは閉じず保持（さらに手動で確認したい場合に備える）。
