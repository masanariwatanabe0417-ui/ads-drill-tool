// マッチング（線結び）問題の「接続 → 確定 → フィードバック」を自動で1回だけ走らせ、
// 各ステップの DOM を scripts/drill-dump.matching-NN-*.html に保存する調査専用スクリプト。
//
// なぜ必要か:
//   新形式マッチング（Q7「左右をタップして接続／○/3 ペア完成」）は、回答前の DOM しか
//   採取できていない（drill-dump.ordering-debug-Q7.html）。kind="matching" を実装するには
//   「確定後フィードバック（正解ペア＋公式解説）」の DOM 構造が要る。これを実機から1回で採る。
//
// 安全性:
//   - API は一切叩かない（/api/import-question を呼ばない＝studyLog を書き換えない・AI課金なし）。
//   - ただしドリル本体には「回答済み（おそらく誤答。left[i]↔right[i] を機械的に結ぶだけ）」が
//     1問分残る。ordering/choice の自動取り込みと同じ前提（ユーザー承認済み）。
//
// 使い方:
//   1) npm run dev は不要（API を叩かないため）。
//   2) node scripts/drill-inspect-matching.mjs
//   3) 開いた Chromium で drill.ma-ji.ai にログインし、マッチング問題（Q7）の画面まで進める。
//      （ログインは scripts/.pw-profile に保存済みなら不要）
//   4) あとは自動。左[i]→右[i] を順に接続→確定→フィードバックを採取して終了する。
//   → 採取物: scripts/drill-dump.matching-*.html（.gitignore の drill-dump.* で無視される）
//
// 検出マーカー: 選択肢に aria-label が無い（並べ替えと同じ）＋ 画面に「ペア完成」テキストがある。

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

console.log("\n==============================================");
console.log(" マッチング（線結び）問題 ライブ調査");
console.log(" 1) drill.ma-ji.ai にログイン");
console.log(" 2) マッチング問題（例: Lesson3 Q7「タップして接続／3 ペア完成」）の画面まで進める");
console.log(" 3) そのまま放置 → 自動で接続→確定→フィードバックを採取します");
console.log(" 中断は Ctrl+C");
console.log("==============================================\n");

let seq = 0;
async function dump(tag) {
  seq += 1;
  const name = `drill-dump.matching-${String(seq).padStart(2, "0")}-${tag}`;
  fs.writeFileSync(path.join(__dirname, `${name}.html`), await page.content(), "utf-8");
  await page.screenshot({ path: path.join(__dirname, `${name}.png`) }).catch(() => {});
  console.log(`  ★ ${name}.html / .png を保存`);
}

// 現在のマッチング画面の構造を読む。
async function readMatching() {
  return page.evaluate(() => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();

    // 左項目: data-testid="quiz-answer-option-N"
    const leftEls = [...document.querySelectorAll('[data-testid^="quiz-answer-option-"]')];
    const left = leftEls.map((el) => ({
      testid: el.getAttribute("data-testid"),
      text: norm(el.textContent),
      aria: norm(el.getAttribute("aria-label")),
      disabled: el.getAttribute("aria-disabled") === "true",
    }));
    const leftTexts = new Set(left.map((l) => l.text));

    // 全選択肢を含む最小の共通祖先＝問題コンテナ（ホーム画面の要素を除外するため）。
    let container = leftEls[0] || null;
    while (container && !leftEls.every((o) => container.contains(o))) container = container.parentElement;

    // 右項目: 問題コンテナ内の、tabindex を持つが data-testid が無いタップ可能 div。
    //         左項目テキストは除外。ホーム画面のカードはコンテナ外なので混入しない。
    // ⚠ 重複排除しない: 右ラベルは重複し得る（例 CSS/HTML/HTML/CSS の4項目）。実体は
    //   左N↔右N の1対1なので、同名でも別要素として DOM 出現順にすべて拾う。
    const SKIP = new Set(["リセット", "確定", "回答する", "次の問題へ", "次へ"]);
    const right = [];
    if (container) {
      for (const el of container.querySelectorAll("div[tabindex]:not([data-testid])")) {
        const t = norm(el.textContent);
        if (!t || t.length > 100) continue;
        if (leftTexts.has(t)) continue;
        if (SKIP.has(t)) continue;
        right.push({
          text: t,
          tabindex: el.getAttribute("tabindex"),
          disabled: el.getAttribute("aria-disabled") === "true",
        });
      }
    }

    // 「N/3 ペア完成」進捗（マッチング画面のみに出る＝最も信頼できるマーカー）
    let pairProgress = "";
    for (const el of document.querySelectorAll('div[dir="auto"]')) {
      const t = norm(el.textContent);
      if (/ペア完成/.test(t) && t.length < 20) { pairProgress = t; break; }
    }
    const isMatching = /ペア完成/.test(document.body.innerText || "");

    // Q番号・総数
    let qnum = null, total = null;
    for (const el of document.querySelectorAll("div")) {
      const t = norm(el.textContent);
      if (!qnum && /^Q\d+$/.test(t)) qnum = t;
      const m = t.match(/^\/\s*(\d+)\s*問$/);
      if (m) total = parseInt(m[1], 10);
      if (qnum && total) break;
    }

    const hasSubmitTestid = !!document.querySelector('[data-testid="quiz-submit"]');
    const hasFeedback = !!document.querySelector('[data-testid="quiz-feedback"]');

    return { left, right, pairProgress, isMatching, qnum, total, hasSubmitTestid, hasFeedback };
  });
}

// 右項目に一時タグ data-probe-ri を付け、Playwright が click できるようにする
// （data-testid が無く、状態変化で aria/tabindex が変わるためテキストで再特定する）。
async function tagRightItems(labels) {
  return page.evaluate((labels) => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const found = {};
    document.querySelectorAll("[data-probe-ri]").forEach((el) => el.removeAttribute("data-probe-ri"));
    // 問題コンテナに限定（ホーム画面の同名要素を拾わない）
    const leftEls = [...document.querySelectorAll('[data-testid^="quiz-answer-option-"]')];
    let container = leftEls[0] || document.body;
    while (container && !leftEls.every((o) => container.contains(o))) container = container.parentElement;
    container = container || document.body;
    for (const el of container.querySelectorAll("div[tabindex]:not([data-testid])")) {
      const t = norm(el.textContent);
      const idx = labels.indexOf(t);
      if (idx !== -1 && !(idx in found)) {
        el.setAttribute("data-probe-ri", String(idx));
        found[idx] = t;
      }
    }
    return found;
  }, labels);
}

// 右項目を「DOM出現順の idx 番目」を位置で特定して data-probe-ri="1" を付ける（同名重複に強い）。
// 右ラベルが重複（CSS/HTML/HTML/CSS）しても、テキストでなく位置で確実に各右へ接続できる。
async function tagRightByIndex(idx) {
  return page.evaluate((idx) => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    document.querySelectorAll("[data-probe-ri]").forEach((el) => el.removeAttribute("data-probe-ri"));
    const leftEls = [...document.querySelectorAll('[data-testid^="quiz-answer-option-"]')];
    const leftTexts = new Set(leftEls.map((e) => norm(e.textContent)));
    let container = leftEls[0] || document.body;
    while (container && !leftEls.every((o) => container.contains(o))) container = container.parentElement;
    container = container || document.body;
    const SKIP = new Set(["リセット", "確定", "回答する", "次の問題へ", "次へ"]);
    let n = 0;
    for (const el of container.querySelectorAll("div[tabindex]:not([data-testid])")) {
      const t = norm(el.textContent);
      if (!t || t.length > 100 || leftTexts.has(t) || SKIP.has(t)) continue;
      if (n === idx) { el.setAttribute("data-probe-ri", "1"); return true; }
      n++;
    }
    return false;
  }, idx);
}

// 回答後フィードバックの本文を読む（quiz-feedback がある前提。無ければ画面全体から推定）。
async function readFeedback() {
  return page.evaluate(() => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const fbEl = document.querySelector('[data-testid="quiz-feedback"]');
    const scope = fbEl || document.body;
    let verdict = null;
    const paras = [];
    const leaves = [...scope.querySelectorAll('div[dir="auto"]')].filter(
      (el) => !el.querySelector('div[dir="auto"]')
    );
    for (const el of leaves) {
      const t = norm(el.textContent);
      if (!t) continue;
      if (/^(正解|不正解|正解！|残念)/.test(t) && t.length <= 6) { verdict = t; continue; }
      if (t === "マスターのワンポイント") continue;
      paras.push(t);
    }
    return { hasFeedbackTestid: !!fbEl, verdict, paras };
  });
}

// マッチング画面か判定: 「ペア完成」マーカーがあること（これがマッチング画面の確証）。
// ※ 単一選択でも選択肢に aria-label が無い問題があるため、aria有無では判定しない。
//   右項目の個数も SPA がホーム画面を DOM に残すため当てにできない（誤検出の元）。
function looksLikeMatching(state) {
  if (!state || state.left.length < 2) return false;
  return !!state.isMatching || /ペア完成/.test(state.pairProgress || "");
}

// --- まず「何らかの問題画面」が出るのを待つ（最大10分。ログイン〜レッスン開始まで） ---
// 到達後は、マッチング問題に当たるまで通常問題を自動で答えて先送りする
// （Q1〜Q6 を手で解く負担をなくす。ドリル成績には回答済みが残る＝承認済み前提）。
console.log("問題画面が出るのを待っています…（最大10分／対象レッスンの最初の問題を表示してください）");
const deadline = Date.now() + 600000;
let m = null;
let beat = 0;
while (Date.now() < deadline) {
  if (await page.$('[data-testid^="quiz-answer-option-"]')) { m = await readMatching().catch(() => null); break; }
  beat += 1;
  if (beat % 6 === 0) console.log(`  …待機中（まだ問題画面が出ていません。レッスンを開いて Q1 を表示してください）`);
  await sleep(2500);
}
if (!m) {
  console.log("問題画面を検出できませんでした（10分経過）。終了します。");
  console.log("（対象レッスンの問題を表示してから再実行してください: node scripts/drill-inspect-matching.mjs）");
  await ctx.close().catch(() => {});
  process.exit(1);
}

// マッチングに当たるまで通常問題を自動で答えて進む。
// isOrdering=並べ替え（aria無し・マッチングでない）は全項目を順タップしてから確定する。
async function answerNormalAndNext(isOrdering) {
  if (isOrdering) {
    for (let k = 0; k < 8; k++) {
      const remaining = await page.$$('[data-testid^="quiz-answer-option-"]');
      if (remaining.length === 0) break;
      await remaining[0].click().catch(() => {});
      await sleep(500);
    }
    await sleep(400);
  } else {
    await page.click('[data-testid="quiz-answer-option-0"]', { timeout: 5000 }).catch(() => {});
    await sleep(400);
  }
  if (await page.$('[data-testid="quiz-submit"]')) {
    await page.click('[data-testid="quiz-submit"]').catch(() => {});
  } else {
    await page.getByText("確定", { exact: true }).first().click({ timeout: 2000 }).catch(() => {});
    await page.getByText("回答する", { exact: true }).first().click({ timeout: 2000 }).catch(() => {});
  }
  await page.waitForSelector('[data-testid="quiz-feedback"]', { timeout: 12000 }).catch(() => {});
  await sleep(600);
  const next = page.getByText("次の問題へ", { exact: true });
  if ((await next.count()) === 0) return false;
  await next.first().click().catch(() => {});
  await sleep(1500);
  return true;
}

for (let guard = 0; guard < 15; guard++) {
  await page.waitForSelector('[data-testid^="quiz-answer-option-"]', { timeout: 15000 }).catch(() => {});
  m = await readMatching().catch(() => null);
  if (m && looksLikeMatching(m)) {
    console.log(`\n→ マッチング問題を検出（${m.qnum ?? "?"}）。接続→確定→フィードバック採取に進みます。`);
    break;
  }
  if (!m || m.left.length === 0) { console.log("問題が読めなくなりました。終了します。"); await ctx.close().catch(() => {}); process.exit(1); }
  const isOrdering = m.left.every((l) => !l.aria); // aria無し＝並べ替え（マッチングはこの分岐に来ない）
  console.log(`  ${m.qnum ?? "?"} はマッチングではない（左項目=${m.left.length}, ${isOrdering ? "並べ替え" : "選択式"}）→ 自動で答えて次へ`);
  const advanced = await answerNormalAndNext(isOrdering);
  if (!advanced) {
    console.log("「次の問題へ」が無く、マッチング問題に到達せずレッスンが終わりました。終了します。");
    await dump("zz-end-no-matching");
    await ctx.close().catch(() => {});
    process.exit(1);
  }
}
m = await readMatching().catch(() => null);
if (!m || !looksLikeMatching(m)) {
  console.log("マッチング問題に到達できませんでした（15問ぶん進めても「ペア完成」が出ない）。終了します。");
  await ctx.close().catch(() => {});
  process.exit(1);
}

console.log(`\nマッチング画面を検出: ${m.qnum ?? "?"} / ${m.total ?? "?"}問`);
console.log(`  進捗: ${m.pairProgress}`);
console.log(`  左項目 (data-testid):`);
m.left.forEach((l) => console.log(`    ${l.testid}: 「${l.text}」 aria=「${l.aria}」 disabled=${l.disabled}`));
console.log(`  右項目 (data-testid なし):`);
m.right.forEach((r, i) => console.log(`    [${i}] 「${r.text}」 tabindex=${r.tabindex} disabled=${r.disabled}`));
await dump("00-initial");

const rightLabels = m.right.map((r) => r.text);
// 必要ペア数＝左の全項目。右は左と同数あり（同名重複を含む）1対1で接続する。
const pairCount = m.left.length;
if (pairCount < 2 || rightLabels.length < 1) {
  console.log("左右の項目を十分に検出できませんでした。00-initial のダンプを確認してください。終了します。");
  await ctx.close().catch(() => {});
  process.exit(1);
}

// --- 左[i] → 右[i % 右数] を順に接続（全左を必ず繋ぐ） ---
for (let i = 0; i < pairCount; i++) {
  console.log(`\n--- ペア ${i}: 左「${m.left[i].text}」 → 右[${i}]「${rightLabels[i] ?? "?"}」 ---`);

  // 左をタップ
  await page.click(`[data-testid="quiz-answer-option-${i}"]`, { timeout: 5000 }).catch((e) =>
    console.log(`  ⚠ 左タップ失敗: ${e.message}`)
  );
  await sleep(700);
  if (i === 0) {
    // 左を選んだ直後の状態（右が活性化するか等）を1回だけ記録
    const after = await readMatching().catch(() => null);
    if (after) {
      console.log("  左タップ後の右項目状態:");
      after.right.forEach((r, j) => console.log(`    [${j}] 「${r.text}」 tabindex=${r.tabindex} disabled=${r.disabled}`));
    }
    await dump(`01-after-left0`);
  }

  // 右をタップ＝「DOM出現順の i 番目」を位置で特定してタグ付け→クリック（同名重複に強い）。
  const tagged = await tagRightByIndex(i);
  if (!tagged) {
    console.log(`  ⚠ 右[${i}] を位置で特定できませんでした`);
  }
  await page.click(`[data-probe-ri="1"]`, { timeout: 5000 }).catch((e) =>
    console.log(`  ⚠ 右タップ失敗: ${e.message}`)
  );
  await sleep(700);

  const prog = await readMatching().catch(() => null);
  console.log(`  進捗: ${prog?.pairProgress ?? "(取得失敗)"}`);
}
await dump("02-before-submit");

// --- 確定ボタンを探して押す ---
console.log("\n--- 確定 ---");
const submitCandidates = [
  { kind: "testid", sel: '[data-testid="quiz-submit"]' },
  { kind: "text", label: "確定" },
  { kind: "text", label: "回答する" },
];
let submitted = false;
for (const c of submitCandidates) {
  try {
    if (c.kind === "testid") {
      if (await page.$(c.sel)) {
        await page.click(c.sel, { timeout: 3000 });
        console.log(`  確定: ${c.sel} を押下`);
        submitted = true;
        break;
      }
    } else {
      const loc = page.getByText(c.label, { exact: true });
      if ((await loc.count()) > 0) {
        await loc.first().click({ timeout: 3000 });
        console.log(`  確定: テキスト「${c.label}」を押下`);
        submitted = true;
        break;
      }
    }
  } catch (e) {
    console.log(`  ⚠ ${c.kind === "testid" ? c.sel : c.label} 押下失敗: ${e.message}`);
  }
}
if (!submitted) console.log("  ⚠ 確定ボタンが見つかりませんでした（02-before-submit のダンプを確認）");
await sleep(1500);
await dump("03-after-submit");

// --- フィードバックを採取 ---
console.log("\n--- フィードバック採取 ---");
await page.waitForSelector('[data-testid="quiz-feedback"]', { timeout: 12000 }).catch(() => {});
await sleep(800);
await dump("04-feedback");
const fb = await readFeedback();
console.log(`  quiz-feedback testid: ${fb.hasFeedbackTestid ? "あり" : "なし"}`);
console.log(`  判定: ${fb.verdict ?? "(取得できず)"}`);
console.log(`  本文段落 (${fb.paras.length}):`);
fb.paras.forEach((p, i) => console.log(`    [${i}] ${p.slice(0, 120)}`));

console.log("\n採取完了。scripts/drill-dump.matching-*.html を確認してください。");
console.log("（特に 04-feedback が確定後の正解ペア＋公式解説の DOM です）");
await ctx.close().catch(() => {});
process.exit(0);
