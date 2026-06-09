import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

const client = new Anthropic();

export async function POST(req: NextRequest) {
  const { term, definitions } = await req.json() as { term: string; definitions: string[] };

  if (!term || !Array.isArray(definitions) || definitions.length < 2) {
    return NextResponse.json({ error: "invalid input" }, { status: 400 });
  }

  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 200,
    messages: [
      {
        role: "user",
        content: `以下は「${term}」という用語の複数の説明文です。内容を精査して、重複・言い回しの違いを統合した、簡潔で正確な1〜2文の説明を日本語で書いてください。前置きは不要です。説明文のみ出力してください。\n\n${definitions.map((d, i) => `${i + 1}. ${d}`).join("\n")}`,
      },
    ],
  });

  const consolidated = (msg.content[0] as { text: string }).text.trim();
  return NextResponse.json({ consolidated });
}
