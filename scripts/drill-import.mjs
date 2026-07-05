// ドリル自動取り込み（1レッスン／コース一括）。
// drill.ma-ji.ai のレッスンを自動で「解答→正解・解説を取得→AI解説生成→studyLogへ保存」する。
//
// 前提:
//   1) 別ターミナルで dev サーバを起動しておく:  npm run dev   (http://localhost:3000)
//   2) このスクリプトを起動:                     node scripts/drill-import.mjs
//   3) 開いた Chromium で drill.ma-ji.ai にログイン（プロフィールは保存済みなら不要）し、
//      取り込みたいレッスンの「Q1 の問題画面」まで進めて放置する。
//   → 自動で最後の問題まで巡回し、各問を /api/import-question 経由で保存する。
//
// ③コース一括ループ: MAX_LESSONS=20 のように 2 以上を指定すると、1レッスン取込→復習突破→
//   「次のレッスンへ」遷移→次レッスンのQ1検出→取込継続 を現コース内で最大その数だけ繰り返す。
//   （既定 MAX_LESSONS=1 は従来どおり単一レッスンで終了。確認待ちは初回レッスンのみ。）
//   例:  MAX_LESSONS=20 node scripts/drill-import.mjs
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
import { readState, sleep, collectThemeColor } from "./drill-dom.mjs";
import { fetchIndex, clearReview, answerChoice, answerCloze, answerAdjust, readAdjustCorrect, advanceToNextCourse } from "./drill-review-core.mjs";
import { reportProgress, progressLog } from "./progress-report.mjs";

// 進捗モニター: 予期しない停止も UI に伝える（挙動は従来どおり=表示してから終了）。
process.on("uncaughtException", (e) => {
  reportProgress({ phase: "error", waiting: true, message: `エラーで停止: ${e.message}` });
  console.error(e);
  process.exit(1);
});
process.on("unhandledRejection", (e) => {
  reportProgress({ phase: "error", waiting: true, message: `エラーで停止: ${e instanceof Error ? e.message : e}` });
  console.error(e);
  process.exit(1);
});

const __dirnameEarly = path.dirname(fileURLToPath(import.meta.url));
const GO_FILE = path.join(__dirnameEarly, ".import-go");

// 取り込み先の階層を確認してから開始するための「開始合図」待ち。
// - 自分のターミナルで実行（TTY）した場合: Enter キーで開始
// - バックグラウンド実行（TTYなし）の場合: ファイル scripts/.import-go が作られたら開始
//   （操作者がログ上の階層を確認後に作成する。Enter を押せない環境でも確認を挟める）
function waitForGo(prompt) {
  // 進捗モニター: 開始合図待ち＝🟢ユーザー操作待ちを UI に出す（解除は resolve 後）。
  reportProgress({ phase: "waiting-user", waiting: true, message: prompt.replace(/\s+/g, " ").trim() });
  const resolved = () => reportProgress({ waiting: false, message: "開始合図を受領。処理を続行します。" });
  if (process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => rl.question(prompt, () => { rl.close(); resolved(); resolve(); }));
  }
  try { fs.unlinkSync(GO_FILE); } catch {}
  console.log(prompt);
  console.log(`  (バックグラウンド実行のため、確認後に ${GO_FILE} が作成されたら開始します)`);
  return new Promise((resolve) => {
    const t = setInterval(() => {
      if (fs.existsSync(GO_FILE)) { clearInterval(t); try { fs.unlinkSync(GO_FILE); } catch {} resolved(); resolve(); }
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
// NO_IMPORT=1: 各問を解いて前進（＝誤答→復習を起動）するが /api/import-question へPOSTしない。
// 既に取り込み済みのレッスンで「復習クリア＝自己訂正」だけを AI再課金なしで再検証する replay 用。
const NO_IMPORT = process.env.NO_IMPORT === "1";

// --- 保存POSTの保険（②）---
// サーバーが一時的に落ちても1問も失わないため、保存POSTは fetch失敗/5xx の間は待って再試行する。
// それでも復帰しなければ「黙って次の問題へ進む」のではなく throw して確実に停止する
// （前回の事故＝保存0問のまま巡回→復習で全問未知、を二度と起こさない）。本物の 4xx は入力起因なので即返す。
const POST_RETRIES = parseInt(process.env.POST_RETRIES ?? "30", 10);
const POST_RETRY_WAIT = parseInt(process.env.POST_RETRY_WAIT ?? "5000", 10);

async function postQuestionWithRetry(payload) {
  let lastErr = "";
  for (let attempt = 0; attempt <= POST_RETRIES; attempt++) {
    try {
      const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) return { ok: true, json: await res.json() };
      if (res.status < 500) return { ok: false, status: res.status, text: await res.text() }; // 4xx=入力起因→再試行しない
      lastErr = `HTTP ${res.status}`;
      console.log(`  ⚠ 保存に一時失敗 (${lastErr})。サーバー復帰を待って再試行 ${attempt + 1}/${POST_RETRIES}…`);
    } catch (e) {
      lastErr = e.message;
      console.log(`  ⚠ サーバーに接続できません（${lastErr}）。復帰を待って再試行 ${attempt + 1}/${POST_RETRIES}…`);
    }
    if (attempt < POST_RETRIES) await sleep(POST_RETRY_WAIT);
  }
  throw new Error(`保存POSTが${POST_RETRIES}回再試行しても回復しません（${lastErr}）。サーバーダウンのまま=ここで停止します（データ消失/全問未知を防止）。`);
}

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
reportProgress({
  phase: "waiting-q1",
  waiting: true,
  message: "ドリルにログインし、取り込むレッスンのQ1を表示してください（最大10分待機）",
  series: "", course: "", lesson: "", question: "", total: null,
  savedLesson: 0, savedTotal: 0,
});
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
  reportProgress({ phase: "error", waiting: true, message: "問題画面を検出できず終了（10分経過）。スクリプトの再実行が必要です。" });
  await ctx.close().catch(() => {});
  process.exit(1);
}
console.log(`問題画面を検出。取り込みを開始します。${capturedSeries ? `（シリーズ先取り: ${capturedSeries}）` : ""}\n`);
reportProgress({ phase: "importing", waiting: false, message: "問題画面を検出。取り込みを開始します。" });

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

// シリーズ/コースはコース一括の基準として最初に1回だけ確定（環境変数で上書き可）。
// レッスンはレッスンごとに再検出する（③ループで次のレッスンへ進むたびに変わるため）。
const first = await readState(page);
const series = process.env.SERIES || first.series || capturedSeries || "不明シリーズ";
reportProgress({ series });

// ② シリーズテーマ色の自動収集（オマケ・best effort）: Q1画面の支配的な彩色を
// シリーズ代表色として /api/series-colors へ保存する。失敗しても取り込みは続行。
const COLORS_API = API.replace(/\/api\/.*$/, "/api/series-colors");
try {
  const themeColor = await collectThemeColor(page);
  if (themeColor && series !== "不明シリーズ") {
    await fetch(COLORS_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ series, color: themeColor }),
    });
    console.log(`（シリーズ色を収集: ${series} = ${themeColor}）`);
  }
} catch {}
// course0（コース名）はコースごとに確定する（シリーズ一括では次コースで変わる）→ 下のコースループ内で設定。

// MAX_COURSES: 既定1＝単一コース（従来動作）。2以上で「シリーズ一括」＝コース内は全自動で巡回し、
// コース完了後は advanceToNextCourse() で次コースの Lesson1 Q1 まで“自動”でナビして継続する（2026-06-28k
// の実機記録で経路確定）。自動ナビが Q1 に到達できない場合は従来どおり手動移動（最大10分待ち）にフォールバック。
const MAX_COURSES = parseInt(process.env.MAX_COURSES ?? "1", 10);
const seriesMode = MAX_COURSES > 1;
// MANUAL_NEXT_COURSE=1: コース間の自動ナビを使わず、操作者が手で次コースのQ1まで移動する従来挙動に固定。
const MANUAL_NEXT_COURSE = process.env.MANUAL_NEXT_COURSE === "1";
// GATE_AFTER_COURSE=1: 「最初のコース境界」だけの検証チェックポイント（2026-07-03）。
// 1コース目の取込完了→次コースQ1への自動ナビ成功後に、一度だけ開始合図(.import-go / Enter)を待って停止する。
// 画面がQ1で正しいことを確認して合図すれば、2コース目以降はそのまま全自動（シリーズ一括）で継続する。
// 「コース一括→次コースQ1で一旦停止→OKならシリーズ一括」の段階検証用。
const GATE_AFTER_COURSE = process.env.GATE_AFTER_COURSE === "1";
// SKIP_IMPORTED=1: レッスン開始時に studyLog を照会し、そのコース/レッスンが既に「全問保存済み」なら
// /api/import-question へPOSTせず巡回だけ行う（＝NO_IMPORT をレッスン単位で自動適用・課金なしで前進）。
// 既取込エリアを跨いでシリーズ一括を回す際の二重課金防止（2026-07-03。[[verify-studylog-before-import]] の自動化）。
// 部分取込（保存数 < 総問題数）のレッスンは通常どおり取り込む。
const SKIP_IMPORTED = process.env.SKIP_IMPORTED === "1";

// studyLog を照会して course/lesson の保存状況を返す。
//   full: 全問保存済み（＝レッスン単位で保存POSTなし巡回）
//   saved: 保存済み questionInfo の集合（部分取込レッスンで保存済みQだけPOSTスキップ＝
//          ネットワーク断等で途中停止→再開したとき、先頭からの再取込で二重課金しない。2026-07-03 実障害由来）
// 照会失敗時は空（＝通常取込）に倒す。名前は空白正規化で比較する。
async function lessonAlreadyImported(course, lesson, total) {
  const none = { full: false, saved: new Set(), count: 0 };
  if (!SKIP_IMPORTED) return none;
  try {
    const res = await fetch(STUDYLOG_API);
    if (!res.ok) return none;
    const d = await res.json();
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    for (const c of d.courses ?? []) {
      if (norm(c.courseName ?? c.name) !== norm(course)) continue;
      for (const l of c.lessons ?? []) {
        if (norm(l.lessonName ?? l.name) !== norm(lesson)) continue;
        const qs = l.questions ?? [];
        const saved = new Set(qs.map((q) => norm(q.questionInfo)).filter(Boolean));
        return { full: !!(total && qs.length >= total), saved, count: qs.length };
      }
    }
  } catch {}
  return none;
}

// MAX_LESSONS: 既定1＝単一レッスン（従来動作）。2以上で「コース一括ループ（③）」＝1レッスン取込→
// 復習突破→次のレッスンへ遷移→次レッスンのQ1検出→取込継続 を、現コース内で最大この数だけ繰り返す。
// シリーズ半自動(seriesMode)はコース内のレッスン巡回が前提なので、未指定(=1)なら20に引き上げる。
const MAX_LESSONS = Math.max(parseInt(process.env.MAX_LESSONS ?? "1", 10), seriesMode ? 20 : 1);
const loopMode = MAX_LESSONS > 1;

// MANUAL_ADVANCE=1: 「レッスン単位・堅牢モード」。復習クリア（②自動突破）に一切依存せず、
// 1レッスン取込→操作者が次レッスン(別コースも可)のQ1へ手動で移動→確認で継続、をブラウザを
// 開いたまま繰り返す。復習を通さないので線結び/穴埋め等あらゆる問題タイプで詰まらない
// （復習自動突破が脆い問題タイプがあるための確実な取り込み手段。2026-06-28 採用）。
const MANUAL_ADVANCE = process.env.MANUAL_ADVANCE === "1";

// ONLY="Q5,Q7" を指定すると、その問だけ保存（POST）し、他は巡回（解答して次へ）のみ。
// 既に良好に取り込めた問を上書きせず、特定問だけ再検証・修正したいときに使う。
const onlyTargets = process.env.ONLY
  ? new Set(process.env.ONLY.split(",").map((x) => x.trim()).filter(Boolean))
  : null;

// 1レッスン分を取り込む（解答→公式解説取得→/api/import-question へ保存→次へ）。返り値＝保存できた問数。
// noImport=true なら保存POSTをスキップして巡回のみ（SKIP_IMPORTED のレッスン単位適用。既定は NO_IMPORT 環境変数）。
// savedQnums: 保存済み questionInfo の集合（部分取込レッスンの再開時、該当Qだけ保存POSTをスキップ）。
async function importLesson({ series, course, lesson, noImport = NO_IMPORT, savedQnums = new Set() }) {
  const seen = new Set();
  let imported = 0;

  for (let i = 0; i < MAX_QUESTIONS; i++) {
    // 解答ボタンが出るまで待つ（次問の読み込み待ち）。adjust（スライダー調整）は選択肢ゼロのため指示文も待機条件に含める。
    await page
      .waitForFunction(
        () => document.querySelector('[data-testid^="quiz-answer-option-"]') || /スライダーで調整/.test(document.body.innerText || ""),
        { timeout: 30000 }
      )
      .catch(() => {});
    const s = await readState(page);
    if (!s.qnum) { console.log("Q番号を取得できませんでした。終了します。"); break; }
    if (seen.has(s.qnum)) { console.log(`${s.qnum} は処理済み。進まなくなったため終了します。`); break; }
    seen.add(s.qnum);

    const kind = s.isMatching ? "matching" : s.isOrdering ? "ordering" : s.isCloze ? "cloze" : "choice";
    const kindLabel = s.isMatching ? "[線結び]" : s.isOrdering ? "[並べ替え]" : s.isCloze ? `[穴埋め×${s.clozeBlanks}]` : s.isAdjust ? "[調整]" : "";
    console.log(
      `[${s.qnum}]${kindLabel} ${s.questionText.slice(0, 40)}…  左=${JSON.stringify(s.options)}` +
        (s.isMatching ? ` 右=${JSON.stringify(s.rightItems)}` : "")
    );
    reportProgress({
      phase: "importing", waiting: false,
      question: s.qnum, total: s.total ?? null,
      message: `${s.qnum}${s.total ? `/${s.total}` : ""}${kindLabel} を処理中`,
    });

    // まだ回答していなければ回答する
    if (!s.answered) {
      if (s.isMatching) {
        // マッチング（線結び）は実体が「左N ↔ 右N の1対1」。右ラベルは重複し得る
        // （例: 右が CSS/HTML/HTML/CSS の4項目＝見た目は2種でも実体は別々の4要素）。
        // ⚠ 右を「テキストで重複排除」して同名を1つにまとめると、2つ目以降の同名右に接続できず
        //   4/4 に到達できない→確定(quiz-submit)が出ない→解説(quiz-feedback)が取れずスキップ→
        //   「次へ」も無くレッスン終端と誤判定して停止する事故になる（Lesson4 Q7「HTML/CSSの担当」で実証）。
        //   そこで右は重複排除せず DOM 出現順で扱い、left[i] → 右の i 番目（位置）を 1:1 で全左ぶん接続する。
        //   正誤は問わない（公式解説に正しい対応が含まれる）。confirm: 位置接続で 4/4→quiz-submit→feedback 採取OK。
        const SKIP_RIGHT = ["リセット", "確定", "回答する", "次の問題へ", "次へ"];
        // 右項目（タップ可能 div[tabindex]、操作ボタン・左ラベルを除く）を DOM 順に数える。
        const rightCount = await page.evaluate((SKIP) => {
          const norm = (x) => (x || "").replace(/\s+/g, " ").trim();
          const leftEls = [...document.querySelectorAll('[data-testid^="quiz-answer-option-"]')];
          const leftTexts = new Set(leftEls.map((e) => norm(e.textContent)));
          let c = leftEls[0] || document.body;
          while (c && !leftEls.every((o) => c.contains(o))) c = c.parentElement;
          c = c || document.body;
          const skip = new Set(SKIP);
          let n = 0;
          for (const el of c.querySelectorAll("div[tabindex]:not([data-testid])")) {
            const t = norm(el.textContent);
            if (!t || t.length > 100 || leftTexts.has(t) || skip.has(t)) continue;
            n++;
          }
          return n;
        }, SKIP_RIGHT);
        const pairCount = Math.min(s.options.length, rightCount || s.options.length);
        for (let i = 0; i < pairCount; i++) {
          // 左をタップ→右が活性化→右の i 番目（DOM出現順）を位置で特定してタグ付け→クリック。
          await page.click(`[data-testid="quiz-answer-option-${i}"]`, { timeout: 5000 }).catch(() => {});
          await sleep(500);
          await page.evaluate(
            ({ idx, SKIP }) => {
              const norm = (x) => (x || "").replace(/\s+/g, " ").trim();
              const leftEls = [...document.querySelectorAll('[data-testid^="quiz-answer-option-"]')];
              const leftTexts = new Set(leftEls.map((e) => norm(e.textContent)));
              let c = leftEls[0] || document.body;
              while (c && !leftEls.every((o) => c.contains(o))) c = c.parentElement;
              c = c || document.body;
              const skip = new Set(SKIP);
              document.querySelectorAll("[data-import-ri]").forEach((el) => el.removeAttribute("data-import-ri"));
              let n = 0;
              for (const el of c.querySelectorAll("div[tabindex]:not([data-testid])")) {
                const t = norm(el.textContent);
                if (!t || t.length > 100 || leftTexts.has(t) || skip.has(t)) continue;
                if (n === idx) { el.setAttribute("data-import-ri", "1"); break; }
                n++;
              }
            },
            { idx: i, SKIP: SKIP_RIGHT }
          );
          await page.click(`[data-import-ri="1"]`, { timeout: 5000 }).catch(() => {});
          await sleep(500);
        }
        await sleep(400);
        // 4/4 完成で quiz-submit が出現する（確定テキストは fallback）。
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
      } else if (s.isAdjust) {
        // adjust（スライダー調整・新形式）: outer React state の正解範囲が読めればその中央値で
        // 一発正解（復習に回らない）。候補は複数返る（同一レッスンに adjust 2問で別問の範囲を
        // 掴むことがある）→ 確定できるまで候補を順に試し、全滅なら割合スイープで前進。
        const cas = await readAdjustCorrect(page);
        let confirmed = 0;
        for (const ca of cas) {
          const range = Object.values(ca)[0];
          if (!range) continue;
          console.log(`  （正解範囲 ${JSON.stringify(ca)} を state から読取）`);
          confirmed = await answerAdjust(page, { value: (range.min + range.max) / 2, log: console.log });
          if (confirmed) break;
          console.log(`  （この範囲では確定せず → 次候補）`);
        }
        if (!confirmed) {
          for (const f of [0.5, 0.75, 0.25, 0.9, 0.1]) {
            confirmed = await answerAdjust(page, { fraction: f, log: console.log });
            if (confirmed) break;
          }
        }
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
    // adjust（スライダー調整）は保存対象外＝巡回のみ（選択肢が無く studyLog 照合・解説生成の前提に
    // 合わない。スライダーの正解範囲は iframe 内クライアント判定で外から読めない）。課金なし。
    if (s.isAdjust) {
      console.log(`  → [調整] 判定: ${a.verdict ?? "?"} / スライダー新形式＝保存対象外（巡回のみ・課金なし）`);
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
      if (noImport) {
        console.log(`  (NO_IMPORT: ${s.qnum} は保存スキップ＝復習トリガーのみ・AI再課金なし)`);
      } else if (savedQnums.has(s.qnum)) {
        console.log(`  (SKIP_IMPORTED: ${s.qnum} は保存済み → 保存スキップ・AI再課金なし)`);
      } else {
      // postQuestionWithRetry: fetch失敗/5xx は復帰を待って再試行。回復しなければ throw で全体停止。
      const r = await postQuestionWithRetry({
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
      });
      if (r.ok) {
        imported += 1;
        console.log(`  ✓ 保存: ${r.json.questionInfo}  keyLearning「${(r.json.keyLearning || "").slice(0, 30)}…」`);
        reportProgress({ savedLesson: imported, message: `${s.qnum} を保存（このレッスン ${imported} 問目）` });
      } else {
        console.log(`  ✗ 保存失敗 (${r.status}): ${(r.text || "").slice(0, 120)}`);
      }
      } // end noImport
    }
    } // end adjust保存対象外
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
        try { fs.writeFileSync(path.join(__dirnameEarly, `drill-dump.no-next-${s.qnum}.html`), await page.content(), "utf-8"); } catch {}
        // 偽レッスン終了の防御: 中間問（qn < total）で遷移ボタンが無いのに、画面にまだ問題が
        // 残っている（Q番号/総数ヘッダ＋回答UI or フィードバック表示）なら、それはレッスン終了で
        // なく「前進不能」の異常（例: adjust確定不能で Q5/12 停止＝シリーズ⑤で実発生）。
        // 静かに次レッスンへ進むと欠落が広がるため、ここで全体停止する（スキップせず停止の方針）。
        const s2 = await readState(page).catch(() => null);
        const stillOnQuestion = !!(s2 && s2.qnum && s2.total &&
          (s2.options.length > 0 || s2.isAdjust || (s2.clozeBlanks || 0) > 0 || s2.answered));
        if (stillOnQuestion) {
          console.log(`  ✗ 偽レッスン終了を検出: 遷移ボタン無しのまま問題画面が残存（${s2.qnum}/${s2.total}）。診断DOM=drill-dump.no-next-${s.qnum}.html → 停止します`);
          reportProgress({ message: `偽レッスン終了を検出（${s2.qnum}/${s2.total}）→ 停止` });
          throw new Error(`偽レッスン終了: 遷移ボタン無し・問題残存 ${s2.qnum}/${s2.total}（診断DOM: drill-dump.no-next-${s.qnum}.html）`);
        }
        console.log(`  ⚠ 次へ進むボタンが見つかりません（${s.qnum}/${s.total}）。レッスン終了とみなします。`);
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

  return imported;
}

// === コース一括ループ（③）===
// 1レッスン取込 → 復習突破（保存済み正解で②をクリアし「次のレッスンへ」を自動クリック）→
// 次レッスンのQ1を検出 → 取込継続 を、現コース内で繰り返す。
// MAX_LESSONS=1（既定）なら従来どおり単一レッスンで終了する。
let totalImported = 0;

// === レッスン単位・堅牢モード（MANUAL_ADVANCE）===
// 復習自動突破を使わず、各レッスンのデータ取り込みだけを確実に行う。次レッスンへの移動は操作者が
// ドリル上で行い（復習は手動で済ませる/コース地図から飛ぶ等は任意）、Q1表示後に確認で継続する。
if (MANUAL_ADVANCE) {
  let n = 0;
  // 何レッスンでも継続（終了は Ctrl+C）。単一ゲート設計＝「合図が先 → 検出 → 復習/不明ならスキップして
  // 待機 → 取り込み」。⚠ ドリルは各レッスン後に必ず復習が入り、復習を“正答して”完了しないと次レッスンへ
  // 進めない（スキップ不可）。操作者が復習を終えてレッスンのQ1まで進めてから合図する運用。
  while (true) {
    await waitForGo(
      n === 0
        ? "\n  → 取り込むレッスンのQ1を表示したら Enter / .import-go …（終了は Ctrl+C）"
        : "\n  → 次のレッスンのQ1を表示したら Enter / .import-go …（終了は Ctrl+C）"
    );
    const gotQ1 = await page
      .waitForSelector('[data-testid^="quiz-answer-option-"]', { timeout: 60000 })
      .then(() => true)
      .catch(() => false);
    if (!gotQ1) { console.log("⚠ Q1（解答ボタン）が見当たりません。レッスンのQ1を表示してからもう一度合図を。"); continue; }
    await sleep(400);
    const st = await readState(page);
    const course = process.env.COURSE || st.contextLabel || "不明コース";
    const lesson = (await resolveLessonName(st.title)) || st.title || "不明レッスン";
    // ガード: 復習中/不明コースの画面は「レッスンのQ1」ではない → 取り込まずに待機へ戻る（誤保存防止）。
    if (!st.contextLabel || /復習/.test(st.title || "") || /復習/.test(lesson)) {
      console.log(`\n⚠ いまの画面は「${lesson}」（復習中/不明）でレッスンのQ1ではありません。`);
      console.log("   復習を最後まで正答して終え、次レッスンのQ1まで進めてから、もう一度合図してください。");
      continue;
    }
    console.log(`\n=== 取り込み先（レッスン単位 ${n + 1}）===`);
    console.log(`  シリーズ: ${series}`);
    console.log(`  コース  : ${course}`);
    console.log(`  レッスン: ${lesson}`);
    console.log(`  総問題数: ${st.total ?? "不明"}`);
    reportProgress({ phase: "importing", waiting: false, course, lesson, total: st.total ?? null, savedLesson: 0, message: `「${lesson}」の取り込みを開始` });
    const imp = await importLesson({ series, course, lesson });
    totalImported += imp;
    reportProgress({ savedTotal: totalImported, message: `「${lesson}」完了（${imp} 問保存 / 累計 ${totalImported} 問）` });
    n += 1;
    console.log(`\n取り込み完了。${imp} 問を保存（このレッスン）/ 累計 ${totalImported} 問・${n} レッスン。`);
    console.log("\n次のレッスン（別コースでも可）の『Q1』まで進めてください（復習を終えてから／終了は Ctrl+C）。");
  }
  console.log(`\n=== レッスン単位取り込み終了 ===  累計 ${totalImported} 問を保存しました。`);
  console.log("アプリ(http://localhost:3000)を再読み込みすると先生ペインに反映されます。");
  await ctx.close().catch(() => {});
  process.exit(0);
}

// === シリーズ半自動ループ（コース跨ぎ）===
// コース内は従来のレッスン一括ループ。MAX_COURSES>1 のとき、コース完了後に操作者が次コースの
// Lesson1 Q1 へ移動するのを待って継続する（コース間だけ手動＝確認チェックポイントを兼ねる）。
for (let C = 0; C < MAX_COURSES; C++) {
 // --- 2コース目以降: 次コースの Lesson1 Q1 へ移動してもらう ---
 if (C > 0) {
   console.log(`\n========== 次コース（${C + 1}/${MAX_COURSES}）==========`);
   let gotNext = false;
   // --- まずコース間を自動ナビ（コース完了→次のコースへ→STARTタイル→Lesson1→Q1）---
   if (!MANUAL_NEXT_COURSE) {
     console.log("[自動] コース完了画面 → 次コースの Lesson1 Q1 へ自動ナビ…");
     gotNext = await advanceToNextCourse(page);
   }
   // --- 自動ナビ不可（or 手動指定）なら従来どおり手動移動を待つ ---
   if (!gotNext) {
     console.log("次のコースの『Lesson 1 の Q1』まで進めてください…（最大10分／中断は Ctrl+C）");
     gotNext = await page
       .waitForSelector('[data-testid^="quiz-answer-option-"]', { timeout: 600000 })
       .then(() => true)
       .catch(() => false);
   }
   if (!gotNext) { console.log("⚠ 次コースのQ1を検出できませんでした。シリーズ取り込みを終了します。"); break; }
   await sleep(800);
   // 検証チェックポイント（最初のコース境界のみ）: Q1到達を報告して合図を待つ。以降の境界は全自動。
   if (GATE_AFTER_COURSE && C === 1) {
     console.log("\n✅ 次コースの Q1 に到達しました（コース間自動ナビ成功）。GATE_AFTER_COURSE=1 のためここで一旦停止します。");
     await waitForGo("  → 画面が次コースの Q1 で正しければ合図で続行（2コース目以降は全自動＝シリーズ一括）。中止は Ctrl+C … ");
   }
 }
 // このコースのコース名を確定（初回は env COURSE 優先、以降は DOM 検出）。
 const cstate = await readState(page);
 const course0 = (C === 0 ? (process.env.COURSE || cstate.contextLabel) : cstate.contextLabel) || "不明コース";
 let prevLessonName = null;
 let courseImported = 0;
 let lastReview = null; // 直近の復習結果（コースが正常完了したか途中失敗かの判定に使う）

for (let L = 0; L < MAX_LESSONS; L++) {
  // --- (A) このレッスンの階層を確定（series/course は course0 を継承、lesson は毎回再検出）---
  const st = await readState(page);
  const curCourse = st.contextLabel || course0;
  // 範囲ガード: 次コースに入ったら現コース完結で停止（『コース一括』の境界）。
  if (loopMode && L > 0 && curCourse && course0 && curCourse !== course0) {
    console.log(`\n次コース「${curCourse}」に入りました。現コース「${course0}」で取り込みを完了して停止します。`);
    break;
  }
  const lesson =
    L === 0 && process.env.LESSON
      ? process.env.LESSON
      : (await resolveLessonName(st.title)) || st.title || "不明レッスン";
  // 遷移失敗ガード: レッスンが変わっていない＝前進できていない（無限ループ・再取込の防止）。
  if (loopMode && L > 0 && lesson === prevLessonName) {
    console.log(`\nレッスンが「${lesson}」のまま変わりません（遷移できず）。安全のため停止します。`);
    break;
  }

  console.log(`\n=== 取り込み先（${loopMode ? `レッスン ${L + 1}/${MAX_LESSONS}` : "階層"}）===`);
  console.log(`  シリーズ: ${series}`);
  console.log(`  コース  : ${course0}`);
  console.log(`  レッスン: ${lesson}`);
  console.log(`  総問題数: ${st.total ?? "不明"}`);
  reportProgress({ phase: "importing", waiting: false, course: course0, lesson, total: st.total ?? null, savedLesson: 0, message: `「${lesson}」の取り込みを開始` });

  // --- (B) 確認待ち（初回レッスンのみ。2レッスン目以降は無人で自動継続）---
  if (L === 0) {
    console.log("");
    console.log("  この3行が画面と一致していれば Enter キーで取り込み開始。");
    console.log("  違う / 「不明〜」がある場合は Ctrl+C して、SERIES=... COURSE=... LESSON=... を付けて再実行。");
    await waitForGo("\n  → 開始するには Enter を押してください… ");
  } else {
    console.log("  （2レッスン目以降は自動継続）");
  }
  console.log("");

  // --- (C) このレッスンを取り込む（SKIP_IMPORTED: 全問保存済みレッスンは保存せず巡回のみ＝課金なし）---
  const already = await lessonAlreadyImported(course0, lesson, st.total);
  if (already.full) {
    console.log(`  ★ SKIP_IMPORTED: 「${lesson}」は既に ${already.count} 問保存済み → 保存POSTなしで巡回のみ（課金なし）`);
    reportProgress({ message: `「${lesson}」は既取込（${already.count}問）→ 課金なしで前進のみ` });
  } else if (already.saved.size) {
    console.log(`  ★ SKIP_IMPORTED(部分): 「${lesson}」は ${already.count} 問保存済み → 保存済みQはスキップし残りだけ取り込む`);
    reportProgress({ message: `「${lesson}」は部分取込（${already.count}問）→ 未保存分のみ取り込み` });
  }
  const imported = await importLesson({ series, course: course0, lesson, noImport: already.full, savedQnums: already.saved });
  totalImported += imported;
  courseImported += imported;
  console.log(`\n取り込み完了。${imported} 問を保存（累計 ${totalImported} 問）。`);
  reportProgress({ savedTotal: totalImported, message: `「${lesson}」完了（${imported} 問保存 / 累計 ${totalImported} 問）` });
  prevLessonName = lesson;

  // --- (D) NO_REVIEW: 遷移手段（復習クリアの「次のレッスンへ」）が無いため単一レッスンで終了 ---
  if (NO_REVIEW) {
    console.log("（NO_REVIEW=1: 復習クリア＝次レッスンへの遷移をスキップ。単一レッスンで終了）");
    break;
  }

  // --- (E) 復習クリア②＝保存済み正解で突破（AI再課金なし）＋「次のレッスンへ」クリック ---
  // 取り込みで選択式を option-0（多くは誤答）で答えるため、最終問の後に「間違えた問題だけの復習」が
  // 同一ブラウザ・同一セッションで連続して始まる。直前に保存したばかりの studyLog を取り込み直し、
  // 保存済み正解で復習を突破する（/api/import-question へPOSTしない）。誤答が無く復習が始まらない場合は
  // clearReview が完了画面を検出して「次のレッスンへ」を押す。
  await sleep(1500);
  console.log("\n=== 復習クリア（②）＝保存済み正解で突破（AI再課金なし）===");
  reportProgress({ phase: "review", waiting: false, message: "復習クリア中（保存済み正解で自動突破・課金なし）" });
  const index = await fetchIndex(STUDYLOG_API); // ★ループ内: このレッスンを取込んだ直後のstudyLogで復習する
  const r = await clearReview(page, index, {
    auto: loopMode ? true : AUTO_UNKNOWN, // ループ時は無人継続のため未知でも止めず前進
    maxQuestions: MAX_QUESTIONS,
    waitForGo, // 未知問題で停止する際の再開待ち（.import-go / Enter）。loopMode時は auto:true で使われない
    dumpDir: __dirnameEarly,
    log: progressLog, // 進捗モニターへ復習ログを流す（コンソール出力は従来どおり）
  });
  lastReview = r;

  // --- (F) 単一モード or 次レッスン無し（コース終端）なら終了 ---
  if (!loopMode) break;
  if (!r.advanced) {
    console.log("\n「次のレッスンへ」が無い＝コース終端に到達（このコールは完了）。");
    break;
  }

  // --- (G) 次レッスンのQ1出現を待つ ---
  // 観察で確定（2026-06-27）: 「次のレッスンへ」押下後は開始ボタン不要で、一瞬コースヘッダ/ホームが
  // フラッシュした後に次レッスンのQ1が直接前面化する。中間画面は quiz-answer-option を持たないため
  // 「解答ボタンの出現待ち」だけで安全にスルーできる。
  console.log("\n次レッスンのQ1が表示されるのを待っています…（最大60秒）");
  const gotQ1 = await page
    .waitForSelector('[data-testid^="quiz-answer-option-"]', { timeout: 60000 })
    .then(() => true)
    .catch(() => false);
  if (!gotQ1) {
    console.log("⚠ 次レッスンのQ1を検出できませんでした（60秒）。取り込みを終了します。");
    try { fs.writeFileSync(path.join(__dirnameEarly, "drill-dump.next-lesson-timeout.html"), await page.content(), "utf-8"); } catch {}
    break;
  }
  await sleep(800); // 描画安定待ち
}

 console.log(`\n=== コース「${course0}」取り込み終了 ===  このコース ${courseImported} 問 / シリーズ累計 ${totalImported} 問。`);
 reportProgress({ phase: "course-done", waiting: false, message: `コース「${course0}」終了（${courseImported} 問 / 累計 ${totalImported} 問）` });
 if (!seriesMode) break;
 // ⚠ 設計ガード: コースが「正常完了」でなく「途中で詰まって停止」した場合は次コースへ進ませない。
 //   正常なコース終端は復習を通過しレッスン完了(レッスン完了!)に到達して『次のレッスンへ』が無い状態
 //   （lastReview.advanced=false かつ lastReview.done.cleared=true）。途中の復習失敗(stuck)は
 //   cleared=false のままなので、これを検出して停止し、次コースへ誤って進むのを防ぐ。
 const endedCleanly = !!lastReview && lastReview.advanced === false && lastReview.done && lastReview.done.cleared === true;
 if (!endedCleanly) {
   console.log("\n⚠ このコースは正常完了でなく途中で停止した可能性が高い（復習を突破できず）。");
   console.log("   次コースへは進まずシリーズ取り込みを停止します。残りは MANUAL_ADVANCE=1 等で対応してください。");
   break;
 }
} // end course loop

console.log(`\n=== ${seriesMode ? "シリーズ" : "コース"}取り込み終了 ===  累計 ${totalImported} 問を保存しました。`);
console.log("アプリ(http://localhost:3000)を再読み込みすると先生ペインに反映されます。");
reportProgress({ phase: "done", waiting: false, message: `取り込み終了（累計 ${totalImported} 問を保存）` });
await ctx.close().catch(() => {});
process.exit(0);
