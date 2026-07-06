#!/usr/bin/env node
// 単語帳の振り仮名を一括統一するワンショットスクリプト（2026-07-06 要望対応）。
//
// ルール（プロンプト側の新ルールと同じ）:
//   - 漢字を含む用語   → ひらがなの振り仮名を括弧で付ける（例: 変更履歴(へんこうりれき)）
//   - 英字主体の用語   → カタカナ読みを括弧で付ける（例: HTML(エイチティーエムエル)）
//   - カタカナだけの用語 → 括弧の読みは付けない（コミット(こみっと) → コミット）
//
// 修正はすべて studyLog.glossaryTermRenames（表示層の対応表）に書く。
// 解説本文(explanation)には一切触らないので、対応表から消せば元に戻せる（可逆）。
//
// 使い方（:3000 か API_BASE のサーバー稼働が前提。保存は正規ルート＝revガード）:
//   node scripts/glossary-furigana-fix.mjs --dry   # 集計と変換サンプルだけ表示（AI呼び出しなし）
//   node scripts/glossary-furigana-fix.mjs         # AIで読みを生成 → renames保存
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

const hasKanji = (s) => /[一-龯々]/.test(s);
const isHiragana = (s) => /^[ぁ-ゖー・\s]+$/.test(s);
const isKatakana = (s) => /^[ァ-ヶー・\s]+$/.test(s);
const isKana = (s) => /^[ぁ-ゖァ-ヶー・\s]+$/.test(s);
const isAlphaMain = (s) => /^[A-Za-z0-9.\-\s_\/#+]+$/.test(s);
const kataToHira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const hiraToKata = (s) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));

// 括弧の分解（全角括弧にも対応。値の書き出しは半角括弧に統一する）
function splitParen(term) {
  const m = term.match(/^([^(（]+?)\s*[(（]([^)）]*)[)）]\s*$/);
  return m ? { head: m[1].trim(), inside: m[2].trim() } : { head: term.trim(), inside: null };
}

async function main() {
  // 1) 現在のstudyLogを正規ルートで取得（_rev込み）
  const res = await fetch(`${API_BASE}/api/study-log`);
  if (!res.ok) throw new Error(`GET /api/study-log 失敗: ${res.status}（サーバー稼働を確認）`);
  const log = await res.json();
  const rev = log._rev;

  // 2) 生の用語（rename前）を全列挙
  const rawTerms = new Set();
  for (const c of log.courses ?? [])
    for (const l of c.lessons ?? [])
      for (const q of l.questions ?? [])
        for (const t of parseGlossaryTerms(q.explanation)) rawTerms.add(t);
  for (const t of Object.keys(log.glossaryManualTerms ?? {})) rawTerms.add(t);

  const renames = { ...(log.glossaryTermRenames ?? {}) };
  const current = (raw) => renames[raw.toLowerCase()] ?? raw;

  // 3) 現表示値ごとに分類（同じ表示値の生用語はまとめて同じ修正を受ける）
  const needHira = new Map(); // head -> Set(raw)  漢字用語: ひらがな読みが必要
  const needKata = new Map(); // head -> Set(raw)  英字用語: カタカナ読みが必要
  const mechanical = new Map(); // raw -> fixed     機械変換で済むもの
  for (const raw of rawTerms) {
    const cur = current(raw);
    const { head, inside } = splitParen(cur);
    if (hasKanji(head)) {
      if (inside != null && isHiragana(inside)) {
        // 既に正しい形。全角括弧だけ半角に揃える
        const fixed = `${head}(${inside})`;
        if (fixed !== cur) mechanical.set(raw, fixed);
      } else if (inside != null && isKatakana(inside)) {
        // カタカナ読み。誤読（例: 反復(ハンタイ)）も混じるためAIで読みを引き直す
        if (!needHira.has(head)) needHira.set(head, new Set());
        needHira.get(head).add(raw);
      } else {
        // 読みなし（inside が英語表記などの場合も読みに置き換えて統一）
        if (!needHira.has(head)) needHira.set(head, new Set());
        needHira.get(head).add(raw);
      }
    } else if (isAlphaMain(head)) {
      if (inside != null && isKana(inside)) {
        const fixed = `${head}(${hiraToKata(inside)})`;
        if (fixed !== cur) mechanical.set(raw, fixed);
      } else if (inside == null) {
        if (!needKata.has(head)) needKata.set(head, new Set());
        needKata.get(head).add(raw);
      }
    } else if (isKana(head) && inside != null && isKana(inside)) {
      // カタカナ/かな用語に読み括弧 → 読みを外す（例: コミット(こみっと) → コミット）
      mechanical.set(raw, head);
    }
  }

  console.log(`生用語: ${rawTerms.size} / AI読み付与(ひらがな): ${needHira.size}語 / AI読み付与(カタカナ): ${needKata.size}語 / 機械変換: ${mechanical.size}件`);
  if (DRY) {
    console.log("機械変換サンプル:", [...mechanical.entries()].slice(0, 10));
    console.log("ひらがな対象サンプル:", [...needHira.keys()].slice(0, 15));
    console.log("カタカナ対象サンプル:", [...needKata.keys()].slice(0, 15));
    return;
  }

  // 4) バックアップ（実ファイルをそのまま複製）
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = SAVE_PATH.replace(/\.json$/, `.backup-furigana-${stamp}.json`);
  fs.copyFileSync(SAVE_PATH, backup);
  console.log(`バックアップ: ${backup}`);

  // 5) AIで読みを生成（40語ずつ・並列5）
  const client = new Anthropic({ apiKey: loadApiKey() });
  async function fetchReadings(heads, kind) {
    const want = kind === "hira" ? "ひらがな" : "カタカナ";
    const prompt = `以下はIT学習ドリルの単語帳の用語一覧です。各用語の日本語の読みを${want}で返してください。
- 読みは${want}だけで書く（長音「ー」可）。漢字・英字・記号を混ぜない
- 英字部分も読み下す（例: Git管理 → ぎっとかんり）
- 出力はJSONのみ: {"readings": [{"term": "用語", "reading": "よみ"}, ...]}
- term は入力の文字列をそのまま返す

${JSON.stringify(heads, null, 0)}`;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const msg = await client.messages.create({
          model: "claude-haiku-4-5",
          max_tokens: 4096,
          messages: [{ role: "user", content: prompt }],
        });
        const text = msg.content.find((b) => b.type === "text")?.text ?? "";
        const json = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
        const parsed = JSON.parse(json.slice(json.indexOf("{"), json.lastIndexOf("}") + 1));
        const out = new Map();
        for (const r of parsed.readings ?? []) {
          if (!r?.term || !r?.reading) continue;
          let reading = String(r.reading).trim();
          // 型ずれは機械変換で救済してから検証
          if (kind === "hira") reading = kataToHira(reading);
          else reading = hiraToKata(reading);
          const ok = kind === "hira" ? isHiragana(reading) : isKatakana(reading);
          if (ok && heads.includes(r.term)) out.set(r.term, reading);
        }
        return out;
      } catch (e) {
        if (attempt === 3) { console.warn(`チャンク失敗(${heads[0]}...):`, e.message); return new Map(); }
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
  }

  async function batchAll(map, kind) {
    const heads = [...map.keys()];
    const chunks = [];
    for (let i = 0; i < heads.length; i += 40) chunks.push(heads.slice(i, i + 40));
    const results = new Map();
    let done = 0;
    const POOL = 5;
    for (let i = 0; i < chunks.length; i += POOL) {
      const part = await Promise.all(chunks.slice(i, i + POOL).map((c) => fetchReadings(c, kind)));
      for (const m of part) for (const [k, v] of m) results.set(k, v);
      done += Math.min(POOL, chunks.length - i);
      console.log(`  ${kind}: ${done}/${chunks.length} チャンク完了（読み取得 ${results.size}/${heads.length}語）`);
    }
    return results;
  }

  console.log("AI読み生成（ひらがな）...");
  const hiraReadings = await batchAll(needHira, "hira");
  console.log("AI読み生成（カタカナ）...");
  const kataReadings = await batchAll(needKata, "kata");

  // 6) renames差分を組み立て（キーは生用語の小文字＝buildGlossaryのapplyRenameと同じ規約）
  let added = 0, skippedNoReading = [];
  const apply = (raw, fixed) => {
    if (current(raw) === fixed) return;
    renames[raw.toLowerCase()] = fixed;
    added++;
  };
  for (const [raw, fixed] of mechanical) apply(raw, fixed);
  for (const [head, raws] of needHira) {
    const reading = hiraReadings.get(head);
    if (!reading) { skippedNoReading.push(head); continue; }
    for (const raw of raws) apply(raw, `${head}(${reading})`);
  }
  for (const [head, raws] of needKata) {
    const reading = kataReadings.get(head);
    if (!reading) { skippedNoReading.push(head); continue; }
    for (const raw of raws) apply(raw, `${head}(${reading})`);
  }
  console.log(`renames追加/更新: ${added}件 / 読みが取れず見送り: ${skippedNoReading.length}語`);
  if (skippedNoReading.length) console.log("見送り:", skippedNoReading.slice(0, 20));

  // 7) 正規ルートで保存（revガード。glossaryTermRenamesは既存とマージされる＝追加的）
  const post = await fetch(`${API_BASE}/api/study-log`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...log, glossaryTermRenames: renames, _rev: rev }),
  });
  const result = await post.json();
  if (!post.ok || !result.ok) throw new Error(`保存失敗: ${JSON.stringify(result)}`);
  console.log(`保存完了 (rev: ${result.rev}, 救済マージ発動: ${result.merged})`);

  // 8) 検証: 保存後のデータで残問題を数える
  const after = await (await fetch(`${API_BASE}/api/study-log`)).json();
  const renames2 = after.glossaryTermRenames ?? {};
  let remainKanjiNoHira = 0, remainKanaParen = 0;
  const seen = new Set();
  for (const c of after.courses ?? [])
    for (const l of c.lessons ?? [])
      for (const q of l.questions ?? [])
        for (const t of parseGlossaryTerms(q.explanation)) {
          const cur = renames2[t.toLowerCase()] ?? t;
          if (seen.has(cur)) continue;
          seen.add(cur);
          const { head, inside } = splitParen(cur);
          if (hasKanji(head) && !(inside != null && isHiragana(inside))) remainKanjiNoHira++;
          if (isKana(head) && inside != null && isKana(inside)) remainKanaParen++;
        }
  console.log(`検証: 漢字用語で読み未統一の残り=${remainKanjiNoHira} / かな用語の読み括弧残り=${remainKanaParen}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
