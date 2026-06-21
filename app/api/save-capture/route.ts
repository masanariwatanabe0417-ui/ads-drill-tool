import { type NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

export const runtime = "nodejs";

// getDisplayMedia でブラウザ内キャプチャした画像（dataURL）を一時ファイルとして書き出す。
// 書き出し先は Desktop 配下のサブフォルダ。理由:
//  - rename-imported は「Desktop 配下のみ移動許可」なので Desktop 配下に置く必要がある
//  - watch-screenshots は Desktop"直下"かつ Mac標準ファイル名のみ拾うため、サブフォルダ＋独自名なら
//    自動取込ウォッチャーに二重検出されない
// 解説生成成功後に rename-imported がここから整理フォルダへ move する（成功時はこのフォルダは空になる）。
const TMP_DIR = path.join(os.homedir(), "Desktop", ".ads-capture-tmp");

const SLOTS = new Set(["courseMap", "question", "answer"]);

export async function POST(request: NextRequest) {
  try {
    const { dataUrl, slot } = (await request.json()) as {
      dataUrl?: string;
      slot?: string;
    };
    if (!dataUrl || !slot || !SLOTS.has(slot)) {
      return NextResponse.json({ error: "dataUrl/slot required" }, { status: 400 });
    }

    const m = dataUrl.match(/^data:image\/png;base64,(.+)$/);
    if (!m) {
      return NextResponse.json({ error: "PNG dataURL required" }, { status: 400 });
    }
    const buffer = Buffer.from(m[1], "base64");

    fs.mkdirSync(TMP_DIR, { recursive: true });
    const dest = path.join(TMP_DIR, `${slot}-${Date.now()}.png`);
    fs.writeFileSync(dest, buffer);

    return NextResponse.json({ path: dest });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "save failed" },
      { status: 500 }
    );
  }
}
