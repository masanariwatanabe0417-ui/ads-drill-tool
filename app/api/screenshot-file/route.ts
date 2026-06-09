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

    // ⚠️ ここではファイルを移動しない（読み取るだけ）。
    // ドリルと確定する前に移動すると、無関係なスクショまで取込フォルダに入ってしまうため。
    // 実際の移動・改名は解説生成成功後の /api/rename-imported で行う（sourcePath を渡す）。
    return NextResponse.json({
      dataUrl,
      fileName: path.basename(resolvedPath),
      sourcePath: resolvedPath,
    });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
