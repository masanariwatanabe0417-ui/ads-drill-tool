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
      glossaryTerm,
      currentDefinition,
    } = await req.json();

    if (!question?.trim()) {
      return Response.json({ error: "質問を入力してください" }, { status: 400 });
    }

    const imageBlocks: Anthropic.MessageParam["content"] = [
      ...(questionImageDataUrl ? [buildImageBlock(questionImageDataUrl)] : []),
      ...(answerImageDataUrl ? [buildImageBlock(answerImageDataUrl)] : []),
    ];

    const isGlossaryMode = !!glossaryTerm;

    const promptText = isGlossaryMode
      ? `あなたは入社したての社員に教える親切な先輩社員です。

【単語帳の用語】${glossaryTerm}
【現在の定義】${currentDefinition || "（未登録）"}

重要ルール：
- 分かりやすく簡潔に説明してください
- 英語・コード用語が出てきたら必ず直後にカタカナを括弧で補足してください

【生徒からの質問】
${question}

以下のJSON形式で回答してください。JSONのみを返し、他のテキストは含めないでください：
{
  "answer": "質問への丁寧で分かりやすい回答（200字以内）",
  "proposedDefinition": "【重要】この質問と回答で明らかになった内容（違い・特徴・具体的な役割など）を積極的に盛り込んだ「${glossaryTerm}」の定義文（1〜2文）。現在の定義をそのまま踏襲せず、Q&Aで得られた新たな視点を反映させること。",
  "newTerms": [
    {"term": "回答中に登場した用語（${glossaryTerm}以外）。英語・記号主体の場合は必ず「英語表記(カタカナ読み)」形式にすること（例: GitHub(ギットハブ)、branch(ブランチ)）。日本語の場合はそのまま。", "definition": "その用語の簡潔な定義（1文）"}
  ]
}
newTermsは該当がなければ空配列[]にしてください。多くても2件まで。`
      : `あなたは入社したての社員に教える親切な先輩社員です。
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
}`;

    const content: Anthropic.MessageParam["content"] = [
      ...imageBlocks,
      { type: "text", text: promptText },
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

    let parsed: { answer?: string; proposedAddition?: string; proposedDefinition?: string; newTerms?: { term: string; definition: string }[] };
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { answer: rawText };
    } catch {
      parsed = { answer: rawText };
    }

    return Response.json({
      answer: parsed.answer || "回答を生成できませんでした",
      proposedAddition: parsed.proposedAddition || "",
      proposedDefinition: parsed.proposedDefinition || "",
      newTerms: Array.isArray(parsed.newTerms) ? parsed.newTerms : [],
    });
  } catch (error) {
    console.error("Question API error:", error);
    return Response.json({ error: "回答の生成に失敗しました" }, { status: 500 });
  }
}
