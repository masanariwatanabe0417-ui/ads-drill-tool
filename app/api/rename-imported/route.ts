import { type NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

export const runtime = "nodejs";

// 取り込み先フォルダ。ここへ Desktop 上の元ファイルを移動＋改名する。
const IMPORTED_ROOT = path.join(os.homedir(), "Desktop", "AIドリル取込済み");
// 元ファイルは Desktop 配下のみ許可（セキュリティ）
const DESKTOP_PATH = path.join(os.homedir(), "Desktop");

const SLOT_LABELS: Record<string, string> = {
  courseMap: "コースマップ",
  question: "問題",
  answer: "解答",
};

// ファイル名に使えない文字を除去・整形
function sanitize(s: string): string {
  return s
    .replace(/Lesson\s+(\d+)/i, "Lesson$1") // "Lesson 4" → "Lesson4"
    .replace(/[\\/:*?"<>|]/g, "-") // OS禁止文字
    .replace(/\s+/g, "_") // 空白 → _
    .replace(/_+/g, "_")
    .replace(/^[_\-.]+|[_\-.]+$/g, "")
    .slice(0, 80); // 長すぎ防止
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      files?: Partial<Record<string, string>>; // { courseMap?, question?, answer? }
      course?: string;
      lesson?: string;
      questionInfo?: string;
    };
    const { files, course, lesson, questionInfo } = body;
    if (!files || !lesson || !questionInfo) {
      return NextResponse.json({ error: "files/lesson/questionInfo required" }, { status: 400 });
    }

    const coursePart = course ? sanitize(course) : "";
    const lessonPart = sanitize(lesson);
    const qPart = sanitize(questionInfo);
    const prefix = coursePart ? `${coursePart}_` : "";
    const renamed: Record<string, string> = {};

    fs.mkdirSync(IMPORTED_ROOT, { recursive: true });

    for (const [slot, filePath] of Object.entries(files)) {
      if (!filePath) continue;
      const label = SLOT_LABELS[slot];
      if (!label) continue;

      const resolved = path.resolve(filePath);
      // 元ファイルは Desktop 配下のみ許可（取込フォルダ内の再改名も Desktop 配下なので許容）
      if (!resolved.startsWith(DESKTOP_PATH + path.sep)) continue;
      if (!fs.existsSync(resolved)) continue;

      const ext = path.extname(resolved) || ".png";

      // 取込フォルダへ移動しつつ コース_Lesson_タイトル_Q_役割.png に改名（撮り直し時は上書き）
      const candidate = `${prefix}${lessonPart}_${qPart}_${label}${ext}`;
      const dest = path.join(IMPORTED_ROOT, candidate);
      if (dest !== resolved) {
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        fs.renameSync(resolved, dest);
      }
      renamed[slot] = dest;
    }

    return NextResponse.json({ renamed });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "rename failed" },
      { status: 500 }
    );
  }
}
