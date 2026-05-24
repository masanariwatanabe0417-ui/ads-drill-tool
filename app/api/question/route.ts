import Anthropic from "@anthropic-ai/sdk";
import { buildImageBlock } from "@/lib/claude";

const client = new Anthropic();

export async function POST(req: Request) {
  try {
    const {
      question,
      questionImageDataUrl,
      answerImageDataUrl,
      currentExplanation,
      lessonTitle,
    } = await req.json();

    if (!question?.trim()) {
      return Response.json({ error: "質問を入力してください" }, { status: 400 });
    }

    const imageBlocks: Anthropic.MessageParam["content"] = [
      ...(questionImageDataUrl ? [buildImageBlock(questionImageDataUrl)] : []),
      ...(answerImageDataUrl ? [buildImageBlock(answerImageDataUrl)] : []),
    ];

    const content: Anthropic.MessageParam["content"] = [
      ...imageBlocks,
      {
        type: "text",
        text: `あなたは入社したての社員に教える親切な先輩社員です。
レッスン：${lessonTitle}

重要ルール：
- 入社したての社員に教える先輩社員として、分かりやすく簡潔に説明してください
- 英語・コード用語が出てきたら必ず直後にカタカナを括弧で補足してください（例：branch(ブランチ)、commit(コミット)、merge(マージ)）
- コードが出てきたら各要素の意味を簡潔に説明してください

【現在の先生の解説】
${currentExplanation || "（まだ解説がありません）"}

【生徒からの質問】
${question}

以下のJSON形式で回答してください。JSONのみを返し、他のテキストは含めないでください：
{
  "answer": "質問への丁寧で分かりやすい回答（200字以内）。英語・コード用語には必ずカタカナを括弧で補足してください",
  "proposedAddition": "この質問と回答から先生の解説に追加すると役立つ補足（1〜2文、英語用語はカタカナ形式で補足）"
}`,
      },
    ];

    const message = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 512,
      messages: [{ role: "user", content }],
    });

    const rawText =
      message.content.length > 0 && message.content[0].type === "text"
        ? message.content[0].text
        : "{}";

    let parsed: { answer: string; proposedAddition: string };
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { answer: rawText, proposedAddition: "" };
    } catch {
      parsed = { answer: rawText, proposedAddition: "" };
    }

    return Response.json({
      answer: parsed.answer || "回答を生成できませんでした",
      proposedAddition: parsed.proposedAddition || "",
    });
  } catch (error) {
    console.error("Question API error:", error);
    return Response.json({ error: "回答の生成に失敗しました" }, { status: 500 });
  }
}
