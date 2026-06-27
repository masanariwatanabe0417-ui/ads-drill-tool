// 復習（再テスト）の自動突破（独立CLI）。
// ドリルの「復習」は本編で取り込み済みの問題の再テストなので、保存済み studyLog の正解で
// 答えれば AI を再課金せずに突破できる。完了画面（88%以上で「レッスン完了!」）の
// 「次のレッスンへ」を自動クリックするところまでがこのスクリプトの役割（ロードマップ②）。
//
// ※ 実装本体（照合・回答・完了処理）は scripts/drill-review-core.mjs に集約。本ファイルは
//    ブラウザ起動→問題画面待ち→studyLog取得→clearReview 呼び出し、という薄いCLIラッパ。
//    drill-import.mjs（取り込み末尾の復習クリア統合）も同じ core を使う。
//
// 前提:
//   1) 別端末（または preview 管理）で dev サーバ起動: npm run dev  (http://localhost:3000)
//      ※ 保存済み studyLog を GET /api/study-log から読むため dev が要る。
//   2) このスクリプトを起動:                          node scripts/drill-review.mjs
//   3) 開いた Chromium で drill.ma-ji.ai にログインし、突破したいレッスンの
//      「復習の Q1 問題画面」まで進めて放置 → 開始合図（Enter / scripts/.review-go）。

import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";
import { readState, sleep } from "./drill-dom.mjs";
import { fetchIndex, clearReview, makeWaitForGo } from "./drill-review-core.mjs";

// 純関数は後方互換のため引き続き drill-review.mjs から re-export（既存の import 経路を壊さない）。
export {
  extractQuestion, extractCorrect, normLoose, findLoose, extractOrder, extractPairs,
  optionMatchesCorrect, buildIndex, lookup,
} from "./drill-review-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GO_FILE = path.join(__dirname, ".review-go");
const PROFILE_DIR = path.join(__dirname, ".pw-profile");
const START_URL = "https://drill.ma-ji.ai/";
const STUDYLOG_API = process.env.REVIEW_API ?? "http://localhost:3000/api/study-log";
const MAX_QUESTIONS = parseInt(process.env.MAX_QUESTIONS ?? "60", 10);
const AUTO_UNKNOWN = process.env.AUTO_UNKNOWN === "1";

const waitForGo = makeWaitForGo(GO_FILE);

// このファイルが直接実行されたときだけブラウザを起動する。
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();

async function main() {
  // 保存済み studyLog を取得してインデックス化
  const index = await fetchIndex(STUDYLOG_API);

  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 430, height: 900 },
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(START_URL, { waitUntil: "domcontentloaded" }).catch(() => {});

  console.log("\n==============================================");
  console.log(" 復習の自動突破");
  console.log(" 1) drill.ma-ji.ai にログイン");
  console.log(" 2) 突破したいレッスンの『復習の Q1 問題画面』まで進める");
  console.log(" 3) そのまま放置（保存済み正解で自動回答→完了で次レッスンへ）");
  console.log(" 中断は Ctrl+C");
  console.log("==============================================\n");

  // 問題画面（解答ボタン）が出るまで最大10分待つ＝ログイン・移動の時間。
  console.log("復習の問題画面（解答ボタン）が表示されるのを待っています…（最大10分）");
  const waitDeadline = Date.now() + 600000;
  while (Date.now() < waitDeadline) {
    if (await page.$('[data-testid^="quiz-answer-option-"]')) break;
    await sleep(1000);
  }
  if (!(await page.$('[data-testid^="quiz-answer-option-"]'))) {
    console.log("問題画面を検出できませんでした（10分経過）。終了します。");
    await ctx.close().catch(() => {});
    process.exit(1);
  }

  const first = await readState(page);
  console.log("=== 突破対象 ===");
  console.log(`  ${first.contextLabel || "?"} / ${first.title || "?"}  （総 ${first.total ?? "?"} 問）`);
  await waitForGo("\n  → 開始するには Enter を押してください… ");
  console.log("");

  const { advanced } = await clearReview(page, index, {
    auto: AUTO_UNKNOWN,
    maxQuestions: MAX_QUESTIONS,
    waitForGo,
    dumpDir: __dirname,
  });

  if (advanced) {
    await sleep(2500);
    await ctx.close().catch(() => {});
    process.exit(0);
  } else {
    // 自動遷移できなければブラウザを開いたまま残す（手動操作/診断のため・スクリプトは待機）。
    console.log("\n  ブラウザは開いたままにしています。完了画面が出ていれば手動で『次のレッスンへ』を押せます。");
    console.log("  （このスクリプトは終了せず待機します。確認できたら Ctrl+C で停止してください）");
  }
}
