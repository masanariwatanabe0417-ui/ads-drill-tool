// 復習（再テスト）自動突破の共有コア（副作用なし＝import するだけではブラウザを起動しない）。
// drill-review.mjs（独立CLI）と drill-import.mjs（取り込み末尾の復習クリア統合）の双方が使う。
//
// 設計（ロードマップ②・ユーザー決定）:
//   - 既知問題（studyLog にある）= 保存済み正解で回答し、import POST はしない（再課金なし）。
//   - 未知問題（studyLog に無い）= 「報告し相談」＝明示報告して一時停止。再開後は安全側で
//     option-0 を回答して前進し、未知リストに記録（取り込みは別途 drill-import で行う方針）。
//     ※ AUTO_UNKNOWN（auto:true）で止めずに進める無人モード（③のループ用フック）。
//   - 並べ替え/マッチングは単一正解ラベルが無いため機械的に回答（88%マージンで1つ外しても通る）。
//
// 純関数（buildIndex 等）は単体テストから import 可能。clearReview は「復習Q1の問題画面に
// 居る」前提で、復習ループ＋完了画面処理（次のレッスンへ自動クリック）までを行う。

import path from "path";
import { fileURLToPath } from "url";
import readline from "readline";
import fs from "fs";
import { readState, sleep } from "./drill-dom.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 開始合図／未知問題の確認待ちを作る。goFile はバックグラウンド（非TTY）実行時に「再開」を
// 受け取るファイルパス。TTY なら Enter キー、非TTY なら goFile が作られたら resolve。
export function makeWaitForGo(goFile) {
  return function waitForGo(prompt) {
    if (process.stdin.isTTY) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      return new Promise((resolve) => rl.question(prompt, () => { rl.close(); resolve(); }));
    }
    try { fs.unlinkSync(goFile); } catch {}
    console.log(prompt);
    console.log(`  (バックグラウンド実行のため、確認後に ${goFile} が作成されたら再開します)`);
    return new Promise((resolve) => {
      const t = setInterval(() => {
        if (fs.existsSync(goFile)) { clearInterval(t); try { fs.unlinkSync(goFile); } catch {} resolve(); }
      }, 1000);
    });
  };
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

// cloze（複数空欄穴埋め）の正解シーケンスを解説本文から導く。
// 空欄は本文の順にタップ語で埋める（実機観察済み）。公式/保存解説は答えの語を空欄順で言及するため
// （例「pnpm が…その pnpm 自体は Node.js…」）、各選択肢語の“最初の出現位置”で並べ替えて blankCount 個返す。
// 期待数（blankCount）に満たない/曖昧なときは空配列＝未知扱い（report）にフォールバック。
export function extractClozeSequence(expl, options, blankCount) {
  if (!expl || !options?.length || !blankCount) return [];
  const hay = normLoose(expl);
  const found = options
    .map((o) => ({ o, i: hay.indexOf(normLoose(o)) }))
    .filter((x) => x.i >= 0)
    .sort((a, b) => a.i - b.i);
  // 同点（同じ位置）や重複語は曖昧 → 安全側で空配列
  const seq = [];
  for (const x of found) { if (!seq.includes(x.o)) seq.push(x.o); }
  return seq.length >= blankCount ? seq.slice(0, blankCount) : [];
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
          expl, // cloze の正解シーケンスは解説本文から導くため生テキストも保持
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

// 既知 studyLog を取得してインデックス化。失敗時は空 Map（全問が未知扱いになる）。
export async function fetchIndex(studyLogApi, log = console.log) {
  try {
    const res = await fetch(studyLogApi);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const index = buildIndex(await res.json());
    log(`studyLog 取得 OK（既知問題 ${index.size} 件）`);
    return index;
  } catch (e) {
    log(`⚠ studyLog を取得できません（dev サーバは起動中？ ${studyLogApi}）: ${e.message}`);
    log("  既知判定ができないため、全問が「未知」として報告されます。");
    return new Map();
  }
}

// 回答後フィードバックの緑枠 rgb(22,163,74) が付いた選択肢テキストを「正解」として読む（自己訂正用）。
// 選択式/○✕/1空欄cloze はこれで正解1つが取れる。複数空欄clozeは緑が複数＝順序は best effort（seqで返す）。
export async function readCorrectFromFeedback(page, s) {
  // 線結び/並べ替えは「正解」が複数セルの対応・順序であり、緑枠1セルでは復元できない。
  // 単一セルを誤って学習するとリトライを浪費するため学習せず null を返す（呼び出し側が診断DOMを残す）。
  // ※実取り込みでは線結び/並べ替えは取込直後の studyLog 保存ペア/順序で突破するため、ここに来るのは
  //   未取り込み（replay）や studyLog 照合ミスの稀ケースのみ。
  if (s.isMatching || s.isOrdering) return null;
  const greens = await page
    .evaluate(() => {
      const strip = (x) => (x || "").replace(/[-]/g, "");
      const norm = (x) => (x || "").replace(/\s+/g, " ").trim();
      const isGreen = (e) => {
        const c = getComputedStyle(e);
        return /22,\s*163,\s*74/.test(c.borderColor) || /22,\s*163,\s*74/.test(c.backgroundColor);
      };
      return [...document.querySelectorAll('[data-testid^="quiz-answer-option-"]')]
        .filter(isGreen)
        .map((e) => strip(norm(e.textContent)))
        .filter(Boolean);
    })
    .catch(() => []);
  if (!greens.length) return null;
  return s.isCloze ? { seq: greens } : { text: greens[0] };
}

// 復習ループ＋完了処理。「復習 Q1 の問題画面に居る」前提で呼ぶ。
//   page    : Playwright Page（クイズ画面）
//   index   : buildIndex/fetchIndex で作った既知問題インデックス
//   opts    : { auto, maxQuestions, log, waitForGo, dumpDir }
//     auto       : true なら未知でも止めず option-0 で前進（③ループ用・既定 false）
//     waitForGo  : 未知で停止する際の再開待ち（auto:false 時に使用。未指定なら停止せず前進）
//     dumpDir    : 診断HTMLの保存先（既定 = このファイルのディレクトリ）
// 戻り値: { known, unknownList, done, advanced }
export async function clearReview(page, index, opts = {}) {
  const {
    auto = false,
    maxQuestions = 60,
    log = console.log,
    waitForGo = null,
    dumpDir = __dirname,
  } = opts;

  const seen = new Set();
  let known = 0;
  const unknownList = [];
  // 自己訂正リプレイ: 復習は誤答だと同じ問題を再提示する（正答するまで前進できない）。そこで、不正解に
  // なったら回答後フィードバックの緑枠(rgb(22,163,74))から正解を読み取り、再提示時にその正解で答え直す。
  // corrections: sig -> { text } / { seq }（学習した正解）  attempts: sig -> 試行回数（周回の打ち切り用）。
  const corrections = new Map();
  const attempts = new Map();
  const MAX_ATTEMPTS = 6;
  let corrected = 0;

  for (let i = 0; i < maxQuestions; i++) {
    // 「復習タイム！」オーバーレイ（＝誤答のみ復習の開始画面）を処理する。
    // 実機観察（2026-06-27）: レッスン最終問に回答すると、誤答があれば「復習タイム！／間違えた
    // 問題を おさらいしましょう／N問／3秒後に開始…／今すぐ始める」のオーバーレイが出る。このとき
    // 背景に本編最終問が薄く残り quiz-answer-option が DOM に居るため、これを「回答可能な問題」と
    // 誤認すると、裏で復習Q1へ自動開始してしまい1問ぶん噛み合わず脱線する（前回 Q11→Q2 の真因）。
    // → オーバーレイを検出したら「今すぐ始める」で即開始（or 3秒自動開始を待つ）し、オーバーレイ
    //   本文が消える＝復習Q1が前面化するまで待ってから次イテレーションで読む。
    const onReviewIntro = await page
      .evaluate(() => /復習タイム|間違えた問題を\s*おさらい|今すぐ始める/.test(document.body.innerText || ""))
      .catch(() => false);
    if (onReviewIntro) {
      log("（復習タイム！オーバーレイ検出 → 復習を開始）");
      const start = page.getByText("今すぐ始める", { exact: false });
      if ((await start.count().catch(() => 0)) > 0) await start.first().click().catch(() => {});
      // オーバーレイ本文が消える（復習Q1が前面化）まで待つ。押せなくても3秒で自動開始する。
      await page
        .waitForFunction(() => !/復習タイム|今すぐ始める/.test(document.body.innerText || ""), { timeout: 8000 })
        .catch(() => {});
      await sleep(1200);
      continue;
    }

    // 既に完了画面（復習なし＝全問正解 等）に居るなら復習ループは不要 → 完了処理へ。
    // （取り込み末尾から呼ばれた場合、誤答が無ければ復習は始まらずここに来る。）
    if (!(await page.$('[data-testid^="quiz-answer-option-"]'))) {
      const doneNow = await page
        .evaluate(() => /レッスン完了|次のレッスンへ/.test(document.body.innerText || ""))
        .catch(() => false);
      if (doneNow) { log("（復習なし＝完了画面を検出）"); break; }
    }
    await page.waitForSelector('[data-testid^="quiz-answer-option-"]', { timeout: 30000 }).catch(() => {});
    const s = await readState(page);
    // 重複判定は Q番号でなく問題文で行う（復習画面は Q番号がスクランブル＝SPA残骸で誤読されるため、
    // qnum 基準だと別問を「処理済み」と誤判定して早期終了する。実ライブで確認）。
    const sig = normKey(s.questionText) || s.qnum || "";
    if (!sig) { log("問題を取得できませんでした。終了します。"); break; }
    // 自己訂正のため「再提示＝即終了」はしない。正解を学習できず周回する場合のみ試行回数で打ち切る。
    if ((attempts.get(sig) || 0) >= MAX_ATTEMPTS) {
      log(`同じ問題（${s.qnum || "?"}）を${attempts.get(sig)}回試しても通過できず停止します。`);
      break;
    }
    seen.add(sig);

    const hit = lookup(index, s.questionText);
    const kindLabel = s.isMatching ? "[線結び]" : s.isOrdering ? "[並べ替え]" : s.isCloze ? "[穴埋め]" : "[選択]";

    const corr = corrections.get(sig);
    if (!s.answered && corr) {
      // --- 自己訂正: 前回の不正解後にフィードバックから読んだ正解で答え直す（全タイプ共通の最終手段）---
      corrected += 1;
      log(`[${s.qnum}]${kindLabel} 自己訂正 → 学習済み正解「${corr.text ?? (corr.seq || []).join(" / ")}」で再回答`);
      if (s.isCloze) await answerCloze(page, corr.seq?.length ? corr.seq : (corr.text ? [corr.text] : []), s.clozeBlanks);
      else if (s.isMatching) await answerMatching(page, s, hit?.pairs ?? []);
      else if (s.isOrdering) await answerOrdering(page, s, hit?.order ?? []);
      else await answerChoice(page, { correctText: corr.text ?? null, index: 0, log });
    } else if (!s.answered) {
      if (s.isCloze) {
        // cloze（複数空欄）: 保存解説から空欄順の正解シーケンスを導き、順にタップ→確定。
        const seq = hit ? extractClozeSequence(hit.expl, s.options, s.clozeBlanks) : [];
        if (seq.length === s.clozeBlanks && s.clozeBlanks > 0) {
          known += 1;
          log(`[${s.qnum}]${kindLabel} 既知 → 空欄${s.clozeBlanks}個を「${seq.join(" → ")}」で埋める`);
          await answerCloze(page, seq, s.clozeBlanks);
        } else {
          // 正解シーケンスを確定できない → 報告し相談（best effort で前進）
          unknownList.push(s.qnum);
          log(`\n  ⚠ 未知/シーケンス不明の穴埋め: ${s.qnum}（空欄${s.clozeBlanks} / 導出${seq.length}）`);
          log(`     問題: ${s.questionText}`);
          log(`     選択肢: ${JSON.stringify(s.options)}`);
          if (!auto && waitForGo) await waitForGo("     → 確認したら Enter で再開（先頭から埋めて前進します）… ");
          else log("     （止めずに先頭から埋めて前進）");
          await answerCloze(page, [], s.clozeBlanks || s.options.length);
        }
      } else if (s.isMatching) {
        // マッチング: 保存解説の「正しい対応」で接続。読めなければ左[i]→右[i]（best effort）。
        const pairs = hit?.pairs ?? [];
        if (pairs.length) { known += 1; log(`[${s.qnum}]${kindLabel} 既知 → 正しい対応で接続（${pairs.length}ペア）`); }
        else log(`[${s.qnum}]${kindLabel} ${hit ? "既知(対応不明)" : "未知"} 機械接続: ${s.questionText.slice(0, 30)}…`);
        await answerMatching(page, s, pairs);
      } else if (s.isOrdering) {
        // 並べ替え: 保存解説の「正しい順序」でタップ。読めなければ上から順（best effort）。
        const order = hit?.order ?? [];
        if (order.length) { known += 1; log(`[${s.qnum}]${kindLabel} 既知 → 正しい順序でタップ（${order.length}手順）`); }
        else log(`[${s.qnum}]${kindLabel} ${hit ? "既知(順序不明)" : "未知"} 上から順タップ: ${s.questionText.slice(0, 30)}…`);
        await answerOrdering(page, s, order);
      } else {
        // 選択式: 既知＆正解がマップできれば正解テキストでタップ。できなければ未知扱い（先頭）。
        let idx = -1;
        if (hit && hit.correctText) idx = s.options.findIndex((o) => optionMatchesCorrect(o, hit.correctText));
        // クリックは位置index でなく「正解テキスト一致」で行う（復習は選択肢がシャッフルされ、
        // 読取り時のindexと実DOMがずれて別選択肢を押す事故が起きるため。known=correctで指定）。
        let correctForClick = null;
        if (idx >= 0) {
          known += 1;
          correctForClick = hit.correctText;
          log(`[${s.qnum}]${kindLabel} 既知 → 正解「${s.options[idx]}」をテキスト一致でタップ`);
        } else {
          // 未知（または保存正解を表示選択肢にマップできない）→ 報告し相談
          unknownList.push(s.qnum);
          log(`\n  ⚠ 未知の問題（studyLog に見つかりません）: ${s.qnum}`);
          log(`     問題: ${s.questionText}`);
          log(`     選択肢: ${JSON.stringify(s.options)}`);
          if (hit) log(`     （照合はヒットしたが保存正解を表示選択肢に対応づけできず）`);
          if (!auto && waitForGo) {
            await waitForGo("     → 確認したら Enter で再開（先頭の選択肢を回答して前進します）… ");
          } else {
            log("     （止めずに先頭の選択肢で前進）");
          }
          correctForClick = null; // 先頭をタップ
        }
        // 選択→「回答する」確定（既選択の再タップによる解除を避ける堅牢版・テキスト一致でシャッフル耐性）。
        await answerChoice(page, { correctText: correctForClick, index: 0, log });
      }
    }

    await page.waitForSelector('[data-testid="quiz-feedback"]', { timeout: 15000 }).catch(() => {});
    const a = await readState(page);
    if (a.verdict) log(`     判定: ${a.verdict}`);
    attempts.set(sig, (attempts.get(sig) || 0) + 1);
    if (a.verdict && /不正解|残念/.test(a.verdict)) {
      // 不正解 → 回答後フィードバックの緑枠から正解を読み取り、再提示に備えて記録（自己訂正リプレイ）。
      // 診断DOMは「フィードバック直後・他操作の前」に同期で確保する（遷移フラッシュでホームを撮る racy 防止）。
      let wrongHtml = null;
      try { wrongHtml = await page.content(); } catch {}
      const learned = await readCorrectFromFeedback(page, s);
      if (learned && (learned.text || learned.seq?.length)) {
        corrections.set(sig, learned);
        log(`     ✎ 正解を学習: 「${learned.text ?? learned.seq.join(" / ")}」（再提示されたらこれで答え直す）`);
      } else {
        if (wrongHtml) { try { fs.writeFileSync(path.join(dumpDir, `drill-dump.review-wrong-${(s.qnum || "x")}.html`), wrongHtml, "utf-8"); } catch {} }
        log(`     ⚠ 不正解だが緑枠から正解を読み取れず（診断DOM保存: review-wrong-${s.qnum || "x"}.html）。`);
      }
    }

    // 次へ進む。通常問は「次の問題へ」だが、最終問は結果/完了画面へ進む別ラベルのことがある。
    const advanceLabels = ["次の問題へ", "結果を見る", "結果へ", "スコアを見る", "次へ", "終了する", "終了", "完了する", "レッスンを終える"];
    let clicked = null;
    for (const lab of advanceLabels) {
      const loc = page.getByText(lab, { exact: true });
      if ((await loc.count().catch(() => 0)) > 0) { await loc.first().click().catch(() => {}); clicked = lab; break; }
    }
    if (!clicked) {
      // どの遷移ボタンも見つからない＝既に完了画面 or 想定外。DOMをダンプして抜ける（診断用）。
      try { fs.writeFileSync(path.join(dumpDir, `drill-dump.review-end-${s.qnum}.html`), await page.content(), "utf-8"); } catch {}
      break;
    }
    if (clicked !== "次の問題へ") log(`     （最終遷移: 「${clicked}」をクリック）`);
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
  try { fs.writeFileSync(path.join(dumpDir, "drill-dump.review-complete.html"), await page.content(), "utf-8"); } catch {}

  log("\n=== 完了画面 ===");
  log(`  ${done.cleared ? "レッスン完了!" : "（完了画面を検出できず）"}  正答 ${done.score ?? "?"}  正答率 ${done.pct ?? "?"}`);

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
    log("  → 「次のレッスンへ」をクリックしました。");
  } else {
    log("  ⚠ 「次のレッスンへ」が見つかりません。開いたままのブラウザを確認してください。");
  }

  log("\n=== サマリ ===");
  log(`  既知（保存済み正解で自動回答）: ${known} 問`);
  log(`  自己訂正（不正解→緑枠の正解で答え直し）: ${corrected} 回`);
  log(`  未知（報告）: ${unknownList.length} 問 ${unknownList.length ? JSON.stringify(unknownList) : ""}`);
  log(`  正答率: ${done.pct ?? "?"} / 次レッスンへ遷移: ${advanced ? "あり" : "なし"}`);
  if (unknownList.length) {
    log("  ※ 未知問題は drill-import.mjs で取り込んでから再実行すると次回は自動突破できます。");
  }

  return { known, corrected, unknownList, done, advanced };
}

// 選択式（aria付き4択・○✕・aria無し4択の「選択肢から選んでください」型）を堅牢に回答する。
// 実機の確定フロー（観察済み）: 選択肢タップ→当該が選択状態(濃い枠 rgb(15,23,42)/bg rgba(15,23,42,0.15))
// →「回答する」(quiz-submit)が出現→押す→判定(quiz-feedback)。
// 重要: 選択済みの選択肢を再タップすると“選択解除(トグル)”される。よって「未選択のときだけタップ」する
// （以前は盲目的に再タップして解除→空回答で不正解になっていた・実ライブで確認）。
//   opts.correctText … 一致する選択肢を選ぶ（正解テキスト）。null なら index（既定0）の選択肢。
//   opts.index       … correctText 未指定時にタップする位置（import は常に 0）。
// 戻り値: フィードバックが出れば true。
export async function answerChoice(page, { correctText = null, index = 0, log = () => {} } = {}) {
  // 選択状態の判定＋全選択肢の選択状況を返す評価（診断ログ用に all も返す）。
  const readChoice = ({ correct, idx }) => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const strip = (s) => (s || "").replace(/[-]/g, "");
    const isSel = (e) => { const cs = getComputedStyle(e); return cs.borderColor === "rgb(15, 23, 42)" || /15, 23, 42, 0\.15/.test(cs.backgroundColor); };
    const els = [...document.querySelectorAll('[data-testid^="quiz-answer-option-"]')];
    els.forEach((e) => e.removeAttribute("data-choice-pick"));
    const all = els.map((e) => ({ t: strip(norm(e.textContent)).slice(0, 16), sel: isSel(e) }));
    if (!els.length) return { found: false, selected: false, all };
    let el = null;
    if (correct != null) {
      const c = strip(correct).replace(/\s+/g, " ").trim();
      el = els.find((e) => { const o = strip(norm(e.textContent)); return o === c || (o.endsWith(c) && o.length - c.length <= 2); });
    } else {
      el = els[idx] || els[0];
    }
    if (!el) return { found: false, selected: false, all };
    const selected = isSel(el);
    if (!selected) el.setAttribute("data-choice-pick", "1");
    return { found: true, selected, target: strip(norm(el.textContent)).slice(0, 16), all };
  };

  await sleep(300);
  let sig0 = null; // 最初の選択肢集合（並び順非依存）。設問が進んだら集合が変わる＝離脱する。
  for (let attempt = 0; attempt < 4; attempt++) {
    // ターゲットを特定し、未選択なら data-choice-pick を付ける（実クリックは Playwright で行う）。
    const st = await page.evaluate(readChoice, { correct: correctText, idx: index });
    const sig = (st.all || []).map((o) => o.t).sort().join("|");
    if (sig0 === null) sig0 = sig;
    else if (sig && sig !== sig0) { log(`        [choice a${attempt}] 設問が進んだため離脱（回答済みとみなす）`); return true; }
    log(`        [choice a${attempt}] target=${st.target ?? "?"} selected=${st.selected} all=${JSON.stringify(st.all)}`);
    if (!st.found) { await sleep(700); continue; }
    if (!st.selected) await page.click('[data-choice-pick="1"]').catch(() => {}); // 未選択時のみタップ（既選択の再タップは解除になる）
    await sleep(500);
    // 選択すると「回答する」(quiz-submit)が出る→押す（出るまで最大4秒）。送信直前の選択状況をログ。
    const hasSubmit = await page.waitForSelector('[data-testid="quiz-submit"]', { timeout: 4000 }).catch(() => null);
    const selNow = await page
      .evaluate(() => {
        const strip = (s) => (s || "").replace(/[-]/g, "");
        const isSel = (e) => { const cs = getComputedStyle(e); return cs.borderColor === "rgb(15, 23, 42)" || /15, 23, 42, 0\.15/.test(cs.backgroundColor); };
        return [...document.querySelectorAll('[data-testid^="quiz-answer-option-"]')].filter(isSel).map((e) => strip((e.textContent || "").replace(/\s+/g, " ").trim()).slice(0, 16));
      })
      .catch(() => []);
    log(`          submitBtn=${!!hasSubmit} 選択中=${JSON.stringify(selNow)}`);
    if (hasSubmit) await page.click('[data-testid="quiz-submit"]').catch(() => {});
    if (await page.waitForSelector('[data-testid="quiz-feedback"]', { timeout: 6000 }).catch(() => null)) return true;
  }
  return false;
}

// マッチング（線結び）。pairs（保存解説の正しい対応）があればそれで接続。
// 各ペアは表示の左選択肢・右項目へゆるく照合（読み仮名差を吸収）。pairs 無しは左[i]→右[i]。
export async function answerMatching(page, s, pairs = []) {
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
export async function answerOrdering(page, s, order = []) {
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

// cloze（複数空欄穴埋め）。sequence（空欄順の正解語）を順にタップして各空欄を埋め、全部埋めると
// 出る「回答する」(quiz-submit)を押して確定。sequence が空/不足のときは blankCount 個ぶん、
// 残っている選択肢を上から埋める（best effort＝未知時の前進用）。各タップで選択肢は並び替わるため
// 毎回テキスト一致で生DOMから対象を特定する。
export async function answerCloze(page, sequence = [], blankCount = 1) {
  const n = Math.max(blankCount, sequence.length || 0) || 1;
  for (let i = 0; i < n; i++) {
    const word = sequence[i] ?? null;
    const tagged = await page.evaluate((w) => {
      const norm = (x) => (x || "").replace(/\s+/g, " ").trim();
      const strip = (x) => (x || "").replace(/[-]/g, "");
      const els = [...document.querySelectorAll('[data-testid^="quiz-answer-option-"]')];
      els.forEach((e) => e.removeAttribute("data-cloze-pick"));
      let el = null;
      if (w != null) {
        const c = strip(norm(w));
        el = els.find((e) => { const o = strip(norm(e.textContent)); return o === c || (o.endsWith(c) && o.length - c.length <= 2); });
      }
      el = el || els[0]; // 未指定/不一致は先頭で前進
      if (el) { el.setAttribute("data-cloze-pick", "1"); return true; }
      return false;
    }, word);
    if (tagged) await page.click('[data-cloze-pick="1"]').catch(() => {});
    await sleep(700); // 空欄が埋まり選択肢が並び替わるのを待つ
  }
  // 全空欄が埋まると「回答する」が出る → 押して確定。
  await page.waitForSelector('[data-testid="quiz-submit"]', { timeout: 4000 }).catch(() => {});
  await page.click('[data-testid="quiz-submit"]', { timeout: 3000 }).catch(() => {});
  await page.getByText("回答する", { exact: true }).first().click({ timeout: 2000 }).catch(() => {});
}
