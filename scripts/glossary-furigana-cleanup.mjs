#!/usr/bin/env node
// glossary-furigana-fix.mjs の後処理: 中間に読み括弧を含む複合語を
// 「頭部のかな読み括弧を除去し、語末にひらがな読み1つ」の形に整える。
// 例: 'CPU(シーピーユー)使用率(しーぴーゆーしようりつ)' → 'CPU使用率(しーぴーゆーしようりつ)'
//     '行(ぎょう)/レコード(レコード)(ぎょうれこーど)'   → '行/レコード(ぎょうれこーど)'
// 英字併記の括弧（例: マージ(merge)・見出し(h1)）は読みではないので残す。
import fs from "node:fs";

const API_BASE = process.env.API_BASE ?? "http://localhost:3000";

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

// 語末がひらがな読み括弧なら { head, reading } を返す
function splitFinalReading(cur) {
  const m = cur.match(/^(.*?)\s*[(（]([ぁ-ゖー・\s]+)[)）]\s*$/);
  return m ? { head: m[1], reading: m[2].trim() } : null;
}

const hiraToKata = (s) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));

function cleanup(cur) {
  const fin = splitFinalReading(cur);
  if (!fin) return cur;
  // 頭部からかな（ひらがな/カタカナ）だけの括弧を除去。英字併記括弧は残す
  const cleaned = fin.head
    .replace(/[(（][ぁ-ゖァ-ヶー・\s]+[)）]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  // かなだけの用語 → 読み括弧は不要
  if (/^[ぁ-ゖァ-ヶー・\s]+$/.test(cleaned)) return cleaned;
  // 漢字を含まない用語（英字主体・英字+カタカナ混在） → 読みはカタカナに統一
  const reading = /[一-龯々]/.test(cleaned) ? fin.reading : hiraToKata(fin.reading);
  return `${cleaned}(${reading})`;
}

async function main() {
  const res = await fetch(`${API_BASE}/api/study-log`);
  const log = await res.json();
  const rev = log._rev;
  const renames = { ...(log.glossaryTermRenames ?? {}) };

  const rawTerms = new Set();
  for (const c of log.courses ?? [])
    for (const l of c.lessons ?? [])
      for (const q of l.questions ?? [])
        for (const t of parseGlossaryTerms(q.explanation)) rawTerms.add(t);
  for (const t of Object.keys(log.glossaryManualTerms ?? {})) rawTerms.add(t);

  let changed = 0;
  const samples = [];
  for (const raw of rawTerms) {
    const cur = renames[raw.toLowerCase()] ?? raw;
    const fixed = cleanup(cur);
    if (fixed !== cur) {
      renames[raw.toLowerCase()] = fixed;
      changed++;
      if (samples.length < 15) samples.push([cur, fixed]);
    }
  }
  console.log(`整形対象: ${changed}件`);
  console.log(samples);
  if (changed === 0 || process.argv.includes("--dry")) return;

  const post = await fetch(`${API_BASE}/api/study-log`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...log, glossaryTermRenames: renames, _rev: rev }),
  });
  const result = await post.json();
  if (!post.ok || !result.ok) throw new Error(`保存失敗: ${JSON.stringify(result)}`);
  console.log(`保存完了 (rev: ${result.rev}, 救済マージ発動: ${result.merged})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
