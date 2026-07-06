import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

// 解説文の中から学習者が選んだ語句を、単語帳エントリ（用語名＋やさしい定義）に整える。
// 用語解説に載っていない重要語（例: Next.js, .tsx）を手動で単語帳に登録するための補助。
export async function POST(req: Request) {
  try {
    const { selectedText, context } = await req.json();

    if (!selectedText?.trim()) {
      return Response.json({ error: "用語が選択されていません" }, { status: 400 });
    }

    const promptText = `あなたは入社したての社員に教える親切な先輩社員です。学習者が解説文の中から「単語帳に登録したい語句」を選びました。その語句の単語帳エントリ（用語名＋やさしい定義）を作ってください。

【選択された語句】${selectedText}

【その語句が登場した解説（意味を合わせるための文脈）】
${context || "（文脈なし）"}

重要ルール：
- 用語名(term)：英語・記号が主体なら必ず「英語表記(カタカナ読み)」形式にする（例: Next.js(ネクストジェイエス)、.tsx(ティーエスエックス)）。漢字を含む用語は「用語(ひらがなの振り仮名)」形式にする（例: 変更履歴(へんこうりれき)）。カタカナだけの用語は括弧を付けずそのまま。読み仮名は複合語でも語末にまとめて1つだけ付ける。
- 定義(definition)：入社したての社員にも分かるよう、やさしく簡潔に（1〜2文）。英語・コード用語が出たら直後にカタカナを括弧で補足する。
- 選択語句が長い文やフレーズの場合は、核となる用語名に整える。

以下のJSON形式で返してください。JSONのみを返し、他のテキストは含めないでください：
{
  "term": "単語帳に載せる用語名（上のルールで整形）",
  "definition": "やさしい定義（1〜2文）"
}`;

    const message = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 300,
      messages: [{ role: "user", content: promptText }],
    });

    const rawText =
      message.content.length > 0 && message.content[0].type === "text"
        ? message.content[0].text
        : "{}";

    let parsed: { term?: string; definition?: string };
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } catch {
      parsed = {};
    }

    return Response.json({
      term: parsed.term?.trim() || selectedText.trim(),
      definition: parsed.definition?.trim() || "",
    });
  } catch (error) {
    console.error("glossary-term API error:", error);
    return Response.json({ error: "用語定義の生成に失敗しました" }, { status: 500 });
  }
}
