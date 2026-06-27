// 実「間違えた問題だけの復習」のフロー観察用スクリプト（受動＝あなたが手で回答する）。
// 目的: ①レッスン終了→結果画面→「復習(誤答のみ)」を起動するボタン の遷移を捕捉し、
//   ②復習の1問ごとの遷移（手動「次の問題へ」か自動か）を正確に判定して、clearReview を
//   実復習仕様に合わせる材料を得る。
//
// 使い方:
//   node scripts/drill-inspect-review.mjs
//   → 開いた Chromium で drill.ma-ji.ai にログイン
//   → レッスンを誤答込みで最後まで解く → 結果画面で『復習する(誤答のみ)』に入る → 最後まで
//   → このスクリプトが画面の変化を時刻つきで記録（一切クリックしない・純粋な観察）。Ctrl+C で終了。
//
// 強化点（前回の誤診対策）:
//   - 遷移の「自動/手動」判定: 直前スナップショットのボタン状態を記憶して比較する
//     （遷移後の状態を見ると常に「自動」に見える＝前回の誤診原因）。
//   - 本当の問題遷移は qnum で検知（回答後 questionText は解説文に化けるため問題文では誤検知する）。
//   - クイズ画面以外（結果/完了画面）ではクリック可能ボタンを全部ログ＝「復習する/もう一度/次の
//     レッスンへ」等を捕捉。

import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";
import { readState, sleep } from "./drill-dom.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = path.join(__dirname, ".pw-profile");
const START_URL = "https://drill.ma-ji.ai/";

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  viewport: { width: 430, height: 900 },
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto(START_URL, { waitUntil: "domcontentloaded" }).catch(() => {});

console.log("\n=== 実復習フロー観察 v2（受動・あなたが手で回答） ===");
console.log("drill にログイン → レッスンを誤答込みで終え → 結果画面で『復習する(誤答のみ)』に入り最後まで。");
console.log("結果/完了画面ではクリック可能ボタンを全部記録します。Ctrl+C で終了。\n");

// 画面の要約スナップショット。クイズ画面/結果画面の双方の信号を返す。
const snap = () =>
  page.evaluate(() => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const strip = (s) => (s || "").replace(/[-]/g, "");
    const body = strip(norm(document.body.innerText || ""));
    const optEls = [...document.querySelectorAll('[data-testid^="quiz-answer-option-"]')];
    const submit = document.querySelector('[data-testid="quiz-submit"]');
    const fb = document.querySelector('[data-testid="quiz-feedback"]');
    const onQuiz = optEls.length > 0;

    // クリック可能な短いラベル（結果/完了画面の「復習する」「もう一度」「次のレッスンへ」等を拾う）。
    const btns = [
      ...new Set(
        [...document.querySelectorAll('div[tabindex], button, [role="button"]')]
          .map((e) => strip(norm(e.textContent)))
          .filter((t) => t && t.length <= 12)
      ),
    ];
    // 結果画面のスコア/正答率
    const scoreM = body.match(/(\d+)\s*\/\s*(\d+)\s*正解/);
    const pctM = body.match(/(\d+)\s*%/);

    // Q番号（本当の問題遷移の検知に使う＝回答後 questionText が解説に化けても qnum は問題に紐づく）
    let qnum = null;
    for (const el of document.querySelectorAll("div")) {
      const t = norm(el.textContent);
      if (/^Q\d+$/.test(t)) { qnum = t; break; }
    }

    return {
      onQuiz,
      nOpts: optEls.length,
      hasSubmit: !!submit,
      hasFb: !!fb,
      fbVerdict: fb ? strip(norm(fb.textContent)).slice(0, 8) : null,
      qnum,
      btns,
      score: scoreM ? `${scoreM[1]}/${scoreM[2]}` : null,
      pct: pctM ? `${pctM[1]}%` : null,
      bodyHead: body.slice(0, 60),
    };
  }).catch(() => null);

// 何か（クイズ画面 or 結果画面）が出るまで待つ
let ready = false;
const deadline = Date.now() + 600000;
while (Date.now() < deadline) {
  const s = await snap();
  if (s && (s.onQuiz || s.btns.length)) { ready = true; break; }
  await sleep(800);
}
if (!ready) { console.log("画面を検出できませんでした。終了します。"); await ctx.close().catch(() => {}); process.exit(1); }

console.log(">>> 観察開始。手で操作してください。\n");

const t0 = Date.now();
const ts = () => ((Date.now() - t0) / 1000).toFixed(1);

let prev = null;        // 直前スナップショット（遷移時の「直前のボタン状態」判定に使う）
let prevKey = "";
let prevQnum = null;

for (let i = 0; i < 1800; i++) {
  const s = await snap();
  if (s) {
    const key = JSON.stringify(s);
    if (key !== prevKey) {
      if (s.onQuiz) {
        console.log(`[t=${ts()}s] [クイズ] ${s.qnum ?? "?"} opts=${s.nOpts} submit=${s.hasSubmit} fb=${s.fbVerdict ?? "-"}`);
      } else {
        // 結果/完了画面: ボタン一覧・スコアを記録
        console.log(`[t=${ts()}s] [非クイズ画面] score=${s.score ?? "-"} pct=${s.pct ?? "-"} 本文頭=「${s.bodyHead}」`);
        console.log(`            クリック可能ボタン=${JSON.stringify(s.btns)}`);
      }
      prevKey = key;
    }

    // フィードバック出現の瞬間
    if (s.hasFb && (!prev || !prev.hasFb)) {
      console.log(`[t=${ts()}s] ✓ フィードバック出現 verdict=「${s.fbVerdict ?? "?"}」`);
    }

    // 本当の問題遷移は qnum 変化で検知。直前スナップショットに遷移ボタンがあったか＝手動/自動の判定。
    if (s.onQuiz && s.qnum && s.qnum !== prevQnum && prevQnum !== null) {
      const prevBtns = prev ? prev.btns.filter((b) => /次の問題|結果|次へ|終了|完了|つぎ|すすむ/.test(b)) : [];
      const verdict = prevBtns.length ? `手動遷移（直前に ${JSON.stringify(prevBtns)} があった）` : "★自動遷移の可能性（直前に遷移ボタン無し）";
      console.log(`[t=${ts()}s] ▶ 問題遷移 ${prevQnum} → ${s.qnum}：${verdict}`);
    }
    if (s.onQuiz && s.qnum) prevQnum = s.qnum;

    prev = s;
  }
  await sleep(400);
}

console.log("\n観察終了。Ctrl+C で閉じてください（ブラウザは開いたまま）。");
