import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import { sql, hasDatabase, ensureStudyLogTable } from "@/lib/db";

export const runtime = "nodejs";

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
  fs.writeFileSync(SAVE_PATH, JSON.stringify(body, null, 2), "utf-8");
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
      await writeToDb(body);
    } else {
      writeToFile(body);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
