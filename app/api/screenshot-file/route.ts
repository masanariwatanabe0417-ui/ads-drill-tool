import { type NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

export const runtime = "nodejs";

const DESKTOP_PATH = path.join(os.homedir(), "Desktop");

export async function GET(request: NextRequest) {
  const filePath = request.nextUrl.searchParams.get("path");

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

    // 取り込み済みファイルを ~/Desktop/AIドリル取込済み/YYYY-MM-DD/ へ移動
    try {
      const today = new Date().toISOString().slice(0, 10);
      const destDir = path.join(os.homedir(), "Desktop", "AIドリル取込済み", today);
      fs.mkdirSync(destDir, { recursive: true });
      fs.renameSync(resolvedPath, path.join(destDir, path.basename(resolvedPath)));
    } catch {
      // 移動に失敗しても取り込みは続行
    }

    return NextResponse.json({ dataUrl, fileName: path.basename(resolvedPath) });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
