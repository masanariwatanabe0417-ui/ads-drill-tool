import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Anthropic課金が発生するAIルートをパスコードで保護する。
// - APP_PASSCODE 設定時: ヘッダー x-app-passcode の一致を要求
// - 未設定かつVercel上: 安全側に倒してAI機能を停止（キー流用による課金を防ぐ）
// - 未設定かつローカル: 従来どおり素通し
export function middleware(req: NextRequest) {
  const passcode = process.env.APP_PASSCODE;

  if (!passcode) {
    if (process.env.VERCEL) {
      return NextResponse.json(
        { error: "APP_PASSCODE が未設定のためAI機能は無効です（Vercelの環境変数に設定してください）" },
        { status: 503 }
      );
    }
    return NextResponse.next();
  }

  if (req.headers.get("x-app-passcode") !== passcode) {
    return NextResponse.json(
      { error: "パスコードが必要です" },
      { status: 401 }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/teacher", "/api/question", "/api/glossary-consolidate"],
};
