import { NextResponse } from "next/server";
import {
  EMPTY,
  readStudyLog,
  writeStudyLog,
  readStudyLogRev,
  mergeMissingQuestions,
  mergeGlossaryMaps,
} from "@/lib/studyLogStore";
import type { StudyLog } from "@/lib/types";

export const runtime = "nodejs";
// 引数なしの GET はビルド時に静的化され、デプロイ後もビルド時点のデータが
// 返り続けてしまうため、毎リクエスト実行を強制する
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // rev を先に読む（データ読取との間に別書き込みが挟まっても「古い rev + 新しいデータ」に
    // なる＝次の保存が救済マージに倒れる安全側）。クライアントは _rev を保存時にそのまま返す。
    const rev = await readStudyLogRev();
    const log = await readStudyLog();
    return NextResponse.json({ ...log, _rev: rev });
  } catch {
    return NextResponse.json(EMPTY);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    // クライアントが読み込んだ時点の版印。無い（旧クライアント/未読込）場合は安全側＝救済マージ。
    const clientRev = typeof body._rev === "string" ? body._rev : null;
    delete body._rev;
    const serverRev = await readStudyLogRev();
    const existing = await readStudyLog();
    let merged = mergeGlossaryMaps(body, existing as unknown as Record<string, unknown>);
    const conflicted = clientRev !== serverRev;
    if (conflicted) {
      // 読込後に別の書き込み（取込等）があった＝全置換すると消える。問題単位で補完マージ。
      merged = mergeMissingQuestions(merged as unknown as StudyLog, existing) as unknown as Record<string, unknown>;
    }
    await writeStudyLog(merged);
    return NextResponse.json({ ok: true, rev: await readStudyLogRev(), merged: conflicted });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
