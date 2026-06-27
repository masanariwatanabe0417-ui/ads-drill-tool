// ドリル自動取り込み（1レッスン一括）。
// drill.ma-ji.ai のレッスンを自動で「解答→正解・解説を取得→AI解説生成→studyLogへ保存」する。
//
// 前提:
//   1) 別ターミナルで dev サーバを起動しておく:  npm run dev   (http://localhost:3000)
//   2) このスクリプトを起動:                     node scripts/drill-import.mjs
//   3) 開いた Chromium で drill.ma-ji.ai にログイン（プロフィールは保存済みなら不要）し、
//      取り込みたいレッスンの「Q1 の問題画面」まで進めて放置する。
//   → 自動で最後の問題まで巡回し、各問を /api/import-question 経由で保存する。
//
// 注意: ツールが自動で解答ボタンを押すため、ドリル側の進捗に「回答済み（時に誤答）」が記録される。
//
// 階層(シリーズ/コース/レッスン)は DOM から自動検出するが、外れたら環境変数で上書きできる:
//   SERIES="Next.jsとデプロイ" COURSE="シリーズツアー" LESSON="Lesson 2 作って届ける流れ" node scripts/drill-import.mjs
//
// セレクタ根拠（scripts/drill-dump.05.html で確認済み）:
//   選択肢   [data-testid^="quiz-answer-option-"]（aria-label がラベル。正解は aria-label に「正解」が付く）
//   確定     [data-testid="quiz-submit"]（「回答する」）
//   回答後   [data-testid="quiz-feedback"]（「正解！」＋「マスターのワンポイント」解説）
//   次へ     テキスト「次の問題へ」

import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";
import readline from "readline";
import fs from "fs";
import { readState, sleep } from "./drill-dom.mjs";
import { fetchIndex, clearReview, answerChoice, answerCloze } from "./drill-review-core.mjs";

const __dirnameEarly = path.dirname(fileURLToPath(import.meta.url));
const GO_FILE = path.join(__dirnameEarly, ".import-go");

// 取り込み先の階層を確認してから開始するための「開始合図」待ち。
// - 自分のターミナルで実行（TTY）した場合: Enter キーで開始
// - バックグラウンド実行（TTYなし）の場合: ファイル scripts/.import-go が作られたら開始
//   （操作者がログ上の階層を確認後に作成する。Enter を押せない環境でも確認を挟める）
function waitForGo(prompt) {
  if (process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => rl.question(prompt, () => { rl.close(); resolve(); }));
  }
  try { fs.unlinkSync(GO_FILE); } catch {}
  console.log(prompt);
  console.log(`  (バックグラウンド実行のため、確認後に ${GO_FILE} が作成されたら開始します)`);
  return new Promise((resolve) => {
    const t = setInterval(() => {
      if (fs.existsSync(GO_FILE)) { clearInterval(t); try { fs.unlinkSync(GO_FILE); } catch {} resolve(); }
    }, 1000);
  });
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = path.join(__dirname, ".pw-profile");
const START_URL = "https://drill.ma-ji.ai/";
const API = process.env.IMPORT_API ?? "http://localhost:3000/api/import-question";
const STUDYLOG_API = process.env.REVIEW_API ?? "http://localhost:3000/api/study-log";
const MAX_QUESTIONS = parseInt(process.env.MAX_QUESTIONS ?? "60", 10);
const AUTO_UNKNOWN = process.env.AUTO_UNKNOWN === "1";
// 取り込み後の「復習クリア（②）」を行わず取り込みだけで止めたい場合は NO_REVIEW=1。
const NO_REVIEW = process.env.NO_REVIEW === "1";

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  viewport: { width: 430, height: 900 },
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto(START_URL, { waitUntil: "domcontentloaded" }).catch(() => {});

console.log("\n==============================================");
console.log(" ドリル自動取り込み（1レッスン一括）");
console.log(" 1) drill.ma-ji.ai にログイン");
console.log(" 2) 取り込みたいレッスンの『Q1 の問題画面』まで進める");
console.log(" 3) そのまま放置（自動で最後の問題まで取り込みます）");
console.log(" 中断は Ctrl+C");
console.log("==============================================\n");

// 問題画面（解答ボタンが出ている状態）になるまで最大10分待つ＝ユーザーがログイン・移動する時間。
// この待機中、ホーム画面に「学習中のシリーズ」が見えていればシリーズ名を先取りして覚えておく。
// （クイズ画面に入るとシリーズ名がDOMから消えるため、ここで拾えないと空になる）
console.log("問題画面（解答ボタン）が表示されるのを待っています…（最大10分）");
let capturedSeries = "";
const waitDeadline = Date.now() + 600000;
while (Date.now() < waitDeadline) {
  const s = await page
    .evaluate(() => {
      const norm = (x) => (x || "").replace(/\s+/g, " ").trim();
      const texts = [...document.querySelectorAll('div[dir="auto"]')].map((e) => norm(e.textContent));
      const i = texts.findIndex((t) => t === "学習中のシリーズ");
      return i !== -1 && texts[i + 1] ? texts[i + 1] : "";
    })
    .catch(() => "");
  if (s) capturedSeries = s;
  if (await page.$('[data-testid^="quiz-answer-option-"]')) break;
  await sleep(1000);
}
if (!(await page.$('[data-testid^="quiz-answer-option-"]'))) {
  console.log("問題画面を検出できませんでした（10分経過）。終了します。");
  await ctx.close().catch(() => {});
  process.exit(1);
}
console.log(`問題画面を検出。取り込みを開始します。${capturedSeries ? `（シリーズ先取り: ${capturedSeries}）` : ""}\n`);

// （readState は scripts/drill-dom.mjs に移設・共有。挙動は不変。）

// タイトルから「Lesson N <タイトル>」形式を復元（ナビ一覧に番号があれば付与）
async function resolveLessonName(title) {
  if (!title) return title;
  const lesson = await page.evaluate((title) => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const texts = [...document.querySelectorAll('div[dir="auto"]')]
      .filter((el) => !el.querySelector('div[dir="auto"]'))
      .map((el) => norm(el.textContent));
    for (let i = 0; i < texts.length; i++) {
      if (texts[i] === title && i > 0 && /^Lesson\s*\d+$/i.test(texts[i - 1])) {
        return `${texts[i - 1]} ${title}`;
      }
    }
    return null;
  }, title);
  return lesson || title;
}

// 階層を1回だけ確定（環境変数で上書き可）
const first = await readState(page);
const series = process.env.SERIES || first.series || capturedSeries || "不明シリーズ";
const course = process.env.COURSE || first.contextLabel || "不明コース";
const lesson = process.env.LESSON || (await resolveLessonName(first.title)) || first.title || "不明レッスン";

console.log("=== 取り込み先（階層）===");
console.log(`  シリーズ: ${series}`);
console.log(`  コース  : ${course}`);
console.log(`  レッスン: ${lesson}`);
console.log(`  総問題数: ${first.total ?? "不明"}`);
console.log("");
console.log("  この3行が画面と一致していれば Enter キーで取り込み開始。");
console.log("  違う / 「不明〜」がある場合は Ctrl+C して、");
console.log("  SERIES=... COURSE=... LESSON=... を付けて再実行してください。");
await waitForGo("\n  → 開始するには Enter を押してください… ");
console.log("");

const seen = new Set();
let imported = 0;

// ONLY="Q5,Q7" を指定すると、その問だけ保存（POST）し、他は巡回（解答して次へ）のみ。
// 既に良好に取り込めた問を上書きせず、特定問だけ再検証・修正したいときに使う。
const onlyTargets = process.env.ONLY
  ? new Set(process.env.ONLY.split(",").map((x) => x.trim()).filter(Boolean))
  : null;

for (let i = 0; i < MAX_QUESTIONS; i++) {
  // 解答ボタンが出るまで待つ（次問の読み込み待ち）
  await page.waitForSelector('[data-testid^="quiz-answer-option-"]', { timeout: 30000 }).catch(() => {});
  const s = await readState(page);
  if (!s.qnum) { console.log("Q番号を取得できませんでした。終了します。"); break; }
  if (seen.has(s.qnum)) { console.log(`${s.qnum} は処理済み。進まなくなったため終了します。`); break; }
  seen.add(s.qnum);

  const kind = s.isMatching ? "matching" : s.isOrdering ? "ordering" : s.isCloze ? "cloze" : "choice";
  const kindLabel = s.isMatching ? "[線結び]" : s.isOrdering ? "[並べ替え]" : s.isCloze ? `[穴埋め×${s.clozeBlanks}]` : "";
  console.log(
    `[${s.qnum}]${kindLabel} ${s.questionText.slice(0, 40)}…  左=${JSON.stringify(s.options)}` +
      (s.isMatching ? ` 右=${JSON.stringify(s.rightItems)}` : "")
  );

  // まだ回答していなければ回答する
  if (!s.answered) {
    if (s.isMatching) {
      // マッチング（線結び）: 左[i] をタップ → 右[i] をタップ で1ペア接続、を全ペア繰り返す。
      // 正誤は問わない（解説に正しい対応が含まれる／88%閾値で1つ外れても完了する）。
      const pairCount = Math.min(s.options.length, s.rightItems.length);
      for (let i = 0; i < pairCount; i++) {
        await page.click(`[data-testid="quiz-answer-option-${i}"]`, { timeout: 5000 }).catch(() => {});
        await sleep(500);
        // 右項目は data-testid が無いため、問題コンテナ内をテキストで特定して一時タグ付け→クリック。
        await page.evaluate(
          ({ idx, label }) => {
            const norm = (x) => (x || "").replace(/\s+/g, " ").trim();
            const leftEls = [...document.querySelectorAll('[data-testid^="quiz-answer-option-"]')];
            let container = leftEls[0] || document.body;
            while (container && !leftEls.every((o) => container.contains(o))) container = container.parentElement;
            container = container || document.body;
            document.querySelectorAll("[data-import-ri]").forEach((el) => el.removeAttribute("data-import-ri"));
            for (const el of container.querySelectorAll("div[tabindex]:not([data-testid])")) {
              if (norm(el.textContent) === label) { el.setAttribute("data-import-ri", String(idx)); break; }
            }
          },
          { idx: i, label: s.rightItems[i] }
        );
        await page.click(`[data-import-ri="${i}"]`, { timeout: 5000 }).catch(() => {});
        await sleep(500);
      }
      await sleep(400);
      await page.click('[data-testid="quiz-submit"]', { timeout: 5000 }).catch(() => {});
      await page.getByText("確定", { exact: true }).first().click({ timeout: 3000 }).catch(() => {});
    } else if (s.isOrdering) {
      // 並べ替え: 残っている選択肢を上から順にタップ（タップすると消える）。
      for (let k = 0; k < s.options.length + 1; k++) {
        const remaining = await page.$$('[data-testid^="quiz-answer-option-"]');
        if (remaining.length === 0) break;
        await remaining[0].click().catch(() => {});
        await sleep(600);
      }
      // 全項目を置いたあと、確定ボタンがあれば押す（自動送信でない形式に備える）
      await sleep(500);
      await page.click('[data-testid="quiz-submit"]', { timeout: 3000 }).catch(() => {});
      await page.getByText("回答する", { exact: true }).first().click({ timeout: 3000 }).catch(() => {});
    } else if (s.isCloze) {
      // cloze（複数空欄）: 空欄を blankCount 個ぶん埋めて確定（取り込みは前進＋公式解説取得が目的。
      // 正解シーケンスは保存解説から復習時に導く）。空欄順に先頭の選択肢を置く best effort。
      await answerCloze(page, [], s.clozeBlanks || s.options.length);
    } else {
      // 選択式: aria付き（○✕・通常4択）と aria無し（「選択肢から選んでください」型）の両対応。
      // 取り込みは常に先頭(index:0)を選んで回答（誤答でも公式解説＋枠色から正解を取得できる）。
      // 既選択の再タップで選択解除されるトグルを避ける堅牢版（answerChoice）に委譲。
      await answerChoice(page, { index: 0 });
    }
  }
  await page.waitForSelector('[data-testid="quiz-feedback"]', { timeout: 15000 }).catch(() => {});
  const a = await readState(page);

  // ONLY フィルタ: 対象外の問は保存せず巡回のみ（解答済みなので次へ進むだけ）。
  if (onlyTargets && !onlyTargets.has(s.qnum)) {
    console.log(`  (ONLY フィルタ: ${s.qnum} は保存スキップ)`);
  } else {
  // 並べ替え・マッチング・cloze は正解が単一ラベルでなく解説に正しい順序/対応/穴埋め語が含まれる
  // →解説が取れればOK。通常選択式は correctAnswer（aria か回答後の緑枠）が取れればOK。
  const captured = s.isOrdering || s.isMatching || s.isCloze ? !!a.explanation : !!a.correctAnswer;
  if (!captured) {
    console.log(`  ⚠ ${s.isOrdering || s.isMatching || s.isCloze ? "解説" : "正解"}を取得できませんでした（${s.qnum}）。この問はスキップします。`);
    // 取得失敗時は、回答確定後（または確定UI待ち）のDOMをデバッグ保存して原因を追えるようにする。
    // 選択式で正解が読めない＝aria-label の無い「選択肢から選んでください」型。フィードバックDOMと
    // 取得済み解説（公式解説に正解が書かれていれば後で抽出できる）も残して原因を追う。
    const tag = s.isMatching ? "matching" : s.isOrdering ? "ordering" : "choice";
    try {
      const dbg = path.join(__dirnameEarly, `drill-dump.${tag}-debug-${s.qnum}.html`);
      fs.writeFileSync(dbg, await page.content(), "utf-8");
      console.log(`    (デバッグ: ${dbg} を保存)`);
    } catch {}
    if (tag === "choice") {
      console.log(`    (取得済み解説の冒頭: ${(a.explanation || "(空)").replace(/\s+/g, " ").slice(0, 160)}…)`);
    }
  } else {
    if (s.isMatching) console.log(`  → [線結び] 判定: ${a.verdict} / 正しい対応は解説に含む`);
    else if (s.isOrdering) console.log(`  → [並べ替え] 判定: ${a.verdict} / 正解順は解説に含む`);
    else if (s.isCloze) console.log(`  → [穴埋め×${s.clozeBlanks}] 判定: ${a.verdict} / 正解シーケンスは解説から復習時に導出`);
    else console.log(`  → 正解: ${a.correctAnswer} / 判定: ${a.verdict}`);
    try {
      const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          series, course, lesson,
          kind,
          questionInfo: s.qnum,
          questionText: s.questionText,
          options: s.options,
          rightItems: s.isMatching ? s.rightItems : undefined,
          // cloze は単一正解でない（緑枠は1空欄ぶんしか示さず誤誘導）→ correctAnswer は送らない。
          // 正解シーケンスは公式解説（drillExplanation）から復習時に導く。
          correctAnswer: s.isCloze ? undefined : (a.correctAnswer ?? undefined),
          drillExplanation: a.explanation,
        }),
      });
      if (res.ok) {
        const j = await res.json();
        imported += 1;
        console.log(`  ✓ 保存: ${j.questionInfo}  keyLearning「${(j.keyLearning || "").slice(0, 30)}…」`);
      } else {
        console.log(`  ✗ 保存失敗 (${res.status}): ${(await res.text()).slice(0, 120)}`);
      }
    } catch (e) {
      console.log(`  ✗ APIに接続できません（dev サーバは起動中？）: ${e.message}`);
    }
  }
  } // end ONLY フィルタ

  // 次へ進む。判定は「次の問題へ」ボタンの有無だけに頼らない（問題種別により遷移ラベルが
  // 変わる＝例: aria無しの選択式では「次の問題へ」でなく「次へ」のことがある。これで以前は
  // 最終問と誤判定し途中で打ち切っていた）。Q番号と総数で最終問を判定し、ラベルは広めに探す。
  const qn = parseInt((s.qnum || "").replace(/\D/g, ""), 10);
  const isLast = !!s.total && !!qn && qn >= s.total;
  if (!isLast) {
    // 中間問: 次の問題へ進むボタンを広めに探して押す（結果/終了系は押さない）。
    const nextLabels = ["次の問題へ", "次へ"];
    let advanced = false;
    for (const lab of nextLabels) {
      const loc = page.getByText(lab, { exact: true });
      if ((await loc.count().catch(() => 0)) > 0) {
        await loc.first().click().catch(() => {});
        if (lab !== "次の問題へ") console.log(`  （遷移: 「${lab}」）`);
        advanced = true;
        break;
      }
    }
    if (!advanced) {
      console.log(`  ⚠ 次へ進むボタンが見つかりません（${s.qnum}/${s.total}）。レッスン終了とみなします。`);
      try { fs.writeFileSync(path.join(__dirnameEarly, `drill-dump.no-next-${s.qnum}.html`), await page.content(), "utf-8"); } catch {}
      break;
    }
    await sleep(1200);
    continue;
  }
  // 最終問 → 結果（→誤答があれば復習）へ。終了系ラベルを広めに探して押す。
  console.log(`最終問（${s.qnum}/${s.total}）。結果（→誤答があれば復習）へ進みます。`);
  const finalLabels = ["結果を見る", "結果へ", "スコアを見る", "次へ", "終了する", "終了", "完了する", "レッスンを終える"];
  for (const lab of finalLabels) {
    const loc = page.getByText(lab, { exact: true });
    if ((await loc.count().catch(() => 0)) > 0) { await loc.first().click().catch(() => {}); console.log(`  （最終遷移: 「${lab}」をクリック）`); break; }
  }
  break;
}

console.log(`\n取り込み完了。${imported} 問を保存しました。`);

// === 復習クリア（②）===
// 取り込みで選択式を option-0（多くは誤答）で答えるため、最終問の後に「間違えた問題だけの
// 復習」が同一ブラウザ・同一セッションで連続して始まる。直前に保存したばかりの studyLog を
// 取り込み直し、保存済み正解で復習を突破する（/api/import-question へPOSTしない＝AI再課金なし）。
// 誤答が無く復習が始まらない場合は、clearReview が完了画面を検出して「次のレッスンへ」を押す。
if (NO_REVIEW) {
  console.log("（NO_REVIEW=1: 復習クリアはスキップします）");
} else {
  await sleep(1500);
  console.log("\n=== 復習クリア（②）＝保存済み正解で突破（AI再課金なし）===");
  const index = await fetchIndex(STUDYLOG_API);
  await clearReview(page, index, {
    auto: AUTO_UNKNOWN,
    maxQuestions: MAX_QUESTIONS,
    waitForGo, // 未知問題で停止する際の再開待ち（.import-go / Enter）
    dumpDir: __dirnameEarly,
  });
}

console.log("\nアプリ(http://localhost:3000)を再読み込みすると先生ペインに反映されます。");
await ctx.close().catch(() => {});
process.exit(0);
