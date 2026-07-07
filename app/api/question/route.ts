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
      summaryMode, // まとめビュー（レッスン/コース/講義まとめ）からの質問。追加案の代わりに「気づき」を提案する
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
    {"term": "回答中に登場した用語（${glossaryTerm}以外）。英語・記号主体の場合は必ず「英語表記(カタカナ読み)」形式にすること（例: GitHub(ギットハブ)、branch(ブランチ)）。漢字を含む用語は「用語(ひらがなの振り仮名)」形式（例: 変更履歴(へんこうりれき)）。カタカナだけの用語は括弧を付けずそのまま。", "definition": "その用語の簡潔な定義（1文）"}
  ]
}
newTermsは該当がなければ空配列[]にしてください。多くても2件まで。`
      : summaryMode
      ? `あなたは入社したての社員に教える親切な先輩社員です。
表示中のまとめ：${lessonTitle}

生徒がまとめを読み返しながら質問をしてきました。

重要ルール：
- 入社したての社員に教える先輩社員として、分かりやすく簡潔に説明してください
- 英語・コード用語が出てきたら必ず直後にカタカナを括弧で補足してください（例：branch(ブランチ)、commit(コミット)、merge(マージ)）

【現在のまとめの内容】
${currentExplanation || "（まとめがありません）"}

【生徒からの質問】
${question}

以下のJSON形式で回答してください。JSONのみを返し、他のテキストは含めないでください：
{
  "answer": "質問への丁寧で分かりやすい回答（250字以内）。英語・コード用語には必ずカタカナを括弧で補足してください",
  "proposedInsight": "このQ&Aで生徒が得た気づきを、生徒自身の言葉のような一人称の気づきメモ調で1〜3文にまとめる（例：「〜だと思っていたが、実は〜だと分かった」「〜と〜は…という点でつながっていた」）。まとめに既に書いてあることの言い換えではなく、質問を通じて新しく腑に落ちた点を書くこと。気づきと呼べる内容がなければ空文字にする。英語用語はカタカナ補足。"
}`
      : `あなたは入社したての社員に教える親切な先輩社員です。
レッスン：${lessonTitle}

生徒が質問をしてきました。質問が出たということは、現在の解説だけでは生徒の理解が追いつかなかった（＝つまずいた）サインです。

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
  "answer": "質問への丁寧で分かりやすい回答（250字以内）。英語・コード用語には必ずカタカナを括弧で補足してください",
  "proposedAddition": "つまずき補強の段落（3〜5文）。まず『なぜこの質問が出たか＝現在の解説に何が足りないか』を検討し、その不足を埋める内容を書くこと。質問の周辺知識（前提知識・関連概念・身近な具体例）を既存の解説の文脈に関連づけ、後日解説を読み直したときに同じ疑問が生まれないようにする。解説にすでに書いてあることの言い換えはしない。英語用語はカタカナ補足。"
}`;

    const content: Anthropic.MessageParam["content"] = [
      ...imageBlocks,
      { type: "text", text: promptText },
    ];

    // 通常モードはギャップ分析＋つまずき補強の生成が必要なためSonnet。
    // 単語帳モードは定義改善の軽作業なので従来どおりhaiku（高速・低コスト）。
    // Sonnet 5はthinking省略時にアダプティブ思考がデフォルトONになり、応答が遅くなる上
    // 先頭がthinkingブロックになる。JSON抽出タスクなので明示的に無効化する。
    const message = await client.messages.create({
      model: isGlossaryMode ? "claude-haiku-4-5" : "claude-sonnet-5",
      max_tokens: isGlossaryMode ? 512 : 1024,
      ...(isGlossaryMode ? {} : { thinking: { type: "disabled" as const } }),
      messages: [{ role: "user", content }],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    const rawText = textBlock && textBlock.type === "text" ? textBlock.text : "{}";

    let parsed: { answer?: string; proposedAddition?: string; proposedInsight?: string; proposedDefinition?: string; newTerms?: { term: string; definition: string }[] };
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { answer: rawText };
    } catch {
      parsed = { answer: rawText };
    }

    return Response.json({
      answer: parsed.answer || "回答を生成できませんでした",
      proposedAddition: parsed.proposedAddition || "",
      proposedInsight: parsed.proposedInsight || "",
      proposedDefinition: parsed.proposedDefinition || "",
      newTerms: Array.isArray(parsed.newTerms) ? parsed.newTerms : [],
    });
  } catch (error) {
    console.error("Question API error:", error);
    return Response.json({ error: "回答の生成に失敗しました" }, { status: 500 });
  }
}
