// 復習（再テスト）の自動突破。
// ドリルの「復習」は本編で取り込み済みの問題の再テストなので、保存済み studyLog の正解で
// 答えれば AI を再課金せずに突破できる。完了画面（88%以上で「レッスン完了!」）の
// 「次のレッスンへ」を自動クリックするところまでがこのスクリプトの役割（ロードマップ②）。
//
// 前提:
//   1) 別端末（または preview 管理）で dev サーバ起動: npm run dev  (http://localhost:3000)
//      ※ 保存済み studyLog を GET /api/study-log から読むため dev が要る。
//   2) このスクリプトを起動:                          node scripts/drill-review.mjs
//   3) 開いた Chromium で drill.ma-ji.ai にログインし、突破したいレッスンの
//      「復習の Q1 問題画面」まで進めて放置 → 開始合図（Enter / scripts/.review-go）。
//
// 設計（ロードマップ②・本セッションのユーザー決定）:
//   - 既知問題（studyLog にある）= 保存済み正解で回答し、import POST はしない（再課金なし）。
//   - 未知問題（studyLog に無い）= 「報告し相談」＝明示報告して一時停止。再開後は安全側で
//     option-0 を回答して前進し、未知リストに記録（取り込みは別途 drill-import で行う方針）。
//     ※ AUTO_UNKNOWN=1 で止めずに進める無人モード（③のループ用フック）。
//   - 並べ替え/マッチングは単一正解ラベルが無いため機械的に回答（88%マージンで1つ外しても通る）。

import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";
import readline from "readline";
import fs from "fs";
import { readState, sleep } from "./drill-dom.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GO_FILE = path.join(__dirname, ".review-go");
const PROFILE_DIR = path.join(__dirname, ".pw-profile");
const START_URL = "https://drill.ma-ji.ai/";
const STUDYLOG_API = process.env.REVIEW_API ?? "http://localhost:3000/api/study-log";
const MAX_QUESTIONS = parseInt(process.env.MAX_QUESTIONS ?? "60", 10);
const AUTO_UNKNOWN = process.env.AUTO_UNKNOWN === "1";

// 開始合図／未知問題の確認待ち（import.mjs と同じ仕組み）。
// - TTY: Enter キー / 非TTY: scripts/.review-go ファイルが作られたら再開。
function waitForGo(prompt) {
  if (process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => rl.question(prompt, () => { rl.close(); resolve(); }));
  }
  try { fs.unlinkSync(GO_FILE); } catch {}
  console.log(prompt);
  console.log(`  (バックグラウンド実行のため、確認後に ${GO_FILE} が作成されたら再開します)`);
  return new Promise((resolve) => {
    const t = setInterval(() => {
      if (fs.existsSync(GO_FILE)) { clearInterval(t); try { fs.unlinkSync(GO_FILE); } catch {} resolve(); }
    }, 1000);
  });
}

// --- 保存済み解説から「正解テキスト」「問題文」を取り出す純関数 ---
// 私用領域(U+E000–U+F8FF)の Font Awesome アイコングリフ（例 U+F21D/F21E）を除去する。
// ドリルは選択肢や正解テキストにアイコングリフを混ぜることがあり、これが入ったままだと
// 表示選択肢（グリフ無し）と保存正解（グリフ有り）が一致しない（実データで確認済み）。
const stripGlyphs = (s) => (s || "").replace(/[-]/g, "");
const normKey = (s) => stripGlyphs(s).replace(/\s+/g, "").trim();

// 保存解説の「## 問題」本文（照合キー）。無ければ空。
export function extractQuestion(expl) {
  if (!expl) return "";
  const m = expl.match(/##\s*問題\s*\n+([\s\S]*?)(?:\n#{2,3}\s|$)/);
  return m ? m[1].trim() : "";
}

// 保存解説から正解の選択肢テキスト（接頭字なし）。読めなければ null。
// 優先: **正解: …** → インライン「- **…** ✅ 正解」→ ○✕の「## 答え\n<判定>」→ 旧「## 正解\n…」。
export function extractCorrect(expl) {
  if (!expl) return null;
  let m = expl.match(/\*\*正解[:：]\s*([^\n*]+?)\s*\*\*/);
  if (m) return stripGlyphs(m[1]).trim();
  m = expl.match(/^-\s*\*\*(.+?)\*\*\s*✅\s*正解/m);
  if (m) return stripGlyphs(m[1]).trim();
  // ○✕（truefalse）: 「## 答え」直後の先頭判定語だけを取る（本文「間違い。…」全体は取らない）。
  // 表示選択肢は「正しい/間違い」（または ○/×）なので判定語に一致させる。
  m = expl.match(/##\s*答え\s*\n+\s*[「『"'（(]?\s*(正しい|間違い|○|×|まる|ばつ|はい|いいえ)/);
  if (m) return m[1].trim();
  m = expl.match(/##\s*正解\s*\n+\s*([^\n]+)/);
  if (m) return stripGlyphs(m[1]).trim();
  return null;
}

// 並べ替え/マッチングの項目照合用のゆるい正規化:
// グリフ除去 + 読み仮名 (かな/カナのみの括弧) 除去 + 全空白除去。
// 例「Next.js（ネクストジェーエス）が組み込んでいる」→「Next.jsが組み込んでいる」。
export const normLoose = (s) =>
  stripGlyphs(s || "")
    .replace(/[（(][ぁ-んァ-ヶゔー・]+[）)]/g, "")
    .replace(/\s+/g, "")
    .trim();

// 候補配列 cands から target にゆるく一致する要素の index を返す（無ければ -1）。
// 完全一致 → 一意な包含（短い方が4字以上）。
export function findLoose(cands, target) {
  const t = normLoose(target);
  if (!t) return -1;
  const ns = cands.map(normLoose);
  let i = ns.indexOf(t);
  if (i !== -1) return i;
  const hits = [];
  for (let j = 0; j < ns.length; j++) {
    const a = ns[j];
    if (a.length >= 4 && (a.includes(t) || t.includes(a))) hits.push(j);
  }
  return hits.length === 1 ? hits[0] : -1;
}

// 「### 正しい順序」/「## 正しい順序」の番号付きリスト → 手順テキスト配列（順序どおり）。
export function extractOrder(expl) {
  if (!expl) return [];
  const m = expl.match(/#{2,3}\s*正しい順序\s*\n([\s\S]*?)(?:\n#{2,3}\s|$)/);
  if (!m) return [];
  return [...m[1].matchAll(/^\s*\d+[.\．、)]\s*(.+?)\s*$/gm)].map((x) => x[1].trim()).filter(Boolean);
}

// 「### 正しい対応」/「## 正しい対応」の「左 → 右」/「左 ↔ 右」行 → {left,right} 配列。
export function extractPairs(expl) {
  if (!expl) return [];
  const m = expl.match(/#{2,3}\s*正しい対応\s*\n([\s\S]*?)(?:\n#{2,3}\s|$)/);
  if (!m) return [];
  const pairs = [];
  for (const line of m[1].split("\n")) {
    const mm = line.match(/^\s*[-*・]?\s*(.+?)\s*(?:→|↔|⇔|->)\s*(.+?)\s*$/);
    if (mm) pairs.push({ left: mm[1].trim(), right: mm[2].trim() });
  }
  return pairs;
}

// 選択肢ラベル o が正解 correct と一致するか（app/api/import-question/route.ts と同じロジック）。
// 実ドリルの選択肢は先頭に「A」「B」…の記号が付くが保存正解は記号なしのため、前方差1〜2字も許容。
export function optionMatchesCorrect(option, correct) {
  const o = stripGlyphs(option).trim();
  const c = stripGlyphs(correct).trim();
  if (!c) return false;
  if (o === c) return true;
  return o.endsWith(c) && o.length - c.length <= 2;
}

// studyLog 全体 → 既知問題インデックス（正規化した問題文 → {correctText, info, lesson}）。
export function buildIndex(studyLog) {
  const index = new Map();
  for (const c of studyLog.courses ?? []) {
    for (const l of c.lessons ?? []) {
      for (const q of l.questions ?? []) {
        const expl = q.explanation || "";
        const qtext = extractQuestion(expl) || q.keyLearning || "";
        const key = normKey(qtext);
        if (!key) continue;
        index.set(key, {
          correctText: extractCorrect(expl),
          order: extractOrder(expl),
          pairs: extractPairs(expl),
          info: q.questionInfo,
          lesson: l.lessonName,
          course: c.courseName,
        });
      }
    }
  }
  return index;
}

// 表示中の問題文をインデックスに照合。完全一致 → 一意な包含一致。曖昧/不在は null。
export function lookup(index, questionText) {
  const key = normKey(questionText);
  if (!key) return null;
  if (index.has(key)) return index.get(key);
  const hits = [];
  for (const [k, v] of index) {
    if (k.length >= 12 && (k.includes(key) || key.includes(k))) hits.push(v);
  }
  return hits.length === 1 ? hits[0] : null; // 0件=未知 / 複数=曖昧 はどちらも未知扱い（報告）
}

// このファイルが直接実行されたときだけブラウザを起動する（純関数は単体テストから import 可能）。
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();

async function main() {
  // 保存済み studyLog を取得してインデックス化
  let index = new Map();
  try {
    const res = await fetch(STUDYLOG_API);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    index = buildIndex(await res.json());
    console.log(`studyLog 取得 OK（既知問題 ${index.size} 件）`);
  } catch (e) {
    console.log(`⚠ studyLog を取得できません（dev サーバは起動中？ ${STUDYLOG_API}）: ${e.message}`);
    console.log("  既知判定ができないため、全問が「未知」として報告されます。");
  }

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

  const seen = new Set();
  let known = 0;
  const unknownList = [];

  for (let i = 0; i < MAX_QUESTIONS; i++) {
    await page.waitForSelector('[data-testid^="quiz-answer-option-"]', { timeout: 30000 }).catch(() => {});
    const s = await readState(page);
    if (!s.qnum) { console.log("Q番号を取得できませんでした。終了します。"); break; }
    if (seen.has(s.qnum)) { console.log(`${s.qnum} は処理済み。進まなくなったため終了します。`); break; }
    seen.add(s.qnum);

    const hit = lookup(index, s.questionText);
    const kindLabel = s.isMatching ? "[線結び]" : s.isOrdering ? "[並べ替え]" : "[選択]";

    if (!s.answered) {
      if (s.isMatching) {
        // マッチング: 保存解説の「正しい対応」で接続。読めなければ左[i]→右[i]（best effort）。
        const pairs = hit?.pairs ?? [];
        if (pairs.length) { known += 1; console.log(`[${s.qnum}]${kindLabel} 既知 → 正しい対応で接続（${pairs.length}ペア）`); }
        else console.log(`[${s.qnum}]${kindLabel} ${hit ? "既知(対応不明)" : "未知"} 機械接続: ${s.questionText.slice(0, 30)}…`);
        await answerMatching(page, s, pairs);
      } else if (s.isOrdering) {
        // 並べ替え: 保存解説の「正しい順序」でタップ。読めなければ上から順（best effort）。
        const order = hit?.order ?? [];
        if (order.length) { known += 1; console.log(`[${s.qnum}]${kindLabel} 既知 → 正しい順序でタップ（${order.length}手順）`); }
        else console.log(`[${s.qnum}]${kindLabel} ${hit ? "既知(順序不明)" : "未知"} 上から順タップ: ${s.questionText.slice(0, 30)}…`);
        await answerOrdering(page, s, order);
      } else {
        // 選択式: 既知＆正解がマップできれば正解をクリック。できなければ未知扱い。
        let idx = -1;
        if (hit && hit.correctText) idx = s.options.findIndex((o) => optionMatchesCorrect(o, hit.correctText));
        if (idx >= 0) {
          known += 1;
          console.log(`[${s.qnum}]${kindLabel} 既知 → 正解「${s.options[idx]}」を選択`);
          await page.click(`[data-testid="quiz-answer-option-${idx}"]`).catch(() => {});
        } else {
          // 未知（または保存正解を表示選択肢にマップできない）→ 報告し相談
          unknownList.push(s.qnum);
          console.log(`\n  ⚠ 未知の問題（studyLog に見つかりません）: ${s.qnum}`);
          console.log(`     問題: ${s.questionText}`);
          console.log(`     選択肢: ${JSON.stringify(s.options)}`);
          if (hit) console.log(`     （照合はヒットしたが保存正解を表示選択肢に対応づけできず）`);
          if (!AUTO_UNKNOWN) {
            await waitForGo("     → 確認したら Enter で再開（option-0 を回答して前進します）… ");
          } else {
            console.log("     （AUTO_UNKNOWN=1: 止めずに option-0 で前進）");
          }
          await page.click('[data-testid="quiz-answer-option-0"]').catch(() => {});
        }
        await page.waitForSelector('[data-testid="quiz-submit"]', { timeout: 8000 }).catch(() => {});
        await page.click('[data-testid="quiz-submit"]').catch(() => {});
      }
    }

    await page.waitForSelector('[data-testid="quiz-feedback"]', { timeout: 15000 }).catch(() => {});
    const a = await readState(page);
    if (a.verdict) console.log(`     判定: ${a.verdict}`);

    // 次へ進む。通常問は「次の問題へ」だが、最終問は結果/完了画面へ進む別ラベルのことがある。
    const advanceLabels = ["次の問題へ", "結果を見る", "結果へ", "スコアを見る", "次へ", "終了する", "終了", "完了する", "レッスンを終える"];
    let clicked = null;
    for (const lab of advanceLabels) {
      const loc = page.getByText(lab, { exact: true });
      if ((await loc.count().catch(() => 0)) > 0) { await loc.first().click().catch(() => {}); clicked = lab; break; }
    }
    if (!clicked) {
      // どの遷移ボタンも見つからない＝既に完了画面 or 想定外。DOMをダンプして抜ける（診断用）。
      try { fs.writeFileSync(path.join(__dirname, `drill-dump.review-end-${s.qnum}.html`), await page.content(), "utf-8"); } catch {}
      break;
    }
    if (clicked !== "次の問題へ") console.log(`     （最終遷移: 「${clicked}」をクリック）`);
    await sleep(1500);
    // 完了画面（レッスン完了 / 次のレッスンへ）に到達したらループ脱出
    const atDone = await page
      .evaluate(() => /レッスン完了|次のレッスンへ/.test(document.body.innerText || ""))
      .catch(() => false);
    if (atDone) break;
  }

  // --- 完了処理 ---
  // 結果画面はアニメ/遅延で描画されるため、最大20秒ポーリングして「完了 or 次のレッスンへ」を待つ。
  // 内側の評価は完了状態を返す（次のレッスンへ等に隣接する私用領域グリフは strip で除去）。
  let done = { cleared: false, score: null, pct: null, hasNext: false, hasRetry: false };
  for (let _i = 0; _i < 10; _i++) {
  done = await page.evaluate(() => {
    const strip = (s) => (s || "").replace(/[-]/g, "");
    const body = strip(document.body.innerText || "").replace(/\s+/g, " ");
    const scoreM = body.match(/(\d+)\s*\/\s*(\d+)\s*正解/);
    const pctM = body.match(/(\d+)\s*%\s*正答率/) || body.match(/(\d+)\s*%/);
    document.querySelectorAll("[data-review-btn]").forEach((el) => el.removeAttribute("data-review-btn"));
    const tag = (label) => {
      for (const el of document.querySelectorAll("div[tabindex], div")) {
        if (strip(el.textContent).replace(/\s+/g, " ").trim() === label) {
          el.setAttribute("data-review-btn", label);
          return true;
        }
      }
      return false;
    };
    return {
      cleared: /レッスン完了/.test(body),
      score: scoreM ? `${scoreM[1]}/${scoreM[2]}` : null,
      pct: pctM ? `${pctM[1]}%` : null,
      hasNext: tag("次のレッスンへ"),
      hasRetry: tag("もう一度"),
    };
  });
    if (done.cleared || done.hasNext || done.hasRetry) break;
    await sleep(2000);
  }

  // 完了画面のDOMを保存（検証/診断用）。
  try { fs.writeFileSync(path.join(__dirname, "drill-dump.review-complete.html"), await page.content(), "utf-8"); } catch {}

  console.log("\n=== 完了画面 ===");
  console.log(`  ${done.cleared ? "レッスン完了!" : "（完了画面を検出できず）"}  正答 ${done.score ?? "?"}  正答率 ${done.pct ?? "?"}`);

  let advanced = false;
  if (done.hasNext) {
    // グリフ隣接に強い hasText（部分一致）→ tag 済み要素 → getByText の順で押す。
    const byTab = page.locator('div[tabindex="0"]').filter({ hasText: "次のレッスンへ" });
    let target;
    if ((await byTab.count()) > 0) target = byTab.first();
    else if ((await page.locator('[data-review-btn="次のレッスンへ"]').count()) > 0) target = page.locator('[data-review-btn="次のレッスンへ"]').first();
    else target = page.getByText("次のレッスンへ").first();
    await target.click().catch(() => {});
    advanced = true;
    console.log("  → 「次のレッスンへ」をクリックしました。");
  } else {
    console.log("  ⚠ 「次のレッスンへ」が見つかりません。開いたままのブラウザを確認してください。");
  }

  console.log("\n=== サマリ ===");
  console.log(`  既知（保存済み正解で自動回答）: ${known} 問`);
  console.log(`  未知（報告）: ${unknownList.length} 問 ${unknownList.length ? JSON.stringify(unknownList) : ""}`);
  console.log(`  正答率: ${done.pct ?? "?"} / 次レッスンへ遷移: ${advanced ? "あり" : "なし"}`);
  if (unknownList.length) {
    console.log("  ※ 未知問題は drill-import.mjs で取り込んでから再実行すると次回は自動突破できます。");
  }

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

// マッチング（線結び）。pairs（保存解説の正しい対応）があればそれで接続。
// 各ペアは表示の左選択肢・右項目へゆるく照合（読み仮名差を吸収）。pairs 無しは左[i]→右[i]。
async function answerMatching(page, s, pairs = []) {
  // 接続する [左option index, 右項目テキスト] の列を決める。
  let plan;
  if (pairs.length) {
    plan = [];
    for (const p of pairs) {
      const li = findLoose(s.options, p.left);
      const ri = findLoose(s.rightItems, p.right);
      if (li !== -1 && ri !== -1) plan.push([li, s.rightItems[ri]]);
    }
    // 全ペアを対応づけられなければ機械接続に退避（部分的な取りこぼし防止）。
    if (plan.length !== Math.min(s.options.length, s.rightItems.length)) {
      console.log(`     ⚠ 対応づけ ${plan.length}/${Math.min(s.options.length, s.rightItems.length)} のみ → 機械接続に退避`);
      plan = null;
    }
  }
  if (!plan) {
    const n = Math.min(s.options.length, s.rightItems.length);
    plan = Array.from({ length: n }, (_, i) => [i, s.rightItems[i]]);
  }

  for (const [li, rightLabel] of plan) {
    await page.click(`[data-testid="quiz-answer-option-${li}"]`, { timeout: 5000 }).catch(() => {});
    await sleep(500);
    // 右項目は data-testid 無し → 問題コンテナ内をテキスト一致で特定し一時タグ付け→クリック。
    await page.evaluate(
      ({ label }) => {
        const norm = (x) => (x || "").replace(/\s+/g, " ").trim();
        const leftEls = [...document.querySelectorAll('[data-testid^="quiz-answer-option-"]')];
        let container = leftEls[0] || document.body;
        while (container && !leftEls.every((o) => container.contains(o))) container = container.parentElement;
        container = container || document.body;
        document.querySelectorAll("[data-import-ri]").forEach((el) => el.removeAttribute("data-import-ri"));
        for (const el of container.querySelectorAll("div[tabindex]:not([data-testid])")) {
          if (norm(el.textContent) === label) { el.setAttribute("data-import-ri", "1"); break; }
        }
      },
      { label: rightLabel }
    );
    await page.click('[data-import-ri="1"]', { timeout: 5000 }).catch(() => {});
    await sleep(500);
  }
  await sleep(400);
  await page.click('[data-testid="quiz-submit"]', { timeout: 5000 }).catch(() => {});
  await page.getByText("確定", { exact: true }).first().click({ timeout: 3000 }).catch(() => {});
}

// 並べ替え。order（保存解説の正しい順序）があればその順にタップ。
// タップすると消えるので、毎回現在の選択肢を読み直して該当をタップ。order 無しは上から順。
async function answerOrdering(page, s, order = []) {
  if (order.length) {
    for (const step of order) {
      // 現在残っている選択肢テキストを読み、該当を探してクリック
      const remaining = await page.$$('[data-testid^="quiz-answer-option-"]');
      if (remaining.length === 0) break;
      const texts = [];
      for (const el of remaining) texts.push(((await el.textContent()) || "").replace(/\s+/g, " ").trim());
      const idx = findLoose(texts, step);
      if (idx !== -1) await remaining[idx].click().catch(() => {});
      else await remaining[0].click().catch(() => {}); // 取りこぼしは先頭で前進
      await sleep(600);
    }
  } else {
    for (let k = 0; k < s.options.length + 1; k++) {
      const remaining = await page.$$('[data-testid^="quiz-answer-option-"]');
      if (remaining.length === 0) break;
      await remaining[0].click().catch(() => {});
      await sleep(600);
    }
  }
  await sleep(500);
  await page.click('[data-testid="quiz-submit"]', { timeout: 3000 }).catch(() => {});
  await page.getByText("回答する", { exact: true }).first().click({ timeout: 3000 }).catch(() => {});
}
