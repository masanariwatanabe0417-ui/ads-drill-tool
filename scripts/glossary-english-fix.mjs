#!/usr/bin/env node
// 単語帳の「英字用語」統一残件を一括修正するワンショットスクリプト（2026-07-06 指摘対応）。
// glossary-furigana-fix.mjs（漢字用語の統一）の続編。前回の取りこぼし＝
//   (1) 中間括弧・二重括弧などの構造異常（例: UI(ユーアイ)デザイン / cn()(シーエヌ関数)(しーえぬかんすう)）
//   (2) 英字用語で読み括弧の中身が読みでない（例: Authentication(認証) / CTA(Call To Action)）
//   (3) 同じ英単語に読みが複数あってカードが分裂（例: API(エイピーアイ)/(エービーアイ)/(アピアイ)…）
//   (4) 英字＋かな混在で読みなし（例: .tsx ファイル / 8ptグリッド）
// を、読みを1つに正典化して renames に書く（正典読みが同じ＝dedupeKeyが揃い、分裂カードは自動統合）。
//
// 方針は前回と同じ: 修正は studyLog.glossaryTermRenames（可逆）。解説本文には触らない。
// 唯一の例外: ":path*(:パス・アスタリスク)" は読み括弧内の余計なコロンがパーサーを壊すため、
// そのコロン1文字だけ本文を外科修正する（--dry では行わない）。
//
// 使い方（:3000 サーバー稼働が前提。保存は正規ルート＝revガード）:
//   node scripts/glossary-english-fix.mjs --dry   # 対象の集計・変換予定だけ表示（AI呼び出しなし）
//   node scripts/glossary-english-fix.mjs         # Sonnetで正典読みを生成 → renames保存 → 検証
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Anthropic from "@anthropic-ai/sdk";

const DRY = process.argv.includes("--dry");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const API_BASE = process.env.API_BASE ?? "http://localhost:3000";
const SAVE_PATH = path.join(os.homedir(), "Desktop", "AIドリル取込済み", "studyLog.json");

function loadApiKey() {
  const text = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*ANTHROPIC_API_KEY\s*=\s*(.+?)\s*$/);
    if (m && !line.trim().startsWith("#")) return m[1].replace(/^["']|["']$/g, "");
  }
  throw new Error(".env.local に ANTHROPIC_API_KEY が見つかりません");
}

// ── lib/glossary.ts と同じ用語抽出 ──────────────────────────────────
function parseGlossaryTerms(explanation) {
  const out = [];
  let inSection = false;
  for (const line of (explanation ?? "").split("\n")) {
    const heading = line.match(/^\s*#{2,3}\s*(.+?)\s*$/);
    if (heading) { inSection = /用語/.test(heading[1]); continue; }
    if (!inSection) continue;
    const item = line.match(/^\s*[-*]\s*(.+?)\s*[:：]\s*(.+?)\s*$/);
    if (item && item[1].trim()) out.push(item[1].trim());
  }
  return out;
}

const hasKanji = (s) => /[一-鿿々]/.test(s);
const hasAlpha = (s) => /[A-Za-z]/.test(s);
const isKanaAny = (s) => /^[ぁ-ゖァ-ヶー・\s]+$/.test(s);
const isKataReading = (s) => /^[ァ-ヶー・]+$/.test(s); // 正典読み: カタカナ＋ー・のみ（スペース不可）
const hiraToKata = (s) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));

// 末尾括弧で head / inside に分解（全角括弧対応）
function splitTail(term) {
  const m = term.match(/^(.*?)\s*[(（]([^)（）()]*)[)）]\s*$/);
  return m ? { head: m[1].trim(), inside: m[2].trim() } : { head: term.trim(), inside: null };
}

// 用語表記の機械正規化:
//   - ゼロ幅文字を除去
//   - 中間のかな読み括弧を除去（UI(ユーアイ)デザイン → UIデザイン）
//   - 英字⇔かな/漢字の境界スペースを詰める（Web アプリ → Webアプリ / セッション ID → セッションID）
function normalizeTerm(term) {
  let t = term.replace(/[​‌‍﻿]/g, "").trim();
  // 中間かな括弧の除去（後ろに本体の続きがあるものだけ。末尾の読み括弧は残す）
  for (let i = 0; i < 3; i++) {
    const m = t.match(/^(.+?)[(（]([ぁ-ゖァ-ヶー・\s]+)[)）](.+)$/);
    if (!m) break;
    t = (m[1] + m[3]).trim();
  }
  // 境界スペースを詰める
  t = t.replace(/([A-Za-z0-9])\s+([ァ-ヶーぁ-ゖ一-鿿々])/g, "$1$2");
  t = t.replace(/([ァ-ヶーぁ-ゖ一-鿿々])\s+([A-Za-z0-9])/g, "$1$2");
  // 末尾のかな読み括弧の中のスペースを詰める（例: (フォーオーフォー エラー) → (フォーオーフォーエラー)）
  t = t.replace(/[(（]([ぁ-ゖァ-ヶー・\s]+)[)）]\s*$/, (_, ins) => `(${ins.replace(/\s+/g, "")})`);
  return t;
}

// 機械正規化で救えない特殊表記の正典対応表（現表示 → 正典）。
// 正典が「読みなし」で確定のものはそのまま、AI読みが要るものは末尾括弧なしで書き、後段でAI読みを付ける。
const MANUAL = new Map([
  ["UIユーアイ)", "UI"],
  ["UIユーザーインターフェース)", "UI"],
  ["UIユーザーインターフェース", "UI"],
  ["UI(ユーアイ)／ユーザーインターフェース", "UI"],
  ["UX(ユーエックス)／ユーザーエクスペリエンス", "UX"],
  ["PR(ピーアール)=プルリクエスト", "PR"],
  ["PR(ピーアール)・プルリクエスト", "PR"],
  ["PR(ピーアール、プルリクエスト)", "PR"],
  ["pixel(ピクセル)・px", "px"],
  ["JavaScriptジャバスクリプト", "JavaScript"],
  ["Reactリアクト", "React"],
  ["App Store(アップストア)・Google Play(グーグルプレイ)", "App Store・Google Play"],
  ["Neon(ネオン)・Supabase(スーパーベース)", "Neon・Supabase"],
  ["Material Design(マテリアルデザイン)3", "Material Design 3"],
  ["cn()(シーエヌ)", "cn関数(しーえぬかんすう)"],
  ["cn()（シーエヌ）", "cn関数(しーえぬかんすう)"],
  ["cn()関数(しーえぬかんすう)", "cn関数(しーえぬかんすう)"],
  ["cn()(シーエヌ関数)(しーえぬかんすう)", "cn関数(しーえぬかんすう)"],
  ["主キー(Primary Key)(しゅきーぷらいまりーきー)", "主キー(しゅきー)"],
  ["反復(Repetition)(はんぷくりぴてぃしょん)", "反復(はんぷく)"],
  ["対比(Contrast)(たいひこんとらすと)", "対比(たいひ)"],
  ["見出し(h1)(みだしえいちわん)", "h1見出し(えいちわんみだし)"],
  ["段落(p)(だんらくぴー)", "p段落(ぴーだんらく)"],
  ["h1見出し", "h1見出し(えいちわんみだし)"],
  ["p段落", "p段落(ぴーだんらく)"],
  ["ドット(.)記号(どっときごう)", "ドット記号(どっときごう)"],
  ["ドット(.)(ドット)", "ドット"],
  ["データベース(DB(ディービー))", "データベース(DB)"],
  ["秘密の鍵(API Keyなど)(ひみつのかぎえーぴーあいきーなど)", "秘密の鍵(ひみつのかぎ)"],
  ["セッション(セッション) ID", "セッションID"],
  ["スクリプト(スクリプト)タグ", "スクリプトタグ"],
  ["ステージingエリア", "ステージングエリア"],
  ["WCAGAA基準(だぶりゅーしーえーじーえーえーきじゅん)", "WCAG AA基準(だぶりゅーしーえーじーえーえーきじゅん)"],
  [".env(.エンブ)ファイル", ".envファイル"],
  ["pnpm(ピーエヌピーエム)install", "pnpm install"],
  ["API・キー(APIキー)", "APIキー"],
  ["ブランチ別 URL(べつ)", "ブランチ別URL(ぶらんちべつゆーあーるえる)"],
  // 読みが割れた語の正典読みを明示固定（略語は文字読み・「.」はドット・慣用読み優先）
  ["HTMLファイル(エイチティーエムエル)", "HTMLファイル(エイチティーエムエルファイル)"],
  ["layout.tsx(レイアウト・ティーエスエックス)", "layout.tsx(レイアウトドットティーエスエックス)"],
  ["DBアクセス(データベースアクセス)", "DBアクセス(ディービーアクセス)"],
  ["Radix UI(レイディックスユーアイ)", "Radix UI(ラディックスユーアイ)"],
  ["DATABASE_URL(データベースアンダースコアユーアールエル)", "DATABASE_URL(データベースユーアールエル)"],
  ["DATABASE_URL(データベース・ユーアールエル)", "DATABASE_URL(データベースユーアールエル)"],
  ["DBエンジン(データベースエンジン)", "DBエンジン(ディービーエンジン)"],
  ["use〜(ユースプレフィックス)", "use〜(ユース)"],
]);

async function main() {
  // 1) 現在のstudyLogを正規ルートで取得（_rev込み）
  const res = await fetch(`${API_BASE}/api/study-log`);
  if (!res.ok) throw new Error(`GET /api/study-log 失敗: ${res.status}（サーバー稼働を確認）`);
  const log = await res.json();
  const rev = log._rev;

  // 2) 生の用語を全列挙し、現表示値ごとに raw を束ねる
  const rawTerms = new Set();
  for (const c of log.courses ?? [])
    for (const l of c.lessons ?? [])
      for (const q of l.questions ?? [])
        for (const t of parseGlossaryTerms(q.explanation)) rawTerms.add(t);
  for (const t of Object.keys(log.glossaryManualTerms ?? {})) rawTerms.add(t);

  const renames = { ...(log.glossaryTermRenames ?? {}) };
  const current = (raw) => renames[raw.toLowerCase()] ?? raw;

  // 3) 対象の洗い出し
  //    needReading: 読み直しが必要な head -> Set(raw)（読みはAIで1つに正典化）
  //    fixedDirect: raw -> 正典（読み確定・AI不要）
  const needReading = new Map(); // headキーは正規化後
  const fixedDirect = new Map();
  const alphaCandidates = new Map(); // head -> {raws, anyBad} 英字用語のhead単位判定用
  const unresolved = [];
  const addNeed = (head, raw) => {
    if (!needReading.has(head)) needReading.set(head, new Set());
    needReading.get(head).add(raw);
  };

  // 同一head（大文字小文字違い含む）の全variantの読みを集めておき、衝突判定に使う
  const readingsByHead = new Map(); // lower(head) -> Set(正規化読み)
  const entries = []; // {raw, cur}
  for (const raw of rawTerms) {
    const cur = current(raw);
    entries.push({ raw, cur });
    const norm = normalizeTerm(MANUAL.get(cur) ?? cur);
    const { head, inside } = splitTail(norm);
    if (inside != null && isKanaAny(inside)) {
      const key = head.toLowerCase();
      if (!readingsByHead.has(key)) readingsByHead.set(key, new Set());
      readingsByHead.get(key).add(hiraToKata(inside).replace(/[・\s]/g, ""));
    }
  }

  for (const { raw, cur } of entries) {
    const manual = MANUAL.get(cur);
    const norm = normalizeTerm(manual ?? cur);
    const { head, inside } = splitTail(norm);
    const opens = (norm.match(/[(（]/g) ?? []).length;
    const closes = (norm.match(/[)）]/g) ?? []).length;

    if (opens !== closes || /[()（）]/.test(head)) {
      // 機械正規化でも括弧構造が直らない → 手動表の追加が必要（今回は :path*( のみ想定＝本文側で修正）
      if (!cur.startsWith(":path*")) unresolved.push(cur);
      continue;
    }

    if (manual != null) {
      // 手動表の正典。読み括弧付き or 読み不要ならそのまま、英字を含み読みなしならAIへ
      if (inside == null && hasAlpha(head) && !hasKanji(head)) addNeed(head, raw);
      else if (norm !== cur || current(raw) !== norm) fixedDirect.set(raw, norm);
      continue;
    }

    if (hasKanji(head)) {
      // 漢字混じりは前回の規約（ひらがな読み）が正。今回対象外。
      // ただし機械正規化（中間括弧除去・スペース詰め）で表記が変わったものは反映する
      if (norm !== cur) fixedDirect.set(raw, norm);
      continue;
    }
    if (!hasAlpha(head)) {
      // 英字を含まない（かな用語）。正規化差分だけ反映
      if (norm !== cur) fixedDirect.set(raw, norm);
      continue;
    }

    // 英字を含む（漢字なし）用語: 読みが「カタカナのみ」かつ「headに読みが1種類」なら正常。
    // まずは候補として積み、後段で head 単位に判定する（正常な変種だけ残すと読みが割れるため、
    // 直しが必要な head はその全変種をまとめて正典読みへ寄せる）
    const key = head.toLowerCase();
    const readingSet = readingsByHead.get(key) ?? new Set();
    const insideOk = inside != null && isKataReading(hiraToKata(inside).replace(/[\s]/g, "")) && !/\s/.test(inside);
    const bad = !(insideOk && readingSet.size <= 1 && norm === cur);
    if (!alphaCandidates.has(head)) alphaCandidates.set(head, { raws: new Set(), anyBad: false });
    const cand = alphaCandidates.get(head);
    cand.raws.add(raw);
    if (bad) cand.anyBad = true;
  }
  // head単位の最終判定: 1つでも直しが要る head は全変種を読み直し対象へ
  for (const [head, cand] of alphaCandidates) {
    if (!cand.anyBad) continue;
    for (const raw of cand.raws) addNeed(head, raw);
  }

  console.log(`生用語: ${rawTerms.size} / AI正典読み対象: ${needReading.size}語(head) / 機械・手動確定: ${fixedDirect.size}件 / 未解決: ${unresolved.length}`);
  if (unresolved.length) console.log("未解決（手動表に追加要）:", unresolved.slice(0, 20));
  if (DRY) {
    console.log("\n[機械・手動確定サンプル]");
    for (const [raw, fixed] of [...fixedDirect.entries()].slice(0, 25)) console.log(`  ${JSON.stringify(raw)} -> ${JSON.stringify(fixed)}`);
    console.log("\n[AI読み対象head（全件）]");
    console.log([...needReading.keys()].join(" / "));
    return;
  }

  // 4) バックアップ
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = SAVE_PATH.replace(/\.json$/, `.backup-english-${stamp}.json`);
  fs.copyFileSync(SAVE_PATH, backup);
  console.log(`バックアップ: ${backup}`);

  // 5) Sonnetで正典読みを生成（大文字小文字違いは同じ読みに揃える）
  const client = new Anthropic({ apiKey: loadApiKey() });
  async function fetchReadings(heads) {
    const prompt = `以下はIT学習ドリルの単語帳の用語一覧です。各用語の標準的なカタカナ読みを1つずつ返してください。
ルール:
- 読みはカタカナ・長音「ー」・中黒「・」だけで書く。スペース・漢字・英字・数字は使わない
- 英字部分も読み下す（例: Changesパネル → チェンジズパネル / HTMLタグ → エイチティーエムエルタグ)
- 略語はアルファベットの文字読みが基本（API → エーピーアイ / URL → ユーアールエル / ID → アイディー）
- 慣用読みが定着している固有名詞はそれに従う（Google → グーグル / Chrome → クローム / Vercel → ヴァーセル / Next.js → ネクストジェイエス）
- 先頭や途中の「.」は「ドット」と読む（.env → ドットエンブ / package.json → パッケージドットジェイソン）
- 「/」「＋」「-」などの記号は自然に読み下すか区切りの「・」にする（HTML/CSS/JS → エイチティーエムエル・シーエスエス・ジェイエス）
- 数字も読み下す（Material Design 3 → マテリアルデザインスリー / WCAG 2.2 → ダブリューシーエージーニーテンニー）
- 出力はJSONのみ: {"readings": [{"term": "用語", "reading": "ヨミ"}, ...]}
- term は入力の文字列をそのまま返す

${JSON.stringify(heads, null, 0)}`;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const msg = await client.messages.create({
          model: "claude-sonnet-5",
          max_tokens: 8192,
          messages: [{ role: "user", content: prompt }],
        });
        const text = msg.content.find((b) => b.type === "text")?.text ?? "";
        const json = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
        const parsed = JSON.parse(json.slice(json.indexOf("{"), json.lastIndexOf("}") + 1));
        const out = new Map();
        for (const r of parsed.readings ?? []) {
          if (!r?.term || !r?.reading) continue;
          const reading = hiraToKata(String(r.reading).trim()).replace(/\s+/g, "");
          if (isKataReading(reading) && heads.includes(r.term)) out.set(r.term, reading);
        }
        return out;
      } catch (e) {
        if (attempt === 3) { console.warn(`チャンク失敗(${heads[0]}...):`, e.message); return new Map(); }
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
  }

  const heads = [...needReading.keys()];
  const chunks = [];
  for (let i = 0; i < heads.length; i += 40) chunks.push(heads.slice(i, i + 40));
  const readings = new Map();
  const POOL = 4;
  for (let i = 0; i < chunks.length; i += POOL) {
    const part = await Promise.all(chunks.slice(i, i + POOL).map((c) => fetchReadings(c)));
    for (const m of part) for (const [k, v] of m) readings.set(k, v);
    console.log(`  読み生成: ${Math.min(i + POOL, chunks.length)}/${chunks.length} チャンク完了（${readings.size}/${heads.length}語）`);
  }
  // 大文字小文字違いのheadは同じ読みへ寄せる（例: ID と id）
  const byLower = new Map();
  for (const [h, r] of readings) {
    const key = h.toLowerCase();
    if (!byLower.has(key)) byLower.set(key, r);
  }

  // 6) renames差分
  let added = 0;
  const skipped = [];
  const apply = (raw, fixed) => {
    if (current(raw) === fixed) return;
    renames[raw.toLowerCase()] = fixed;
    added++;
  };
  for (const [raw, fixed] of fixedDirect) apply(raw, fixed);
  for (const [head, raws] of needReading) {
    const reading = readings.get(head) ?? byLower.get(head.toLowerCase());
    if (!reading) { skipped.push(head); continue; }
    for (const raw of raws) apply(raw, `${head}(${reading})`);
  }
  console.log(`renames追加/更新: ${added}件 / 読みが取れず見送り: ${skipped.length}語`);
  if (skipped.length) console.log("見送り:", skipped.slice(0, 20));

  // 7) :path* の外科修正（読み括弧内の先頭コロンがパーサーを壊しているため、その1文字だけ除去）
  let pathFixed = 0;
  for (const c of log.courses ?? [])
    for (const l of c.lessons ?? [])
      for (const q of l.questions ?? [])
        if (q.explanation?.includes(":path*(:パス・アスタリスク)")) {
          q.explanation = q.explanation.replaceAll(":path*(:パス・アスタリスク)", ":path*(パス・アスタリスク)");
          pathFixed++;
        }
  delete renames[":path*("]; // 旧・壊れ表記へのrenameが残っていれば無効化
  console.log(`:path* 本文修正: ${pathFixed}問`);

  // 8) 正規ルートで保存（revガード）
  const post = await fetch(`${API_BASE}/api/study-log`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...log, glossaryTermRenames: renames, _rev: rev }),
  });
  const result = await post.json();
  if (!post.ok || !result.ok) throw new Error(`保存失敗: ${JSON.stringify(result)}`);
  console.log(`保存完了 (rev: ${result.rev}, 救済マージ発動: ${result.merged})`);

  // 9) 検証: 保存後データで英字用語の残問題を数える
  const after = await (await fetch(`${API_BASE}/api/study-log`)).json();
  const renames2 = after.glossaryTermRenames ?? {};
  const seen = new Set();
  const readCheck = new Map();
  let violations = 0, structural = 0;
  const badExamples = [];
  for (const c of after.courses ?? [])
    for (const l of c.lessons ?? [])
      for (const q of l.questions ?? [])
        for (const t of parseGlossaryTerms(q.explanation)) {
          const cur = renames2[t.toLowerCase()] ?? t;
          if (seen.has(cur)) continue;
          seen.add(cur);
          const { head, inside } = splitTail(cur);
          const opens = (cur.match(/[(（]/g) ?? []).length, closes = (cur.match(/[)）]/g) ?? []).length;
          if (opens !== closes || /[()（）]/.test(head)) {
            if (!/^cn/.test(head)) { structural++; badExamples.push(cur); continue; }
          }
          if (hasKanji(head) || !hasAlpha(head)) continue;
          if (inside == null || !isKataReading(hiraToKata(inside))) { violations++; badExamples.push(cur); continue; }
          const key = head.toLowerCase();
          const r = hiraToKata(inside).replace(/[・\s]/g, "");
          if (readCheck.has(key) && readCheck.get(key) !== r) { violations++; badExamples.push(cur); }
          else readCheck.set(key, r);
        }
  console.log(`検証: 構造異常=${structural} / 英字用語の読み違反・衝突=${violations}`);
  if (badExamples.length) console.log("残り例:", badExamples.slice(0, 20));
}

main().catch((e) => { console.error(e); process.exit(1); });
