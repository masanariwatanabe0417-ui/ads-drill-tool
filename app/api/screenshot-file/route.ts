import { type NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

export const runtime = "nodejs";

const DESKTOP_PATH = path.join(os.homedir(), "Desktop");

// 役割（スロット）→ 日本語ラベル
const SLOT_LABELS: Record<string, string> = {
  courseMap: "コースマップ",
  question: "問題",
  answer: "解答",
};

// ローカル時刻で YYYYMMDD-HHMMSS
function localStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(
    d.getHours()
  )}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export async function GET(request: NextRequest) {
  const filePath = request.nextUrl.searchParams.get("path");
  const slot = request.nextUrl.searchParams.get("slot"); // courseMap|question|answer

  if (!filePath) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }

  // セキュリティ: Desktop フォルダ以外のファイルは拒否
  const resolvedPath = path.resolve(filePath);
  if (!resolvedPath.startsWith(DESKTOP_PATH + path.sep)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  try {
    const buffer = fs.readFileSync(resolvedPath);
    const base64 = buffer.toString("base64");
    const ext = path.extname(resolvedPath).toLowerCase();
    const mimeType = ext === ".png" ? "image/png" : "image/jpeg";
    const dataUrl = `data:${mimeType};base64,${base64}`;

    // 取り込み済みファイルを ~/Desktop/AIドリル取込済み/YYYY-MM-DD/ へ移動し、
    // 「役割_日時.png」へ改名（案A）。役割不明時は元の名前のまま。
    let movedName = path.basename(resolvedPath);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const destDir = path.join(os.homedir(), "Desktop", "AIドリル取込済み", today);
      fs.mkdirSync(destDir, { recursive: true });

      const label = slot ? SLOT_LABELS[slot] : undefined;
      if (label) {
        const stamp = localStamp();
        // 同名衝突を避けて連番付与
        let candidate = `${label}_${stamp}${ext}`;
        let dest = path.join(destDir, candidate);
        for (let i = 2; fs.existsSync(dest); i++) {
          candidate = `${label}_${stamp}_${i}${ext}`;
          dest = path.join(destDir, candidate);
        }
        fs.renameSync(resolvedPath, dest);
        movedName = candidate;
      } else {
        fs.renameSync(resolvedPath, path.join(destDir, movedName));
      }
    } catch {
      // 移動に失敗しても取り込みは続行
    }

    return NextResponse.json({ dataUrl, fileName: movedName });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
