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

// すべての括弧注記（（…）/(…)）を除く（normLoose 済み文字列に適用する想定）。
// 保存解説の正しい順序/対応に AI が冗長な言い換え注記を付け、ドリル表示（注記が短い/無い）と
// ゆるい照合が外れるケースを救うための最終フォールバック用（例「リクエスト（リクエスト＝注文）」）。
const stripParens = (s) => (s || "").replace(/[（(][^（）()]*[）)]/g, "");

// 候補配列 cands から target にゆるく一致する要素の index を返す（無ければ -1）。
// 完全一致 → 一意な包含（短い方が4字以上）→ 括弧注記を除いた完全一致/一意な包含。
export function findLoose(cands, target) {
  const t = normLoose(target);
  if (!t) return -1;
  const ns = cands.map(normLoose);
  let i = ns.indexOf(t);
  if (i !== -1) return i;
  const uniqueInclude = (arr, key) => {
    if (key.length < 4) return -1;
    const hits = [];
    for (let j = 0; j < arr.length; j++) {
      const a = arr[j];
      if (a.length >= 4 && (a.includes(key) || key.includes(a))) hits.push(j);
    }
    return hits.length === 1 ? hits[0] : -1;
  };
  i = uniqueInclude(ns, t);
  if (i !== -1) return i;
  // フォールバック: 両側から括弧注記を除いて再照合（保存とドリル表示の注記差を吸収）。
  // 短い語（<4字）や、注記を外すと複数候補が同一になる紛らわしいケースは曖昧として -1（誤接続しない）。
  const tp = stripParens(t);
  if (tp.length < 4) return -1;
  const np = ns.map(stripParens);
  const exact = [];
  for (let j = 0; j < np.length; j++) if (np[j] === tp) exact.push(j);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return -1; // 注記除去で同一になる候補が複数 → 曖昧
  return uniqueInclude(np, tp); // 完全一致が無ければ一意な包含のみ採用
}

// 並べ替えで不正解になった直後、ドリルのフィードバックに出る「○○→△△→□□ の順です」から正解順
// （略語ラベル列）を取り出す。先頭の「マスターのワンポイント」等の前置きは捨てる。2項目未満は信頼せず[]。
export function extractOrderFromFeedbackText(text) {
  if (!text) return [];
  const norm = (text || "").replace(/\s+/g, " ");
  const m = norm.match(/([^。]*?)\s*の順(?:です|に|で|番)/);
  // 「ワンポイント」「正しくは」等のラベルがあればその後ろだけを順序列とみなす。
  let seg = m ? m[1].split(/ワンポイント|正しくは|正解は|正しい順序|順番は|順序は/).pop() : null;
  // 「の順です」が無いフィードバック対応（2026-07-03 実DOM=review-wrong-Q6.html で確定）:
  // 例「マスターのワンポイント リクエスト → サーバー処理 → レスポンス → ブラウザ表示 ── この 4 つの流れが基本です。」
  // 矢印チェーン（→が2個以上＝3項目以上）そのものを正解順とみなす。誤検知防止のため2項目チェーンには適用しない。
  if (seg == null) {
    const chain = norm.match(/[^→。]{1,60}(?:\s*(?:→|⇒|⇨|->)\s*[^→。]{1,60}){2,}/);
    if (!chain) return [];
    seg = chain[0].split(/ワンポイント|正しくは|正解は|正しい順序|順番は|順序は/).pop();
  }
  const parts = seg
    .split(/\s*(?:→|⇒|⇨|->|＞|>|、|，|・)\s*/)
    // 末尾項目に続く説明文（「ブラウザ表示 ── この4つの流れが…」）は長ダッシュで切り落とす。
    // ASCII の -- は選択肢の実テキスト（CLIフラグ等）に含まれ得るため対象にしない。
    .map((x) => x.split(/──|—|―/)[0].trim())
    .filter(Boolean);
  return parts.length >= 2 ? parts : [];
}

// 誤答後に回答エリア側へ出る「正しい順番」番号付きリストから正解順を取り出す
// （2026-07-04 実DOM=UIデザインの世界L1復習Q4 review-wrong-Q4.html で確定）。
// このブロックは quiz-feedback 要素の**外側**に出るためページ全文（body.innerText）を渡すこと。
// 設問の指示文「正しい順番に並べてください」と誤マッチしないよう、マーカーの直後に「1」が
// 続く場合だけをリストとみなす。①行ベース（番号が単独行）を優先し、②空白正規化テキストの
// 「1 項目 2 項目…」形式にフォールバック。番号は 1 から昇順連続のみ信頼、2項目未満は[]。
export function extractOrderFromCorrectListText(text) {
  if (!text) return [];
  // ① 行ベース: 「正しい順番」行 → 「1」行 → 項目行 → 「2」行 → … （innerText の実形式）
  const lines = String(text).split(/\r?\n/).map((s) => s.trim());
  const mi = lines.findIndex((l) => /^正しい順[番序][:：]?$/.test(l));
  if (mi >= 0) {
    const items = [];
    let expect = 1;
    for (let i = mi + 1; i < lines.length; i++) {
      if (!lines[i]) continue;
      if (lines[i] !== String(expect)) break;
      let j = i + 1;
      while (j < lines.length && !lines[j]) j++;
      const item = lines[j];
      if (!item || /^\d+$/.test(item) || /不正解|正解！|ワンポイント/.test(item)) break;
      items.push(item);
      expect++;
      i = j;
    }
    if (items.length >= 2) return items;
  }
  // ② 空白正規化フォールバック: 「正しい順番 1 ○○ 2 △△ … 不正解...」の一続きテキスト
  const norm = String(text).replace(/\s+/g, " ");
  const m = norm.match(/正しい順[番序]\s*[:：]?\s+(?=1\s)/);
  if (!m) return [];
  let seg = norm.slice(m.index + m[0].length);
  seg = seg.split(/不正解|正解！|マスターのワンポイント/)[0];
  const parts = seg.split(/(?:^|\s)(\d{1,2})\s+/); // ["", "1", 項目, "2", 項目, …]
  const items = [];
  let expect = 1;
  for (let i = 1; i + 1 < parts.length; i += 2) {
    if (parts[i] !== String(expect)) break;
    const item = (parts[i + 1] || "").trim();
    if (!item) break;
    items.push(item);
    expect++;
  }
  return items.length >= 2 ? items : [];
}

// 略語ラベル target を候補 cands の中で「トークン（漢字/かな/英数の連なり）の一致数」が最大の1つに
// 対応づけて index を返す。並べ替えの正解ヒントが略語（「コマンド実行」）で選択肢がフル文
// （「マイグレーションコマンドを実行する」）のとき、findLoose（包含一致）では取れないのを救う。
// 一致数が最大かつ唯一のときだけ採用、同点で曖昧なら -1（誤タップ防止）。used の index は除外。
export function bestOverlapIndex(cands, target, used = []) {
  const toks = (s) => normLoose(s).match(/[A-Za-z0-9]+|[一-龠々〆ヶ]+|[ぁ-ん]+|[ァ-ヴー]+/g) || [];
  const tt = toks(target);
  if (tt.length === 0) return -1;
  const scores = cands.map((c, j) => {
    if (used.includes(j)) return -1;
    const cn = normLoose(c);
    let s = 0;
    for (const t of tt) if (t.length >= 1 && cn.includes(t)) s += t.length; // 長い一致ほど高得点
    return s;
  });
  let best = -1, bestScore = 0, second = 0;
  scores.forEach((s, j) => {
    if (s > bestScore) { second = bestScore; bestScore = s; best = j; }
    else if (s > second) second = s;
  });
  return bestScore > 0 && bestScore > second ? best : -1;
}

// targets（保存の左/右ラベル列）を cands（実ドリルのセル列）へ 1対1 で割り当てる（消去法・制約伝播）。
// 線結びは右セルが曖昧（例 右=[最大要素の表示時間, 表示のガタつき, 操作への反応時間] は全部「表示」を含む）で、
// 略語ヒント（保存「表示速度」）が findLoose でも bestOverlapIndex 単発でも同点タイで取れないことがある。
// → ①まず findLoose で確実に取れる一意対応を確定、②残りは「いまの未使用セルの中で一意に最良」な
//   target を見つけて確定…を進展が止まるまで反復。他が先にセルを取ると残りが一意化して解ける
//   （実例: ガタつき→FID/CLS が先に確定→残った1セルへ「表示速度」が一意に決まる）。曖昧で詰まった
//   target は -1 のまま（誤接続せず呼び出し側が機械接続へ退避）。返り値は target 順の cand index 配列。
export function resolveWithElimination(cands, targets) {
  const result = new Array(targets.length).fill(-1);
  const usedCand = new Set();
  // ① findLoose（包含/完全一致）で確実に取れる対応を先に確定（未使用セルのみ採用）。
  for (let i = 0; i < targets.length; i++) {
    const idx = findLoose(cands, targets[i]);
    if (idx !== -1 && !usedCand.has(idx)) { result[i] = idx; usedCand.add(idx); }
  }
  // ② 残りはトークン重なりで「いま一意に最良」のものだけ確定→使用済みを除外して再走査、を反復。
  let progress = true;
  while (progress) {
    progress = false;
    for (let i = 0; i < targets.length; i++) {
      if (result[i] !== -1) continue;
      const ci = bestOverlapIndex(cands, targets[i], [...usedCand]);
      if (ci !== -1) { result[i] = ci; usedCand.add(ci); progress = true; }
    }
  }
  return result;
}

// 保存解説の pairs（{left,right}）を、実ドリルの左 options / 右 rightItems の index 対応へ解決する。
// 左右とも resolveWithElimination（findLoose→トークン重なりの消去法）で 1対1 に割り当て、
// 全 pair を解決できたときだけ接続プラン [左option index, 右ラベル] を返す。1つでも詰まれば null
// （呼び出し側が機械接続へ退避）。左の全項目を接続できることを要件にする（[[matching-import-is-1to1-positional]]）。
export function assignMatchingPairs(options, rightItems, pairs) {
  if (!pairs?.length || !options?.length || !rightItems?.length) return null;
  // 左は 1 対 1（各左セルは別の行）。消去法で割り当てる。
  const lefts = resolveWithElimination(options, pairs.map((p) => p.left));
  // 右は「多対1」を許容する。例: レストラン分類（バックエンドの世界 L2 Q4）は 5 左 → 3 右で
  //   『ホール』『厨房』が各2回・『連携』1回。pair 数ぶん右を 1対1 で取ろうとすると、重複ラベルの
  //   2つ目以降が「未使用セル無し」で -1 になり assignMatchingPairs が null→機械接続→6回ループ停止していた。
  // → 右ラベルを重複排除してから消去法で右セルへ 1対1 に確定し（曖昧な右セルの取り違えはこれで防ぐ）、
  //   同じラベルの pair はすべて同じ右セルへ割り当てる（[[matching-import-is-1to1-positional]] の多対1拡張）。
  const distinctRights = [...new Set(pairs.map((p) => p.right))];
  const resolvedDistinct = resolveWithElimination(rightItems, distinctRights);
  const labelToCand = new Map(distinctRights.map((lbl, k) => [lbl, resolvedDistinct[k]]));
  const plan = [];
  for (let i = 0; i < pairs.length; i++) {
    const ri = labelToCand.get(pairs[i].right);
    if (lefts[i] === -1 || ri == null || ri === -1) return null;
    plan.push([lefts[i], rightItems[ri]]);
  }
  return plan.length === options.length ? plan : null;
}

// 「### 正しい順序」/「## 正しい順序」の番号付きリスト → 手順テキスト配列（順序どおり）。
export function extractOrder(expl) {
  if (!expl) return [];
  const m = expl.match(/#{2,3}\s*正しい順序\s*\n([\s\S]*?)(?:\n#{2,3}\s|$)/);
  if (!m) return [];
  let items = [...m[1].matchAll(/^\s*\d+[.\．、)]\s*(.+?)\s*$/gm)].map((x) => x[1].trim()).filter(Boolean);
  // ⚠ 全手順が1行に「1. **A** → 2. **B** → 3. **C**」と矢印チェーンで書かれる形式がある
  //   （実データ ビルドの裏側 L8 Q9: 1手順として抽出→タップ計画1/3で復習突破に失敗しシリーズ停止）。
  //   行が1件だけ＆矢印を含むときに限り矢印で分割（複数行リストの手順内矢印を誤分割しないため）。
  if (items.length === 1 && /(?:→|⇒|⇨|->)/.test(items[0])) {
    items = items[0].split(/\s*(?:→|⇒|⇨|->)\s*/);
  }
  return items
    .map((s) => s.replace(/^\s*\d+[.\．、)]\s*/, "").replace(/\*\*/g, "").trim())
    .filter(Boolean);
}

// 「### 正しい対応」/「## 正しい対応」の「左 → 右」/「左 ↔ 右」行 → {left,right} 配列。
export function extractPairs(expl) {
  if (!expl) return [];
  const m = expl.match(/#{2,3}\s*正しい対応\s*\n([\s\S]*?)(?:\n#{2,3}\s|$)/);
  if (!m) return [];
  const pairs = [];
  for (const line of m[1].split("\n")) {
    // ⚠ 左に矢印を含む対応（実データ GitHubクラウド連携 L6 Q4:
    //   「ローカル → リモート → push(プッシュ)」）がある。左を非貪欲 (.+?) で取ると
    //   最初の矢印で切れ 左=「ローカル」右=「リモート → push(プッシュ)」と誤分割し、
    //   右が実セル(push/pull)と一致せず割当不能→機械接続→不正解6回停止していた。
    //   → 左を貪欲 (.+) にして「最後の矢印」で分割する（右は末尾の短い答えラベル）。
    const mm = line.match(/^\s*[-*・]?\s*(.+)\s*(?:→|↔|⇔|->)\s*(.+?)\s*$/);
    if (mm) pairs.push({ left: mm[1].trim(), right: mm[2].trim() });
  }
  return pairs;
}

// テキスト hay の中で各選択肢語の“最初の出現位置”順に並べ、重複を除いて一意化して返す（cloze 基本走査）。
export function orderedOptionsInText(hay, options) {
  const h = normLoose(hay);
  // 選択肢語の出現位置。フル形（normLoose）で取れなければ、括弧注記を剥がした素の語でも探す。
  // ⚠ normLoose は“かな注記”の括弧しか剥がさない（例「（送信）」は漢字＝残る）。選択肢は
  // 「コミット（記録）」「アップロード（送信）」のように漢字注記付きで保存される一方、正解理由の
  // 本文は「コミット」とだけ書くため、フル形では全滅し先頭選択肢へ誤フォールバックしていた
  // （実ライブ Git概念マスター L2「記録する操作の名前」＝正解コミットを取り違え6回停止）。
  const idxOf = (o) => {
    const full = normLoose(o);
    let i = full ? h.indexOf(full) : -1;
    if (i >= 0) return i;
    const bare = stripParens(full);
    // 素の語は短すぎる部分一致を避けるため2字以上に限定（フル形と異なる時のみ試す）。
    if (bare && bare.length >= 2 && bare !== full) {
      i = h.indexOf(bare);
      if (i >= 0) return i;
    }
    return -1;
  };
  const found = (options || [])
    .map((o) => ({ o, i: idxOf(o) }))
    .filter((x) => x.i >= 0)
    .sort((a, b) => a.i - b.i);
  // 同点（同じ位置）や重複語は曖昧 → 出現順に一意化
  const seq = [];
  for (const x of found) if (!seq.includes(x.o)) seq.push(x.o);
  return seq;
}

// 単一空欄向け: テキスト hay での出現回数が最多の選択肢を返す（同数なら最先頭・無ければ null）。
// 正解理由の本文は“正解語”を主語に繰り返し説明する一方、誤答語は説明の都合で先に1回だけ出ることが
// ある。「最初の出現位置」だと誤答語を拾う（実ライブ Git概念マスター L4 Q5＝本文が
// 『ブランチは…そこで作った変更を本流に取り込みたいときに使うのがマージです』で誤答ブランチが先頭に
// 出るが、正解マージは2回出る）。頻度で見ると正解語が勝つので単一空欄の最終手段として頑健。
export function topOptionByFrequency(hay, options) {
  const h = normLoose(hay);
  const matchForm = (o) => {
    const full = normLoose(o);
    if (full && h.includes(full)) return full;
    const bare = stripParens(full);
    if (bare && bare.length >= 2 && bare !== full && h.includes(bare)) return bare;
    return null;
  };
  let best = null;
  for (const o of options || []) {
    const form = matchForm(o);
    if (!form) continue;
    const count = h.split(form).length - 1;
    if (count <= 0) continue;
    const first = h.indexOf(form);
    if (!best || count > best.count || (count === best.count && first < best.first)) {
      best = { o, count, first };
    }
  }
  return best ? best.o : null;
}

// 解説の「間違い選択肢のどこが違う？」節に太字見出し（**語**：）で登場する選択肢＝確定した誤答語。
// 正解語が本文に選択肢の表記どおり現れない解説では、この節の太字誤答語だけが唯一の完全一致になり、
// 出現順走査が誤答集合を“正解”として導出してしまう（実ライブ ネット接続とクラウドの入口 L3 Q6＝
// 本文は「ルーターか…回線のどちらか」と『側』なしで書く一方、誤答は「**サービス側**：」「**端末側**：」
// と太字見出しで登場→[サービス側,端末側]を導出・総当たりプールも同集合に閉じて候補2件で尽き8回停止）。
// 見出し位置（太字＋直後にコロン）に限定するので、節の説明文中に正解語が混ざっても誤検出しない。
export function wrongOptionsInExplanation(expl, options) {
  const wrong = new Set();
  if (!expl || !options?.length) return wrong;
  const wi = expl.search(/間違い選択肢|どこが違う/);
  if (wi < 0) return wrong;
  let section = expl.slice(wi);
  const nh = section.search(/\n#{2,3}\s/);
  if (nh > 0) section = section.slice(0, nh);
  const heads = [...section.matchAll(/\*\*([^*\n]+)\*\*\s*[:：]/g)].map((m) => normLoose(m[1]));
  for (const o of options) {
    const full = normLoose(o);
    if (heads.some((h) => h === full || h === stripParens(full))) wrong.add(o);
  }
  return wrong;
}

// cloze（複数空欄穴埋め）の正解シーケンスを解説本文から導く。
// 空欄は本文の順にタップ語で埋める（実機観察済み）。公式/保存解説は答えの語を空欄順で言及するため
// （例「pnpm が…その pnpm 自体は Node.js…」）、各選択肢語の“最初の出現位置”で並べ替えて blankCount 個返す。
// 期待数（blankCount）に満たない/曖昧なときは空配列＝未知扱い（report）にフォールバック。
export function extractClozeSequence(expl, options, blankCount) {
  if (!expl || !options?.length || !blankCount) return [];
  // ⚠ 問題文（## 問題）に“固定語”として既に印字されている選択肢は空欄の答えではない＝ダミー。
  //   これを本文の出現順走査に混ぜると、固定語が先頭に来て答え全体が1つずれる（実ライブ
  //   ブランチ戦略コース L4 Q9: 問題「feature ブランチで ＿＿＿ をしても、＿＿＿ ブランチは常に
  //   ＿＿＿ 状態を保てる」で、選択肢 feature は固定語なのに本文冒頭「featureブランチで…」に
  //   一致して拾われ [feature, どんな実験, main] と誤導出→6回停止。正解は [どんな実験, main, 安全な]）。
  //   → 空欄マーカー（＿の連なり／_の連なり／［…］）を除いた問題文に現れる選択肢を候補から外す。
  //   ただし外すと blankCount を満たせない時は安全側で元の選択肢のまま（消しすぎ防止）。
  let opts = options;
  const stemM = expl.match(/##\s*問題\s*\n([\s\S]*?)(?:\n#{2,3}\s|$)/);
  if (stemM) {
    const stemFixed = normLoose(stemM[1].replace(/[＿_]{2,}|[［\[][^］\]]*[］\]]/g, " "));
    if (stemFixed) {
      const filtered = options.filter((o) => {
        const full = normLoose(o);
        return !(full && stemFixed.includes(full)); // 問題文に既出＝ダミーなので除外
      });
      if (filtered.length >= blankCount) opts = filtered;
    }
  }
  // 「間違い選択肢」節の太字見出しに載る選択肢＝確定誤答を候補から外す（残りが blankCount 未満に
  // なる時は消しすぎ防止で外さない）。最終フォールバックの tryOn(noList) は同節を含む全文を走査する
  // ため、ここで外さないと誤答集合を導出する（実ライブ ネット接続とクラウドの入口 L3 Q6）。
  const wrongOpts = wrongOptionsInExplanation(expl, opts);
  if (wrongOpts.size) {
    const kept = opts.filter((o) => !wrongOpts.has(o));
    if (kept.length >= blankCount) opts = kept;
  }
  const tryOn = (body) => orderedOptionsInText(body, opts);
  // ⚠ 解説の冒頭には buildAnswerBlock の「選択肢: - A - B …」列挙があり、語が“列挙順”に並ぶ。
  // これを走査すると列挙順を答え順と誤認する（実ライブ Lesson8 Q10 で『ブラウザ→インターネット』と
  // 誤導出＝正解は『ブラウザ→サーバー』）。→ まず選択肢列挙ブロックを常に除去し、その上で『## 解説』
  // 以降かつ『間違い選択肢』より前（＝正解理由の本文）だけで出現順を引く（誤答語は除外される）。
  const noList = expl.replace(/選択肢[:：]\s*(?:\n\s*[-*・].*)+/g, "");
  let primary = noList;
  const di = noList.search(/##\s*解説/);
  if (di >= 0) primary = noList.slice(di);
  const wi = primary.search(/間違い選択肢|どこが違う/);
  if (wi > 0) primary = primary.slice(0, wi);
  // ⚠ 最優先: 正解理由本文の“結論文”（正解/つまり/空欄に…が入る 等）だけを走査する。
  // 正解理由の本文は結論の前に積み上げ説明があり、そこに誤答語(distractor)が登場して出現順を汚す
  // （実ライブ Tailwind L5 Q6＝本文に『PC向けのスタイルを追加していく』が先に出て [PC,スマホ] と誤導出。
  // だが結論文『つまり、スマホ用が基本で、md:やlg:で大画面向けを追加するというのが正解』だけ見れば
  // [スマホ, md:やlg:] が正しく引ける）。結論文で“ちょうど blankCount 個”取れた時だけ最優先で採用する。
  const conclusion = primary
    .split(/[。\n！？]/)
    .filter((sent) => /正解|つまり|したがって|空欄|が入(り|る)|答えは|になります/.test(sent))
    .join("　");
  const seqConcl = conclusion ? tryOn(conclusion) : [];
  if (seqConcl.length === blankCount) return seqConcl.slice(0, blankCount);
  // ⚠ 最優先: 正解理由本文の「…」『…』で“強調された”語句だけを走査する。
  // 裸の indexOf は短い選択肢語が地の文の複合語に部分一致して誤順になる（実ライブ CSS L5 Q5＝
  // 選択肢「要素」が「インライン要素」に最速一致し [要素,中身] と誤導出。正解は [中身,横]）。
  // 答えの語は本文で引用符付きで強調される一方（例「中身の幅だけ取って横に並ぶ」「横」）、地の文の
  // 複合語は引用されないため、引用句に限定すると複合語の部分一致を排除して正しい出現順を引ける。
  const quoted = [...primary.matchAll(/[「『]([^「」『』]+)[」』]/g)].map((m) => m[1]).join("　");
  let seq = quoted ? tryOn(quoted) : [];
  // ガード: 引用句が選択肢を blankCount より多く含む＝答えの強調でなく“構造的な列挙”（例 CSS L4 Q5
  // 「content→padding→border→margin」）であり、列挙順を答え順と誤認する。→ 引用句を捨て本文へ。
  if (seq.length > blankCount) seq = [];
  // 単一空欄の最終手段: 正解理由本文での“出現頻度が最多”の語を採る（最初の出現位置だと誤答語を
  // 拾う実ライブ Git L4 Q5 を救う）。複数空欄は順序が要るので頻度は使わず従来の出現順のまま。
  if (seq.length < blankCount && blankCount === 1) {
    const top = topOptionByFrequency(primary, opts);
    if (top) return [top];
  }
  // フォールバック: 引用句で足りなければ正解理由の本文全体 → 選択肢列挙を除いた全文の順で再走査。
  if (seq.length < blankCount) seq = tryOn(primary);
  if (seq.length < blankCount) seq = tryOn(noList);
  return seq.length >= blankCount ? seq.slice(0, blankCount) : [];
}

// K要素の全順列（K! 個）を返す。cloze の空欄数は 2〜3 程度なので K! は小さい（2 or 6）。
// pool から重複なく k 個を選ぶ順列（arrangement）を列挙する。要素数が多いと爆発するため
// 呼び出し側で pool を小さく絞る前提（複数空欄穴埋めの総当たり候補生成に使用）。出現順（pool順）を
// 保つよう先頭要素を優先して深さ優先で並べる＝解説に先に出た語の組合せから先に試せる。
export function arrangements(pool, k) {
  const out = [];
  const used = new Array(pool.length).fill(false);
  const cur = [];
  const rec = () => {
    if (cur.length === k) { out.push(cur.slice()); return; }
    for (let i = 0; i < pool.length; i++) {
      if (used[i]) continue;
      used[i] = true; cur.push(pool[i]);
      rec();
      cur.pop(); used[i] = false;
    }
  };
  if (k > 0 && k <= pool.length) rec();
  return out;
}

export function permute(arr) {
  if (!Array.isArray(arr) || arr.length <= 1) return [Array.isArray(arr) ? arr.slice() : []];
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = arr.slice(0, i).concat(arr.slice(i + 1));
    for (const p of permute(rest)) out.push([arr[i], ...p]);
  }
  return out;
}

// cloze の「空欄を埋める順序」候補をランク付き（先頭ほど確度が高い）で返す。
//   1) フィードバックから学習済みの正解（あれば最優先）
//   2) extractClozeSequence の導出（従来の第一候補）
//   3) 充填集合の全順列（＝“どの語が入るか”は合っていて順序だけ外したケースを網羅）
// 呼び出し側（clearReview）が「一度不正解だった順序」を記憶し、次は未試行の候補を出す。これにより
// 初回導出が外れても順序違いを尽くして必ず正答へ収束し、「同じ誤答を再導出→6回ループ→停止」を根絶する
// （[[review-selfcorrect-from-feedback]]／実ライブ ブランチ戦略 L4 Q9 の穴埋め×3 停止対策の恒久版）。
export function buildClozeCandidates(expl, options, blankCount, learnedSeq) {
  const cands = [];
  const seen = new Set();
  const push = (seq) => {
    if (!Array.isArray(seq) || seq.length !== blankCount) return;
    const k = seq.join("¦");
    if (seen.has(k)) return;
    seen.add(k);
    cands.push(seq.slice());
  };
  if (learnedSeq) push(learnedSeq);
  const primary = extractClozeSequence(expl, options, blankCount);
  push(primary);
  // 学習済み正解（フィードバック由来）の順列も上位候補に足す＝集合は正しく順序だけ読み違えた場合に収束。
  if (learnedSeq?.length === blankCount) for (const p of permute(learnedSeq)) push(p);
  // 「間違い選択肢」節の太字見出し＝確定誤答は充填集合・総当たりプールから除外する（残りが blankCount
  // 未満なら除外しない）。除外しないと、正解語が本文に表記どおり現れない解説で誤答集合に閉じて候補が
  // 尽きる（実ライブ ネット接続とクラウドの入口 L3 Q6＝候補2件で8回停止）。
  const wrongOpts = wrongOptionsInExplanation(expl || "", options || []);
  let poolOpts = options || [];
  if (wrongOpts.size) {
    const kept = poolOpts.filter((o) => !wrongOpts.has(o));
    if (kept.length >= blankCount) poolOpts = kept;
  }
  // 充填集合＝順列の元。導出が空欄数ぶん取れていればその集合（stem除外済み）、無ければ本文出現順の上位 blankCount。
  let fillSet = primary.length === blankCount ? primary : null;
  if (!fillSet) {
    const ordered = orderedOptionsInText(expl, poolOpts);
    if (ordered.length >= blankCount) fillSet = ordered.slice(0, blankCount);
  }
  if (fillSet && fillSet.length === blankCount) {
    for (const p of permute(fillSet)) push(p);
  }
  // 複数空欄: 導出した充填“集合”自体が誤りのことがある（正解理由本文が distractor 語に言及し
  // 出現順が汚れる。実ライブ チーム開発 L6 Q7＝解説「pull は fetch と merge をまとめて…」で
  // [pull, merge] と誤導出。正解は [pull, push]）。→ 選択肢列挙ブロックを除いた本文に“実際に出現
  // する”選択肢だけを母集合に、blankCount 個の順列を候補へ追加して総当たり（clozeTried の記憶で収束）。
  // 母集合は blankCount+2 語までに絞り組合せ爆発を防ぐ（出現順で先頭優先＝解説に先に出た組から試す）。
  if (blankCount >= 2 && Array.isArray(options)) {
    const noList = (expl || "").replace(/選択肢[:：]\s*(?:\n\s*[-*・].*)+/g, "");
    const present = orderedOptionsInText(noList, poolOpts);
    const pool = (present.length >= blankCount ? present : poolOpts).slice(0, blankCount + 2);
    for (const arr of arrangements(pool, blankCount)) push(arr);
  }
  // 単一空欄は「どの選択肢が入るか」＝実質 N 択。導出（primary）が外れても
  // 全選択肢を候補に加えて総当たり＝clozeTried の記憶と併せて必ず正答へ収束する
  // （複数空欄は順列で尽くすが、単一空欄は fillSet が1語で導出値しか試さず詰まっていた）。
  if (blankCount === 1) {
    for (const o of options || []) push([o]);
  }
  return cands;
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

// 復習の問題シグネチャ（自己訂正リプレイ／重複判定のキー）。
// 問題文だけだと、フィナーレ・レッスンの固定バナー（例「Webの地図を完成させよう（The Finale）」）が
// readState の「最長葉テキスト」ヒューリスティックで questionText に化け、別問題どうしが同じ問題文に
// なって衝突する（実ライブで ○✕ と 4択 が同一sig になり、○✕の訂正「間違い」が4択へ誤適用された）。
// → 選択肢集合（並び順非依存にソート）もキーに含めて厳密化する。問題文・選択肢ともに空なら "" を返す
//   （呼び出し側が qnum へフォールバック）。
export function questionSig(questionText, options = []) {
  const qkey = normKey(questionText);
  const optSig = (options || []).map((o) => normKey(o)).filter(Boolean).sort().join("¦");
  return qkey || optSig ? `${qkey}¦${optSig}` : "";
}

// 学習済み正解（corrections の値）が、いま表示中の選択肢に実在するか。
// 別問題の訂正（sig 衝突の取りこぼし等）を現在の設問へ force-apply しないためのガード。
// seq（cloze）は全語が、text（選択式）は1語が選択肢に一致して初めて「適用可」とする。
export function correctionApplies(corr, options = []) {
  if (!corr) return false;
  const cands = corr.seq?.length ? corr.seq : corr.text ? [corr.text] : [];
  if (!cands.length) return false;
  return cands.every((c) => (options || []).some((o) => optionMatchesCorrect(o, c)));
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
// サーバーが一時的に落ちていても「全問が未知」になる二次被害を防ぐため、取得失敗(fetch失敗/5xx)は
// 待って再試行する。復帰すれば既知判定が効き、復習は保存済み正解で自動突破できる。retries回試して
// なお失敗した時だけ空Mapにフォールバック（＝サーバーが本当に死んでいる）。
export async function fetchIndex(studyLogApi, log = console.log, { retries = 12, waitMs = 5000 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(studyLogApi);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const index = buildIndex(await res.json());
      log(`studyLog 取得 OK（既知問題 ${index.size} 件）`);
      return index;
    } catch (e) {
      if (attempt < retries) {
        log(`⚠ studyLog を取得できません（${e.message}）。サーバー復帰を待って再試行 ${attempt + 1}/${retries}…`);
        await sleep(waitMs);
        continue;
      }
      log(`⚠ studyLog を取得できません（dev サーバは起動中？ ${studyLogApi}）: ${e.message}`);
      log("  既知判定ができないため、全問が「未知」として報告されます。");
      return new Map();
    }
  }
  return new Map();
}

// 回答後フィードバックの緑枠 rgb(22,163,74) が付いた選択肢テキストを「正解」として読む（自己訂正用）。
// 選択式/○✕/1空欄cloze はこれで正解1つが取れる。複数空欄clozeは緑が複数＝順序は best effort（seqで返す）。
// 穴埋めフィードバック本文（マスターのワンポイント等）から正解シーケンスを読む純関数。
// 単一空欄＝出現頻度最多の語（付随語に負けない）。複数空欄＝出現順で、ちょうど空欄数ならそのまま、
// 空欄数を超えたら“先頭から空欄数ぶん”を採用する。ワンポイントは正解語を空欄順で先に述べ、誤答語は
// 末尾の対比文で触れる文型のため（実ライブ ネット接続とクラウドの入口 L3 復習Q5＝「共通の経路である
// ルーター側 か、その先の 回線側 に問題があります。端末側なら『自分だけ遅い』になるはず」→3語取れて
// 旧・厳密一致 3≠2 で弾かれ自己訂正できず8回停止）。誤読でも clozeTried の不正解記憶で1回で捨てられる。
export function clozeSeqFromFeedbackText(fbText, options, blankCount) {
  if (!fbText || !options?.length || !blankCount) return null;
  const seg = (fbText.split(/ワンポイント|正しくは|正解は/).pop() || fbText).trim();
  if (blankCount === 1) {
    const top = topOptionByFrequency(seg, options) || orderedOptionsInText(seg, options)[0];
    return top ? [top] : null;
  }
  const seq = orderedOptionsInText(seg, options);
  if (seq.length >= blankCount) return seq.slice(0, blankCount);
  return null;
}

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
      // 正解マーカーの緑 rgb(22,163,74)。border/bg だけでなく文字色/外枠色や、選択肢の
      // 子孫要素（緑チェックのアイコン枠など）に付くケースもあるため広めに見る（4択でも確実に拾う）。
      const hasGreen = (e) => {
        const c = getComputedStyle(e);
        const g = (v) => /\b22,\s*163,\s*74\b/.test(v || "");
        return g(c.borderColor) || g(c.backgroundColor) || g(c.color) || g(c.outlineColor);
      };
      const optHasGreen = (opt) => hasGreen(opt) || [...opt.querySelectorAll("*")].some(hasGreen);
      const opts = [...document.querySelectorAll('[data-testid^="quiz-answer-option-"]')];
      const greens = opts
        .filter(optHasGreen)
        .map((e) => strip(norm(e.textContent)))
        .filter(Boolean);
      if (greens.length) return greens;
      // 緑枠を使わない画面がある（実機: Git開発フロー実践 L5 復習）。その場合も回答後は
      // 正解の選択肢の aria-label に「（正解）」が付く＝取込側 readState と同じ規則で読む。
      // （「不正解」は文字列「正解」を含むため除外。aria === textContent は未回答表示なので除外）
      return opts
        .filter((e) => {
          const a = e.getAttribute("aria-label") || "";
          return a.includes("正解") && !a.includes("不正解") && norm(a) !== norm(e.textContent);
        })
        .map((e) => strip(norm(e.textContent)))
        .filter(Boolean);
    })
    .catch(() => []);
  if (!greens.length) {
    // この UI の穴埋めフィードバックは正解を緑で示さない（実機: 緑 rgb(22,163,74) は未使用CSSのみ）。
    // 正解は「マスターのワンポイント」本文に記述される（例「Tailwind は スマホ用が基本 で、md: や lg:
    // で大画面向けを追加 する…」）。→ フィードバック本文から正解語の出現順を読み、自己訂正シーケンスに
    // する。ちょうど空欄数ぶん取れた時だけ採用（過不足は誤学習を避けて null）。
    if (s.isCloze && s.clozeBlanks > 0 && s.options?.length) {
      const fbText = await page
        .evaluate(() => {
          const el = document.querySelector('[data-testid="quiz-feedback"]');
          return el ? el.innerText || el.textContent || "" : "";
        })
        .catch(() => "");
      // 読取ロジックは純関数 clozeSeqFromFeedbackText に集約（単一空欄=頻度最多／複数空欄=出現順
      // 先頭から空欄数ぶん。文型の根拠と実ライブ事例は関数コメント参照）。
      const seq = clozeSeqFromFeedbackText(fbText, s.options, s.clozeBlanks);
      if (seq) return { seq };
    }
    return null;
  }
  return s.isCloze ? { seq: greens } : { text: greens[0] };
}

// 線結びの誤答フィードバックにある「正しい組み合わせ」一覧（左→右が交互の行）からペアを組み立てる純関数。
// 旧スクショ取込データ（questionText なし・「## 問題」がAIの言い換え文）は studyLog 照合が全滅し、
// 線結びは学習手段ゼロ＝機械接続の同型リトライで停止していた（実ライブ 2026-07-03 DBがないと壊れる世界 L1 復習Q4）。
// この一覧は誤答時に必ず表示されるため、ここから学習すれば studyLog に頼らず自己訂正できる。
//   lines      : 「正しい組み合わせ」ブロックの innerText を行分割したもの（見出し・後続UIを含んでよい）
//   leftLabels : 画面の左セル一覧（s.options）。行の左右判定に使う
export function parsePairsFromCorrectCombo(lines, leftLabels) {
  const norm = (x) => (x || "").replace(/\s+/g, " ").trim();
  const tight = (x) => norm(x).replace(/\s/g, "");
  const lefts = new Set((leftLabels || []).map(tight));
  // アイコンフォントのグリフ行を落とす: ペア間に ionicons の矢印（私用領域 U+E000-F8FF）だけの行が
  // 挟まり、見た目は空でも filter(Boolean) を通過して「右ラベル」に化ける（実DOM検証で発見）。
  const visible = (x) => norm(x).replace(/[\u{E000}-\u{F8FF}\u{200B}-\u{200D}\u{FE0F}]/gu, "").trim();
  // 見出しより前の行（問題盤面など）を落とし、「N/N ペア完成」以降の別UIで打ち切る
  const normed = lines.map(norm).filter((l) => visible(l));
  let started = !normed.includes("正しい組み合わせ");
  const body = [];
  for (const l of normed) {
    if (!started) { if (l === "正しい組み合わせ") started = true; continue; }
    if (/^\d+\s*\/\s*\d+\s*ペア完成/.test(l)) break;
    body.push(l);
  }
  // 左ラベル行 → 直後の非左行を右として対応づける
  const pairs = [];
  for (let i = 0; i < body.length; i++) {
    if (!lefts.has(tight(body[i]))) continue;
    if (i + 1 < body.length && !lefts.has(tight(body[i + 1]))) pairs.push({ left: body[i], right: body[i + 1] });
  }
  // 左判定で全ペア取れないとき（表記ゆれ等）は「左右交互の並び」を仮定するフォールバック
  if (pairs.length < (leftLabels || []).length && body.length === (leftLabels || []).length * 2) {
    const alt = [];
    for (let i = 0; i + 1 < body.length; i += 2) alt.push({ left: body[i], right: body[i + 1] });
    if (alt.length > pairs.length) return alt;
  }
  return pairs;
}

// 誤答後の画面から「正しい組み合わせ」ブロックを探して正解ペアを読む（線結びの自己訂正用）。
export async function readPairsFromFeedback(page, s) {
  const lines = await page
    .evaluate((leftLabels) => {
      const norm = (x) => (x || "").replace(/\s+/g, " ").trim();
      const tight = (x) => norm(x).replace(/\s/g, "");
      const heads = [...document.querySelectorAll("*")].filter((e) => norm(e.textContent) === "正しい組み合わせ");
      let box = heads.pop(); // querySelectorAll は文書順＝pop で最深の見出し要素
      if (!box) return null;
      // 全左ラベルを含む最小の祖先まで上る＝ペア一覧のコンテナ（上りすぎると盤面が混ざるため最小で止める）
      const wants = (leftLabels || []).map(tight).filter(Boolean);
      for (let i = 0; i < 12 && box.parentElement; i++) {
        const t = tight(box.innerText || "");
        if (wants.length && wants.every((w) => t.includes(w))) break;
        box = box.parentElement;
      }
      return (box.innerText || "").split("\n");
    }, s.options || [])
    .catch(() => null);
  if (!lines) return [];
  return parsePairsFromCorrectCombo(lines, s.options || []);
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
  // 穴埋め専用: sig -> 既に試して不正解だった順序キー(Set)。次回は未試行の候補順序を選ぶ（順序総当たり）。
  const clozeTried = new Map();
  // 3空欄=6順列＋導出/学習ぶんの余地。順列を尽くす前に打ち切らないよう 6→8 に緩和（誤停止を減らすだけで安全側）。
  const MAX_ATTEMPTS = 8;
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
    // 重複判定は Q番号でなく問題文＋選択肢で行う（復習画面は Q番号がスクランブル＝SPA残骸で誤読される
    // ため qnum 基準は不可）。さらに問題文だけだとフィナーレのバナーが questionText に化けて別問題が
    // 衝突するため、選択肢集合も含めて厳密化する（questionSig）。両方空なら qnum へフォールバック。
    const sig = questionSig(s.questionText, s.options) || s.qnum || "";
    if (!sig) { log("問題を取得できませんでした。終了します。"); break; }
    // 自己訂正のため「再提示＝即終了」はしない。正解を学習できず周回する場合のみ試行回数で打ち切る。
    if ((attempts.get(sig) || 0) >= MAX_ATTEMPTS) {
      log(`同じ問題（${s.qnum || "?"}）を${attempts.get(sig)}回試しても通過できず停止します。`);
      break;
    }
    seen.add(sig);

    const hit = lookup(index, s.questionText);
    const kindLabel = s.isMatching ? "[線結び]" : s.isOrdering ? "[並べ替え]" : s.isCloze ? "[穴埋め]" : "[選択]";

    let corr = corrections.get(sig);
    // 取り違えガード: 学習済み正解が現在の選択肢に実在しなければ別問題のもの → 破棄して通常経路へ。
    // （sig 厳密化で衝突はほぼ消えるが、万一の取りこぼしでも誤った正解を force-apply してスタックしない）。
    if (corr && !s.isMatching && !s.isOrdering && !correctionApplies(corr, s.options)) {
      log(`     （学習済み正解「${corr.text ?? (corr.seq || []).join("/")}」は現在の選択肢に無い→別問題と判断し破棄）`);
      corrections.delete(sig);
      corr = null;
    }
    // このイテレーションで穴埋めに使った順序キー（不正解時に記憶するため）。
    let triedClozeKey = null;
    if (!s.answered && s.isCloze) {
      // --- 穴埋め: 候補順序をランク生成し“未試行”の候補で埋める。不正解だった順序は記憶して二度と出さない ---
      // 集合が合っていれば順序違い(K!通り)を尽くして必ず正答へ収束＝初回導出が外れても6回ループ停止しない。
      // 学習済み正解（フィードバック由来。単一空欄で有効）があれば最優先候補にする。
      const learned = corr ? (corr.seq?.length ? corr.seq : corr.text ? [corr.text] : null) : null;
      const cands = buildClozeCandidates(hit?.expl || "", s.options, s.clozeBlanks, learned);
      const tried = clozeTried.get(sig) || new Set();
      const pick = cands.find((c) => !tried.has(c.join("¦")));
      if (pick && s.clozeBlanks > 0) {
        triedClozeKey = pick.join("¦");
        const nth = tried.size + 1;
        if (nth === 1) {
          known += 1;
          log(`[${s.qnum}]${kindLabel} 既知 → 空欄${s.clozeBlanks}個を「${pick.join(" → ")}」で埋める`);
        } else {
          corrected += 1;
          log(`[${s.qnum}]${kindLabel} 再挑戦(${nth}) → 別の順序「${pick.join(" → ")}」で埋め直す`);
        }
        await answerCloze(page, pick, s.clozeBlanks);
      } else {
        // 候補を出し尽くした（順序を全通り試して全滅＝充填集合が誤り等）→ 報告し best effort 前進（MAX_ATTEMPTSで停止）。
        unknownList.push(s.qnum);
        log(`\n  ⚠ 穴埋めの全候補が不正解: ${s.qnum}（空欄${s.clozeBlanks} / 候補${cands.length}件を試行済）`);
        log(`     問題: ${s.questionText}`);
        log(`     選択肢: ${JSON.stringify(s.options)}`);
        if (!auto && waitForGo) await waitForGo("     → 確認したら Enter で再開（先頭から埋めて前進します）… ");
        else log("     （止めずに先頭から埋めて前進）");
        await answerCloze(page, [], s.clozeBlanks || s.options.length);
      }
    } else if (!s.answered && corr) {
      // --- 自己訂正（線結び/並べ替え/選択）: 前回の不正解後にフィードバックから読んだ正解で答え直す ---
      corrected += 1;
      const corrLabel = corr.text ?? (corr.pairs?.length ? corr.pairs.map((p) => `${p.left}→${p.right}`).join(" / ") : (corr.seq || []).join(" / "));
      log(`[${s.qnum}]${kindLabel} 自己訂正 → 学習済み正解「${corrLabel}」で再回答`);
      if (s.isMatching) await answerMatching(page, s, corr.pairs?.length ? corr.pairs : (hit?.pairs ?? []));
      else if (s.isOrdering) await answerOrdering(page, s, corr.seq?.length ? corr.seq : (hit?.order ?? []), log);
      else await answerChoice(page, { correctText: corr.text ?? null, index: 0, log });
    } else if (!s.answered) {
      if (s.isMatching) {
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
        await answerOrdering(page, s, order, log);
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
      // 穴埋め: いま試した順序を「不正解」と記憶（次回は buildClozeCandidates の未試行候補が選ばれる）。
      if (s.isCloze && triedClozeKey) {
        const set = clozeTried.get(sig) || new Set();
        set.add(triedClozeKey);
        clozeTried.set(sig, set);
        log(`     ✎ この順序は不正解と記憶（次回は別の順序を試す）`);
      }
      // 不正解 → 回答後フィードバックの緑枠から正解を読み取り、再提示に備えて記録（自己訂正リプレイ）。
      // 診断DOMは「フィードバック直後・他操作の前」に同期で確保する（遷移フラッシュでホームを撮る racy 防止）。
      let wrongHtml = null;
      try { wrongHtml = await page.content(); } catch {}
      // 並べ替えは緑枠1セルでは復元できないが、フィードバックの「A→B→C の順です」から正解順を学習できる。
      if (s.isOrdering) {
        const fbText = await page
          .evaluate(() => {
            const el = document.querySelector('[data-testid="quiz-feedback"]');
            return (el ? el.innerText : document.body.innerText) || "";
          })
          .catch(() => "");
        // 「正しい順番」番号リストは quiz-feedback の外（回答エリア側）に出るためページ全文も読む。
        const pageText = await page.evaluate(() => document.body.innerText || "").catch(() => "");
        let seq = extractOrderFromCorrectListText(pageText);
        if (seq.length < 2) seq = extractOrderFromFeedbackText(fbText);
        if (seq.length >= 2) {
          corrections.set(sig, { seq });
          log(`     ✎ 正解順を学習: 「${seq.join(" → ")}」（フィードバックの正解表示から・再提示で答え直す）`);
        } else {
          if (wrongHtml) { try { fs.writeFileSync(path.join(dumpDir, `drill-dump.review-wrong-${(s.qnum || "x")}.html`), wrongHtml, "utf-8"); } catch {} }
          log(`     ⚠ 不正解だが正解順を読み取れず（診断DOM保存: review-wrong-${s.qnum || "x"}.html）。`);
        }
      } else if (s.isMatching) {
        // 線結びは緑枠1セルでは復元できないが、誤答フィードバックの「正しい組み合わせ」一覧から正解ペアを学習できる。
        const pairs = await readPairsFromFeedback(page, s);
        if (pairs.length >= 2) {
          corrections.set(sig, { pairs });
          log(`     ✎ 正解ペアを学習: 「${pairs.map((p) => `${p.left}→${p.right}`).join(" / ")}」（再提示されたらこれで答え直す）`);
        } else {
          if (wrongHtml) { try { fs.writeFileSync(path.join(dumpDir, `drill-dump.review-wrong-${(s.qnum || "x")}.html`), wrongHtml, "utf-8"); } catch {} }
          log(`     ⚠ 不正解だが「正しい組み合わせ」を読み取れず（診断DOM保存: review-wrong-${s.qnum || "x"}.html）。`);
        }
      } else {
        const learned = await readCorrectFromFeedback(page, s);
        if (learned && (learned.text || learned.seq?.length)) {
          corrections.set(sig, learned);
          log(`     ✎ 正解を学習: 「${learned.text ?? learned.seq.join(" / ")}」（再提示されたらこれで答え直す）`);
        } else {
          if (wrongHtml) { try { fs.writeFileSync(path.join(dumpDir, `drill-dump.review-wrong-${(s.qnum || "x")}.html`), wrongHtml, "utf-8"); } catch {} }
          log(`     ⚠ 不正解だが緑枠から正解を読み取れず（診断DOM保存: review-wrong-${s.qnum || "x"}.html）。`);
        }
      }
    }

    // 次へ進む。通常問は「次の問題へ」だが、最終問は結果/完了画面へ進む別ラベルのことがある。
    const advanceLabels = ["次の問題へ", "結果を見る", "結果へ", "スコアを見る", "次へ", "終了する", "終了", "完了する", "レッスンを終える"];
    let clicked = null;
    for (const lab of advanceLabels) {
      const txt = page.getByText(lab, { exact: true });
      if ((await txt.count().catch(() => 0)) === 0) continue;
      // React Native Web: ラベルはテキストdiv（css-146c3p1）で、押せる実体は祖先の [tabindex="0"]
      //   （r-1loqt21=touchable）。内側テキストへの通常クリックは、最終問の「正解！」フィードバック層に
      //   覆われて遷移しないことがある（現代Web開発入門 L1 Q6=穴埋め最終問で「結果を見る」が効かず
      //   quiz-answer-option が残存→同じQを6回再回答してループ停止を実証）。→ 祖先 touchable を
      //   force クリックして覆いを貫く（[[next-course-tile-needs-force-click]] と同じ対策）。
      const touch = txt.first().locator('xpath=ancestor-or-self::*[@tabindex="0"][1]');
      if (!(await clickFirstVisible(touch, { force: true }))) {
        await txt.first().click({ force: true }).catch(() => {});
      }
      clicked = lab;
      break;
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

// 可視要素だけを DOM 順に試し、最初に押せたものをクリックする。
// ★SPAがホーム画面をDOMに残すため、.first()/getByText は隠し要素に当たる（[[matching-import-is-1to1-positional]]
//   と同根の罠）。可視判定でこれを除外する。opts は click に渡す（force/position など）。
async function clickFirstVisible(loc, opts = {}) {
  const n = await loc.count().catch(() => 0);
  for (let i = 0; i < n; i++) {
    const el = loc.nth(i);
    if (await el.isVisible().catch(() => false)) { await el.click({ timeout: 5000, ...opts }).catch(() => {}); return true; }
  }
  return false;
}

// コース最終レッスンの「レッスン完了!」画面から、次コースの Lesson1 Q1 まで自動で入る。
// 実機記録(2026-06-28k／drill-inspect-handoff.mjs)で確定した経路:
//   ①「コース完了を見る」→ ②「次のコースへ」→ ③ シリーズのコース一覧で“STARTバッジ付き次コース”
//   タイルの再生ボタン → ④ コース紹介で「Lesson 1」の番号ボタン → ⑤ Q1。
// ★罠: タイル/レッスン行の“中央”は裏に残ったホーム画面の隠し要素に覆われ、Playwright の center クリックが
//   弾かれる。実機では各タイル内の小さい丸ボタン(.rounded-full / 番号バッジ)＝中央を外した縁だけが効く。
//   よって丸ボタンを直接クリックし、無ければ縁寄り座標で force クリックする。
// 戻り値: 次コースの解答ボタン(Q1)を検出できたら true。
// Git完全マスターシリーズの各コース Lesson1 名（マップ横断のタイル特定用）。
// drill-dump.nextcourse-step2-list（2026-06-30b 実データ）から確定。コース順は lib/courseOrder.ts と一致。
//   1 Git概念マスターコース→Git世界一周ツアー / 2 Git個人開発入門コース→ソロ開発体験ツアー /
//   3 GitHubクラウド連携→クラウド連携体験ツアー / 4 ブランチ戦略コース→ブランチ体験ツアー /
//   5 チーム開発コース→チーム開発体験ツアー / 6 Gitトラブルシューティング→トラブルシューティングツアー /
//   7 Git開発フロー実践→開発フローツアー / 8 Git免許皆伝→なぜの旅
export const GIT_SERIES_FIRST_LESSONS = [
  "Git世界一周ツアー", "ソロ開発体験ツアー", "クラウド連携体験ツアー", "ブランチ体験ツアー",
  "チーム開発体験ツアー", "トラブルシューティングツアー", "開発フローツアー", "なぜの旅",
];

// Git系1本道マップ専用の横断ナビ。
// 全コース全レッスンが1枚の縦長マップに button[aria-label="○○（Lesson N）"]（解錠）/
// [aria-label="○○（ロック中）"]（ロック）として一度に描画される（スクロールはビューポート移動のみ・
// HTMLは不変＝step2-list 実データで確定）。
// ★重要（2026-06-30c→d で訂正）: 最終レッスン完了直後は「レッスン完了!」オーバーレイが前面にあり、その裏に
//   マップ（タイル）が DOM として残っている（step0-finale 実データで確認＝表示は「コース完了を見る/もう一度/
//   ホームに戻る」）。よってタイルが DOM に居ても“覆われて”いて押せない。Git系も Web系と同じ2段階の完了フロー
//   「コース完了を見る」→（次画面で）「次のコースへ」を踏んでオーバーレイを閉じてからマップが操作可能になる。
// コース完了で次コースの L1 が解錠され「（Lesson 1）」ボタンになる。完了済みコースの L1 も同じボタンの
// まま残るが、それらより必ず DOM 後方に出る＝最後尾の「（Lesson 1）」ボタンがフロンティア＝次コース L1。
// nextLessonName を渡せば aria-label で厳密に特定する（ダブルレンダー対策＝より安全）。無ければ最後尾を使う。
// 戻り値: 次コースの Q1（quiz-answer-option）を検出できたら true。
async function tryGitMapAdvance(page, { log = console.log, nextLessonName = null } = {}) {
  const dump = async (tag) => {
    try { fs.writeFileSync(path.join(__dirname, `drill-dump.gitmap-${tag}.html`), await page.content(), "utf-8"); } catch {}
    try { await page.screenshot({ path: path.join(__dirname, `drill-dump.gitmap-${tag}.png`), fullPage: true }); } catch {}
  };
  const q1Present = async () => !!(await page.$('[data-testid^="quiz-answer-option-"]'));
  const tilesInDom = async () =>
    (await page.locator('button[aria-label*="（Lesson 1）"], [aria-label*="（ロック中）"]').count().catch(() => 0)) > 0;

  // ① 完了オーバーレイを閉じてマップを前面に出す。「コース完了を見る」→ 次画面で「次のコースへ」の2段階
  //    （いずれも tabindex=0／無ければ無害にスキップ）。各クリック後に Q1 が出たら（＝直接入った）即成功。
  for (const t of ["コース完了を見る", "次のコースへ"]) {
    if (await clickFirstVisible(page.locator('[tabindex="0"]').filter({ hasText: t }))) {
      log(`  [Git横断] 完了フロー「${t}」をクリック…`);
      await sleep(2500);
      if (await q1Present()) { log("  [Git横断] ✅ 完了フロー直後に Q1 を検出。"); return true; }
    }
  }
  await dump("after-complete");

  // ② まだマップが見えない場合の保険（閉じる/戻る系・無ければ無害）。
  if (!(await tilesInDom())) {
    for (const t of ["マップに戻る", "マップへ", "ホームに戻る", "とじる", "閉じる", "つづける", "続ける", "次へ"]) {
      await clickFirstVisible(page.locator('[tabindex="0"]').filter({ hasText: t }));
    }
    await sleep(1500);
  }
  if (!(await tilesInDom())) { log("  [Git横断] マップを検出できず（完了フローのボタン文言が未知の可能性）。"); await dump("no-map"); return false; }
  // ③ フロンティアタイルを特定して force クリック（中央は裏のホームに覆われ得るため force 必須）。
  const target = nextLessonName
    ? page.locator(`button[aria-label*="${nextLessonName}（Lesson 1）"]`)
    : page.locator('button[aria-label*="（Lesson 1）"]');
  const n = await target.count().catch(() => 0);
  if (!n) { log(`  [Git横断] 対象タイル（${nextLessonName ?? "（Lesson 1）"}）が見つからず。`); return false; }
  const tile = target.last(); // フロンティア＝最後尾
  const label = await tile.getAttribute("aria-label").catch(() => null);
  log(`  [Git横断] フロンティアタイル「${label}」を force クリック…`);
  await tile.scrollIntoViewIfNeeded().catch(() => {});
  await tile.click({ force: true }).catch(() => {});
  const ok = await page
    .waitForSelector('[data-testid^="quiz-answer-option-"]', { timeout: 25000 })
    .then(() => true)
    .catch(() => false);
  if (!ok) await dump("tile-fail");
  log(ok ? "  [Git横断] ✅ 次コース Lesson1 Q1 に到達。" : "  [Git横断] ⚠ タイルクリック後も Q1 を検出できず。");
  return ok;
}

export async function advanceToNextCourse(page, { log = console.log, nextLessonName = null } = {}) {
  // 診断採取: コース間自動ナビが外れる真因を実データで特定するためのダンプ（HTML＋フルページ画像）。
  // 失敗してもナビは続行する。
  const dumpNav = async (tag) => {
    try { fs.writeFileSync(path.join(__dirname, `drill-dump.nextcourse-${tag}.html`), await page.content(), "utf-8"); } catch {}
    try { await page.screenshot({ path: path.join(__dirname, `drill-dump.nextcourse-${tag}.png`), fullPage: true }); } catch {}
  };
  // ★step0＝最終問回答“直後”の画面（＝フィナーレ完了画面そのもの）を、何もクリックする前に採取する。
  //   Git系1本道マップはこの画面に「コース完了を見る/次のコースへ」が無く、前セッションでは取り逃していた。
  //   ここを捕まえないとGit横断ナビの実ボタン文言/タイル構造が分からない（2026-06-30b 残課題）。
  await dumpNav("step0-finale");

  // ===== Git完全マスター系（1本道マップ）の早期分岐 =====
  // マップタイル（（Lesson N）/（ロック中））が居れば Git 系。Web系の「次のコースへ/STARTタイル」は無いので
  // 先に Git 横断を試す（Web系ステップの 8回スクロール空振りや誤クリックを避ける）。
  const gitStyle =
    (await page.locator('button[aria-label*="（Lesson 1）"], [aria-label*="（ロック中）"]').count().catch(() => 0)) > 0;
  if (gitStyle || nextLessonName) {
    log("  [次コース] Git系1本道マップを検出 → マップ横断ナビ…");
    const ok = await tryGitMapAdvance(page, { log, nextLessonName });
    if (ok) return true;
    await dumpNav("step5-fail");
    // Git 検出済みで失敗した場合は Web系ステップに進んでも当たらないのでここで終了。
    if (gitStyle) return false;
  }

  // ① レッスン完了画面 → コース完了画面
  log("  [次コース①] 「コース完了を見る」…");
  await clickFirstVisible(page.locator('[tabindex="0"]').filter({ hasText: "コース完了を見る" }));
  await sleep(2500);
  // ② コース完了画面 → シリーズのコース一覧
  log("  [次コース②] 「次のコースへ」…");
  await clickFirstVisible(page.locator('[tabindex="0"]').filter({ hasText: "次のコースへ" }));
  await sleep(2500);

  // 診断採取: ②直後の画面（＝コース一覧 or 次コース紹介）を毎回ダンプする。
  await dumpNav("step2-list");

  // ③ コース一覧: STARTバッジを持つ“次コース”タイルの再生ボタン(.rounded-full)を直接クリック。
  // ★force:true が必須（実機検証2026-06-28k）。裏に残ったホーム画面が接地点を覆い、通常クリックは
  //   Playwright の「receives events」判定で弾かれてタイムアウトする。force で判定をスキップし実体へ当てる。
  // ★スクロール対応（ユーザー指摘2026-06-30）: 次コースのタイルは一覧の下方にあり、ビューポート外だと
  //   clickFirstVisible（可視のみクリック）が空振りする。可視のSTART再生ボタンが見つかるまで下へ
  //   スクロールしてからクリックする。スクロールは window と RN Web の ScrollView 双方に効くよう
  //   mouse.wheel と scrollBy の両方を撃つ。
  log("  [次コース③] コース一覧の STARTタイル（再生ボタン・force／必要なら下スクロール）…");
  const startPlay = page.locator('button[role="button"]').filter({ hasText: "START" }).locator("div.rounded-full");
  let clickedStart = false;
  for (let s = 0; s <= 8; s++) {
    if (await clickFirstVisible(startPlay, { force: true })) { clickedStart = true; break; }
    if (s < 8) {
      log(`     ↓ 可視のSTARTタイル無し → 下へスクロール（${s + 1}/8）`);
      await page.mouse.move(400, 400).catch(() => {});
      await page.mouse.wheel(0, 600).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, Math.round((window.innerHeight || 700) * 0.7))).catch(() => {});
      await sleep(700);
    }
  }
  if (!clickedStart) {
    const startTile = page.locator('button[role="button"]').filter({ hasText: "START" });
    await clickFirstVisible(startTile, { force: true, position: { x: 359, y: 36 } });
  }
  // コース紹介（レッスン一覧）の描画を待つ。
  await page.waitForFunction(() => /Lesson\s*1\b/.test(document.body.innerText || ""), { timeout: 15000 }).catch(() => {});
  await sleep(1000);
  // ④ コース紹介: 「Lesson 1」行の番号ボタン(tabindex=0)を押す → レッスンが開く。ここも同じ覆いがあるため force。
  log("  [次コース④] コース紹介の「Lesson 1」（force）…");
  const lesson1Row = page.locator("div.flex-row").filter({ hasText: "Lesson 1" });
  if (!(await clickFirstVisible(lesson1Row.locator('[tabindex="0"]'), { force: true }))) {
    await clickFirstVisible(lesson1Row, { force: true, position: { x: 100, y: 36 } });
  }
  // ⑤ Q1（解答ボタン）の出現を待つ。
  const ok = await page
    .waitForSelector('[data-testid^="quiz-answer-option-"]', { timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  log(ok ? "  [次コース⑤] ✅ Lesson1 Q1 に到達。" : "  [次コース⑤] ⚠ Q1 を検出できず。");
  // ⑤で外れたら、その時点の画面（紹介ページ等）も採取して次回の真因特定に使う。
  if (!ok) await dumpNav("step5-fail");
  return ok;
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
  // ⚠ 旧コードは左右とも findLoose のみ。品質とデプロイ L3 Q7（Core Web Vitals）で実証した真因＝
  //   保存「正しい対応」の左が「LCP（Largest Contentful Paint）」のように略語(3字)＋丸括弧の正式名注記で、
  //   実ライブ左セルは「LCP」(3字)。findLoose は <4字ガードと括弧除去後の長さ<4 で 3字略語を弾き左が全滅→
  //   「⚠ 対応づけ 0/3 → 機械接続」で位置接続→不正解→6回停止していた。
  //   → 並べ替えと同様 bestOverlapIndex（"lcp" 等のトークン一致）を左右の照合フォールバックに足し、
  //   消去法（resolveWithElimination）で 1対1 割当する（[[review-selfcorrect-from-feedback]] の線結び残課題）。
  let plan = pairs.length ? assignMatchingPairs(s.options, s.rightItems, pairs) : null;
  if (pairs.length && !plan) {
    console.log(`     ⚠ 対応づけできず（${pairs.length}ペアを左右に割当不能）→ 機械接続に退避`);
  }
  if (!plan) {
    // 機械接続（対応不明時の最終手段）: 左の全項目を接続。右が少ない多対1では右をサイクル割当て。
    const rc = Math.max(1, s.rightItems.length);
    plan = Array.from({ length: s.options.length }, (_, i) => [i, s.rightItems[i % rc]]);
  }

  // 右スロットは「ラベル重複あり・実体は1対1」のことがある（例 右=[親子, 兄弟, 兄弟] の3スロット）。
  // ⚠ 単純なテキスト一致だと同名スロットの先頭ばかり再タップし、2つ目の同名右に接続できず
  //   N/N に届かず確定が出ない→復習を突破できず停止する（HTML構造マスター Lesson3 で 2/3 で停止を実証）。
  //   そこで「同じラベルの未使用スロットを DOM 出現順に1つずつ消費」して接続する。
  const usedRight = [];
  for (const [li, rightLabel] of plan) {
    await page.click(`[data-testid="quiz-answer-option-${li}"]`, { timeout: 5000 }).catch(() => {});
    await sleep(500);
    const picked = await page.evaluate(
      ({ label, used }) => {
        const norm = (x) => (x || "").replace(/\s+/g, " ").trim();
        const leftEls = [...document.querySelectorAll('[data-testid^="quiz-answer-option-"]')];
        const leftTexts = new Set(leftEls.map((e) => norm(e.textContent)));
        let container = leftEls[0] || document.body;
        while (container && !leftEls.every((o) => container.contains(o))) container = container.parentElement;
        container = container || document.body;
        // 右項目の長さ上限は drill-dom.mjs の readState と同じ 100 に揃える（44字の実在右ラベルを
        // 40 で弾き、読取りを直しても“タップ側の複製フィルタ”が接続を落として 2/3 停止した。一気通貫の統合 L3 Q6）。
        const SKIP = new Set(["リセット", "確定", "回答する", "次の問題へ", "次へ"]);
        document.querySelectorAll("[data-import-ri]").forEach((el) => el.removeAttribute("data-import-ri"));
        let pos = 0, pickedPos = -1;
        for (const el of container.querySelectorAll("div[tabindex]:not([data-testid])")) {
          const t = norm(el.textContent);
          if (!t || t.length > 100 || leftTexts.has(t) || SKIP.has(t)) continue;
          const cur = pos++;
          if (t === label && !used.includes(cur)) { el.setAttribute("data-import-ri", "1"); pickedPos = cur; break; }
        }
        return pickedPos;
      },
      { label: rightLabel, used: usedRight }
    );
    if (picked >= 0) usedRight.push(picked);
    await page.click('[data-import-ri="1"]', { timeout: 5000 }).catch(() => {});
    await sleep(500);
  }
  await sleep(400);
  await page.click('[data-testid="quiz-submit"]', { timeout: 5000 }).catch(() => {});
  await page.getByText("確定", { exact: true }).first().click({ timeout: 3000 }).catch(() => {});
}

// 並べ替え。order（保存解説の正しい順序）があればその順にタップ。
// タップすると消えるので、毎回現在の選択肢を読み直して該当をタップ。order 無しは上から順。
// 並べ替えヒント略語と選択肢の言い換え対応（2026-07-03 実ライブ シリーズツアーL1で確定）:
// ヒント「サーバー処理/レスポンス」に対し選択肢は「サーバーが応答を準備する/HTML・CSS・JSを返す」等、
// トークンが全く重ならない言い換えがある。頻出IT用語の同義語で重なりスコアを補完する。
const ORDERING_SYNONYMS = [
  ["レスポンス", "応答", "返す", "返る", "受け取る"],
  ["リクエスト", "依頼", "要求", "送る"],
  ["処理", "準備", "用意", "作る"],
  ["表示", "描き出す", "描画", "描く", "画面"],
];

// 同義語展開つき重なりスコアで、未使用候補から一意の最良を返す（曖昧タイは -1）。
export function synonymOverlapIndex(cands, target, used = []) {
  const words = new Set();
  for (const g of ORDERING_SYNONYMS) if (g.some((w) => (target || "").includes(w))) g.forEach((w) => words.add(w));
  if (words.size === 0) return -1;
  let best = -1, bestScore = 0, second = 0;
  cands.forEach((c, j) => {
    if (used.includes(j)) return;
    let s = 0;
    for (const w of words) if (c.includes(w)) s += w.length;
    if (s > bestScore) { second = bestScore; bestScore = s; best = j; }
    else if (s > second) second = s;
  });
  return bestScore > 0 && bestScore > second ? best : -1;
}

// ヒント略語列 order → 選択肢 allTexts のタップ計画（index列）を作る純関数。
// ①消去法の一括解決（線結びで実績の resolveWithElimination）→ ②残りは同義語展開の重なりで補完。
// 解けない step は -1 のまま（タップ時に「予約外の先頭」へ退避＝他stepの計画済み選択肢を横取りしない）。
export function planOrderingTaps(allTexts, order) {
  const plan = resolveWithElimination(allTexts, order);
  for (let i = 0; i < order.length; i++) {
    if (plan[i] !== -1) continue;
    plan[i] = synonymOverlapIndex(allTexts, order[i], plan.filter((x) => x !== -1));
  }
  return plan;
}

export async function answerOrdering(page, s, order = [], log = () => {}) {
  const readOpts = async () => {
    const els = await page.$$('[data-testid^="quiz-answer-option-"]');
    const texts = [];
    for (const el of els) texts.push((((await el.textContent()) || "").replace(/\s+/g, " ").trim()));
    return { els, texts };
  };
  if (order.length) {
    // ①ラベル列→選択肢の対応を最初に「消去法＋同義語」で一括確定する（2026-07-03強化）。
    //   従来の step ごと単発マッチは、略語（「リクエスト」）が複数選択肢に含まれると曖昧タイ→
    //   先頭タップ退避で順序が壊れて自己訂正が永遠に不正解のままになる。
    const { texts: all } = await readOpts();
    const plan = planOrderingTaps(all, order);
    log(`     [並べ替え] タップ計画: ${order.map((st, i) => `「${st}」→${plan[i] === -1 ? "?" : `#${plan[i]}「${(all[plan[i]] || "").slice(0, 14)}…」`}`).join(" ")}`);
    for (let i = 0; i < order.length; i++) {
      const { els, texts } = await readOpts();
      if (els.length === 0) break;
      // 計画した選択肢を「いま画面に残っている」要素から本文一致で探す（タップで消えるUI/残るUIの両対応）。
      let idx = plan[i] !== -1 ? texts.findIndex((t) => t === all[plan[i]]) : -1;
      if (idx === -1) {
        // 未解決 step の退避: 後の step 用に計画済みの選択肢は「予約」して横取りしない
        // （tap3 が step4 の選択肢を奪って 3↔4 逆順で永遠に不正解、を実ライブで確認済み）。
        const reserved = new Set(plan.slice(i + 1).filter((x) => x !== -1).map((x) => all[x]));
        idx = texts.findIndex((t) => !reserved.has(t));
        if (idx === -1) idx = 0; // 全部予約済み＝計画不整合。先頭で前進
      }
      await els[idx].click().catch(() => {});
      await sleep(600);
      const after = await readOpts();
      log(`     [並べ替え] tap${i + 1}/${order.length}: 「${(texts[idx] || "").slice(0, 20)}」 → 残り${after.els.length}個`);
    }
    // 確定直前のDOMを毎回保存（不正解が続く場合の真因特定用・上書き）。
    try {
      fs.writeFileSync(path.join(__dirname, "drill-dump.ordering-presubmit.html"), await page.content(), "utf-8");
    } catch {}
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
