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

// --- リビジョン（全置換保存の「後勝ち消失」対策） ---
// /api/study-log の POST は studyLog 全置換のため、古いコピーを持つタブの保存が
// 取り込み等の別書き込みを丸ごと消す事故が起きる（実害: 2026-07-02 取込50問消失）。
// 「クライアントが読み込んだ時点」から別の書き込みが挟まったかを版印で検出する。
// ファイル保存は mtime、DB保存は updated_at をそのまま版印として使う。
export async function readStudyLogRev(): Promise<string> {
  try {
    if (hasDatabase) {
      await ensureStudyLogTable();
      const rows = await sql!`SELECT updated_at FROM study_log WHERE id = 1`;
      return rows.length > 0 ? String(rows[0].updated_at) : "0";
    }
    return fs.existsSync(SAVE_PATH) ? String(fs.statSync(SAVE_PATH).mtimeMs) : "0";
  } catch {
    return "0";
  }
}

// rev 不一致（＝クライアント読込後に取込等の別書き込みがあった）時の救済マージ。
// incoming（クライアントの studyLog）に無いコース/レッスン/問題が existing（サーバー現在値）に
// あれば補完する。両方にあるものは incoming 優先（ユーザーの編集を尊重）。
// rev が一致する通常保存は従来どおり全置換＝削除・改名もそのまま通る。
export function mergeMissingQuestions(incoming: StudyLog, existing: StudyLog): StudyLog {
  const out: StudyLog = {
    ...incoming,
    courses: (incoming.courses ?? []).map((c) => ({
      ...c,
      lessons: c.lessons.map((l) => ({ ...l, questions: [...l.questions] })),
    })),
  };
  for (const ec of existing.courses ?? []) {
    const oc = out.courses.find((c) => c.courseKey === ec.courseKey);
    if (!oc) {
      out.courses.push(ec);
      continue;
    }
    for (const el of ec.lessons) {
      const ol = oc.lessons.find((l) => l.lessonName === el.lessonName);
      if (!ol) {
        oc.lessons.push(el);
        continue;
      }
      for (const eq of el.questions) {
        if (!ol.questions.some((q) => q.questionInfo === eq.questionInfo)) {
          ol.questions.push(eq);
        }
      }
    }
  }
  return out;
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
