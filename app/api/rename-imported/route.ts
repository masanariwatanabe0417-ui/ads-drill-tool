import { type NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

export const runtime = "nodejs";

// 取り込み済みフォルダ配下のファイルだけ改名を許可（セキュリティ）
const IMPORTED_ROOT = path.join(os.homedir(), "Desktop", "AIドリル取込済み");

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

    for (const [slot, filePath] of Object.entries(files)) {
      if (!filePath) continue;
      const label = SLOT_LABELS[slot];
      if (!label) continue;

      const resolved = path.resolve(filePath);
      // 取り込み済みフォルダ外は拒否
      if (!resolved.startsWith(IMPORTED_ROOT + path.sep)) continue;
      if (!fs.existsSync(resolved)) continue;

      const dir = path.dirname(resolved);
      const ext = path.extname(resolved) || ".png";

      // コース_Lesson_タイトル_Q_役割.png（同名は連番）
      let candidate = `${prefix}${lessonPart}_${qPart}_${label}${ext}`;
      let dest = path.join(dir, candidate);
      for (let i = 2; fs.existsSync(dest) && dest !== resolved; i++) {
        candidate = `${prefix}${lessonPart}_${qPart}_${label}_${i}${ext}`;
        dest = path.join(dir, candidate);
      }
      if (dest !== resolved) {
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
