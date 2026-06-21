import fs from "fs";
import path from "path";
import os from "os";
import { sql, hasDatabase, ensureStudyLogTable } from "./db";
import type { StudyLog } from "./types";

// studyLog の永続化（読み書き）を一箇所に集約する。
// /api/study-log（画面の全置換保存）と /api/import-question（1問マージ保存）の
// 双方がここを使うことで、保存実装が分岐して片方がデータを壊す事故を防ぐ。

export const EMPTY: StudyLog = { courses: [] };

// --- ローカルJSONファイル保存（DATABASE_URL が無いときのフォールバック） ---
const SAVE_PATH = path.join(os.homedir(), "Desktop", "AIドリル取込済み", "studyLog.json");

function ensureDir() {
  fs.mkdirSync(path.dirname(SAVE_PATH), { recursive: true });
}

export function readFromFile(): StudyLog {
  if (!fs.existsSync(SAVE_PATH)) return EMPTY;
  const raw = fs.readFileSync(SAVE_PATH, "utf-8");
  return JSON.parse(raw);
}

export function writeToFile(body: unknown) {
  ensureDir();
  // 一時ファイル→rename のアトミック書き込み（並行保存時の破損防止）
  const tmp = `${SAVE_PATH}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(body, null, 2), "utf-8");
  fs.renameSync(tmp, SAVE_PATH);
}

// --- Neon(DB)保存（DATABASE_URL があるとき。id=1 の1行に studyLog 全体を JSON で保存） ---
export async function readFromDb(): Promise<StudyLog> {
  await ensureStudyLogTable();
  const rows = await sql!`SELECT data FROM study_log WHERE id = 1`;
  return rows.length > 0 ? rows[0].data : EMPTY;
}

export async function writeToDb(body: unknown) {
  await ensureStudyLogTable();
  await sql!`
    INSERT INTO study_log (id, data)
    VALUES (1, ${JSON.stringify(body)}::jsonb)
    ON CONFLICT (id)
    DO UPDATE SET data = EXCLUDED.data, updated_at = now()
  `;
}

// 環境(DB/ファイル)を意識せず使えるラッパー。
export async function readStudyLog(): Promise<StudyLog> {
  try {
    return hasDatabase ? await readFromDb() : readFromFile();
  } catch {
    return EMPTY;
  }
}

export async function writeStudyLog(body: unknown) {
  if (hasDatabase) {
    await writeToDb(body);
  } else {
    writeToFile(body);
  }
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

export function mergeGlossaryMaps(
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
