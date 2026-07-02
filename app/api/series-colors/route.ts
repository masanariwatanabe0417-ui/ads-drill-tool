import { type NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// シリーズごとのテーマ色（本家ドリルの UI 色）。取込スクリプトが DOM から自動収集して
// POST し、NavigationPane が GET で読んで色分けに使う。手で直したい場合はこのファイルを
// 直接編集してもよい（{"シリーズ名": "#rrggbb"} の単純な辞書）。
const COLORS_FILE = path.join(process.cwd(), "data", "series-colors.json");

function readColors(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(COLORS_FILE, "utf-8"));
  } catch {
    return {};
  }
}

export async function GET() {
  return NextResponse.json(readColors());
}

export async function POST(request: NextRequest) {
  try {
    const { series, color } = (await request.json()) as { series?: string; color?: string };
    if (!series || !color || !/^#[0-9a-fA-F]{6}$/.test(color)) {
      return NextResponse.json({ error: "series と color(#rrggbb) が必要です" }, { status: 400 });
    }
    const colors = readColors();
    colors[series] = color.toLowerCase();
    fs.mkdirSync(path.dirname(COLORS_FILE), { recursive: true });
    fs.writeFileSync(COLORS_FILE, JSON.stringify(colors, null, 2));
    return NextResponse.json({ ok: true, colors });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "save failed" },
      { status: 500 }
    );
  }
}
