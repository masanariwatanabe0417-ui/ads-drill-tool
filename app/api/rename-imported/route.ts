import { type NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import { courseNumber } from "@/lib/courseOrder";

export const runtime = "nodejs";

// 取り込み先フォルダ。ここへ Desktop 上の元ファイルを
// シリーズ/コース/レッスン のフォルダ階層で移動＋改名する。
const IMPORTED_ROOT = path.join(os.homedir(), "Desktop", "AIドリル取込済み");
// 元ファイルは Desktop 配下のみ許可（セキュリティ）
const DESKTOP_PATH = path.join(os.homedir(), "Desktop");

const SLOT_LABELS: Record<string, string> = {
  courseMap: "コースマップ",
  question: "問題",
  answer: "解答",
};

// 2桁ゼロ埋め（番号順に並ぶようにする）。100以上はそのまま。
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

// パス1要素分として使える文字に整形（フォルダ名・ファイル名共通）
function sanitize(s: string): string {
  return s
    .replace(/[\\/:*?"<>|]/g, "-") // OS禁止文字
    .replace(/\s+/g, "_") // 空白 → _
    .replace(/_+/g, "_")
    .replace(/^[_\-.]+|[_\-.]+$/g, "")
    .slice(0, 80); // 長すぎ防止
}

// "Lesson 6 分散型の世界" → "Lesson06_分散型の世界"
// 番号が読めなければゼロ埋めせず、文字列をそのまま整形する。
function lessonFolder(lesson: string): string {
  const m = lesson.match(/Lesson\s*0*(\d+)\s*[_:：\-―—]?\s*(.*)$/i);
  if (m) {
    const num = pad2(parseInt(m[1], 10));
    const title = sanitize(m[2]);
    return title ? `Lesson${num}_${title}` : `Lesson${num}`;
  }
  return sanitize(lesson);
}

// "Q1" / "Q1/10" → "Q01"。番号が読めなければそのまま整形。
function questionLabel(q: string): string {
  const m = q.match(/Q\s*0*(\d+)/i);
  return m ? `Q${pad2(parseInt(m[1], 10))}` : sanitize(q);
}

// コースフォルダ名。対応表に番号があれば "01_コース名"、無ければ番号なし。
function courseFolder(series: string, course: string): string {
  const safe = sanitize(course);
  const n = courseNumber(series, course);
  return n != null ? `${pad2(n)}_${safe}` : safe;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      files?: Partial<Record<string, string>>; // { courseMap?, question?, answer? }
      series?: string;
      course?: string;
      lesson?: string;
      questionInfo?: string;
    };
    const { files, series, course, lesson, questionInfo } = body;
    if (!files || !lesson || !questionInfo) {
      return NextResponse.json({ error: "files/lesson/questionInfo required" }, { status: 400 });
    }

    // 保存先ディレクトリ: IMPORTED_ROOT/シリーズ/NN_コース/LessonNN_タイトル/
    // 値が無い階層はスキップして、取れた分だけで階層を作る。
    const dirParts = [IMPORTED_ROOT];
    if (series) dirParts.push(sanitize(series));
    if (course) dirParts.push(courseFolder(series ?? "", course));
    dirParts.push(lessonFolder(lesson));
    const destDir = path.join(...dirParts);

    const qPart = questionLabel(questionInfo);
    const renamed: Record<string, string> = {};

    fs.mkdirSync(destDir, { recursive: true });

    for (const [slot, filePath] of Object.entries(files)) {
      if (!filePath) continue;
      const label = SLOT_LABELS[slot];
      if (!label) continue;

      const resolved = path.resolve(filePath);
      // 元ファイルは Desktop 配下のみ許可（取込フォルダ内の再改名も Desktop 配下なので許容）
      if (!resolved.startsWith(DESKTOP_PATH + path.sep)) continue;
      if (!fs.existsSync(resolved)) continue;

      const ext = path.extname(resolved) || ".png";

      // 階層フォルダ内に Q01_問題.png 形式で配置（撮り直し時は上書き）
      const dest = path.join(destDir, `${qPart}_${label}${ext}`);
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
