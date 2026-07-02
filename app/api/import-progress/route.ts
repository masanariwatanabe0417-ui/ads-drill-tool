import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 取込スクリプト（scripts/drill-import.mjs → progress-report.mjs）が書く進捗ファイルを返す。
// ScreenshotPane の進捗モニターが数秒おきにポーリングする。
const PROGRESS_FILE = path.join(process.cwd(), ".import-progress.json");

export async function GET() {
  try {
    if (!fs.existsSync(PROGRESS_FILE)) {
      return NextResponse.json({ exists: false });
    }
    const stat = fs.statSync(PROGRESS_FILE);
    const data = JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf-8"));
    return NextResponse.json({ exists: true, mtimeMs: stat.mtimeMs, data });
  } catch {
    return NextResponse.json({ exists: false });
  }
}
