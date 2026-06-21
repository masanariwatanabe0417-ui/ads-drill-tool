import { NextResponse } from "next/server";
import {
  EMPTY,
  readStudyLog,
  writeStudyLog,
  mergeGlossaryMaps,
} from "@/lib/studyLogStore";

export const runtime = "nodejs";
// 引数なしの GET はビルド時に静的化され、デプロイ後もビルド時点のデータが
// 返り続けてしまうため、毎リクエスト実行を強制する
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await readStudyLog());
  } catch {
    return NextResponse.json(EMPTY);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const existing = await readStudyLog();
    await writeStudyLog(mergeGlossaryMaps(body, existing as unknown as Record<string, unknown>));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
