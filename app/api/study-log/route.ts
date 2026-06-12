import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import { sql, hasDatabase, ensureStudyLogTable } from "@/lib/db";

export const runtime = "nodejs";
// 引数なしの GET はビルド時に静的化され、デプロイ後もビルド時点のデータが
// 返り続けてしまうため、毎リクエスト実行を強制する
export const dynamic = "force-dynamic";

const EMPTY = { courses: [] };

// --- ローカルJSONファイル保存（DATABASE_URL が無いときのフォールバック） ---
const SAVE_PATH = path.join(os.homedir(), "Desktop", "AIドリル取込済み", "studyLog.json");

function ensureDir() {
  fs.mkdirSync(path.dirname(SAVE_PATH), { recursive: true });
}

function readFromFile() {
  if (!fs.existsSync(SAVE_PATH)) return EMPTY;
  const raw = fs.readFileSync(SAVE_PATH, "utf-8");
  return JSON.parse(raw);
}

function writeToFile(body: unknown) {
  ensureDir();
  // 一時ファイル→rename のアトミック書き込み（並行保存時の破損防止）
  const tmp = `${SAVE_PATH}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(body, null, 2), "utf-8");
  fs.renameSync(tmp, SAVE_PATH);
}

// 単語帳の手動編集（定義上書き・手動追加・用語名修正）の辞書フィールド。
// 保存は studyLog 全置換のため、複数タブ/セッションが開いていると
// 古いコピーの保存で他方の編集が消える（後勝ち）。これを防ぐため、
// 辞書フィールドだけは既存データと和集合マージする（同一キーは受信側優先）。
const GLOSSARY_MAP_KEYS = [
  "glossaryOverrides",
  "glossaryManualTerms",
  "glossaryTermRenames",
] as const;

function mergeGlossaryMaps(
  incoming: Record<string, unknown>,
  existing: Record<string, unknown>
): Record<string, unknown> {
  for (const key of GLOSSARY_MAP_KEYS) {
    const merged = {
      ...((existing?.[key] as Record<string, string>) ?? {}),
      ...((incoming?.[key] as Record<string, string>) ?? {}),
    };
    if (Object.keys(merged).length > 0) incoming[key] = merged;
  }
  return incoming;
}

// --- Neon(DB)保存（DATABASE_URL があるとき。id=1 の1行に studyLog 全体を JSON で保存） ---
async function readFromDb() {
  await ensureStudyLogTable();
  const rows = await sql!`SELECT data FROM study_log WHERE id = 1`;
  return rows.length > 0 ? rows[0].data : EMPTY;
}

async function writeToDb(body: unknown) {
  await ensureStudyLogTable();
  await sql!`
    INSERT INTO study_log (id, data)
    VALUES (1, ${JSON.stringify(body)}::jsonb)
    ON CONFLICT (id)
    DO UPDATE SET data = EXCLUDED.data, updated_at = now()
  `;
}

export async function GET() {
  try {
    const data = hasDatabase ? await readFromDb() : readFromFile();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(EMPTY);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (hasDatabase) {
      const existing = await readFromDb().catch(() => EMPTY);
      await writeToDb(mergeGlossaryMaps(body, existing));
    } else {
      let existing: Record<string, unknown> = EMPTY;
      try {
        existing = readFromFile();
      } catch {
        // 既存ファイルが壊れている場合は受信データのみで保存
      }
      writeToFile(mergeGlossaryMaps(body, existing));
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
