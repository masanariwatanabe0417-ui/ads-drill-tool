import Anthropic from "@anthropic-ai/sdk";
import { buildImageBlock } from "@/lib/claude";

const client = new Anthropic();

type ImageBlock = ReturnType<typeof buildImageBlock>;

function buildImageBlocks(
  questionImageDataUrl: string,
  answerImageDataUrl?: string,
  courseMapImageDataUrl?: string
): ImageBlock[] {
  return [
    buildImageBlock(questionImageDataUrl),
    ...(answerImageDataUrl ? [buildImageBlock(answerImageDataUrl)] : []),
    ...(courseMapImageDataUrl ? [buildImageBlock(courseMapImageDataUrl)] : []),
  ];
}

// Agent①: スクリーンショットからレッスン情報を抽出（haiku - 高速）
async function extractLessonInfo(imageBlocks: ImageBlock[]) {
  const message = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 256,
    messages: [
      {
        role: "user",
        content: [
          ...imageBlocks,
          {
            type: "text",
            text: `このスクリーンショットから情報を読み取り、以下のJSON形式のみで返してください（他のテキストは含めない）：
{
  "series": "スクリーンショット右上のシリーズ名（例：React）",
  "course": "コース名（例：Hooks編）",
  "lesson": "レッスン名（例：Suspense と Error Boundary）",
  "questionInfo": "問題番号（例：Q10）"
}
questionInfoは「Q数字」の形式にしてください。`,
          },
        ],
      },
    ],
  });
  const raw = message.content.length > 0 && message.content[0].type === "text" ? message.content[0].text : "{}";
  const match = raw.match(/\{[\s\S]*\}/);
  try {
    return match ? JSON.parse(match[0]) : { series: "不明", course: "不明", lesson: "不明", questionInfo: "Q?" };
  } catch {
    return { series: "不明", course: "不明", lesson: "不明", questionInfo: "Q?" };
  }
}

// Agent②: 専門用語解説を生成（haiku - 用語特化）
async function generateGlossary(imageBlocks: ImageBlock[]) {
  const message = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: [
          ...imageBlocks,
          {
            type: "text",
            text: `あなたは入社したての社員に教える親切な先輩社員です。
このドリルに登場する専門用語だけに絞って、中学生でもわかる言葉で説明してください。

以下の形式のMarkdownのみを返してください（他のテキストは含めない）：
## 用語解説
- 用語(カタカナ): 説明
- 用語(カタカナ): 説明

ルール：
- 英語・コード用語には必ずカタカナを括弧で補足（例：branch(ブランチ)）
- 3〜6個の用語を選んでください
- 説明は1文で簡潔に`,
          },
        ],
      },
    ],
  });
  return message.content.length > 0 && message.content[0].type === "text" ? message.content[0].text.trim() : "## 用語解説\n（用語解説を生成できませんでした）";
}

// Agent③: 解説・keyLearning・覚えるべきポイントを生成（opus - 高品質）
async function generateExplanation(imageBlocks: ImageBlock[], hasAnswer: boolean) {
  const message = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: [
          ...imageBlocks,
          {
            type: "text",
            text: `あなたは入社したての社員に教える親切な先輩社員です。
このスクリーンショットは「本気AIドリル」の問題${hasAnswer ? "と解答" : ""}です。

重要ルール：
- 入社したての社員に教える先輩社員として、分かりやすく簡潔に説明してください
- 英語・コード用語が出てきたら必ず直後にカタカナを括弧で補足してください（例：branch(ブランチ)、feature(フィーチャー)）
- コードが出てきたら各要素の意味を説明してください

以下のJSON形式のみで返してください（他のテキストは含めない）：
{
  "keyLearning": "この問題で学ぶ核心を1〜2文で（英語用語にはカタカナを括弧で補足）",
  "mainContent": "## このドリルで学ぶこと\\n（1〜2文）\\n\\n## 解説\\n（入社したての社員に教える先輩のように。英語はカタカナ付き。コードが出たら各要素の意味を説明）\\n\\n## 覚えるべきポイント\\n（重要ポイント1〜3点）"
}`,
          },
        ],
      },
    ],
  });
  const raw = message.content.length > 0 && message.content[0].type === "text" ? message.content[0].text : "{}";
  const match = raw.match(/\{[\s\S]*\}/);
  try {
    return match ? JSON.parse(match[0]) : { keyLearning: "", mainContent: "" };
  } catch {
    return { keyLearning: "", mainContent: raw };
  }
}

export async function POST(req: Request) {
  try {
    const { questionImageDataUrl, answerImageDataUrl, courseMapImageDataUrl } = await req.json();

    if (!questionImageDataUrl) {
      return Response.json({ error: "問題のスクリーンショットが必要です" }, { status: 400 });
    }

    // extractLessonInfo: コースマップ（あれば）+ 問題のみ
    const lessonInfoBlocks = buildImageBlocks(questionImageDataUrl, undefined, courseMapImageDataUrl);
    // glossary・explanation: 問題 + 解答のみ（コースマップ不要）
    const qaBlocks = buildImageBlocks(questionImageDataUrl, answerImageDataUrl);

    // リクエストボディサイズをログ
    const bodySize = (questionImageDataUrl?.length ?? 0) + (answerImageDataUrl?.length ?? 0) + (courseMapImageDataUrl?.length ?? 0);
    console.log(`[teacher] body size: ${Math.round(bodySize / 1024)}KB`);

    // 3エージェント並列実行
    const t0 = Date.now();
    const [lessonInfo, glossary, explanationData] = await Promise.all([
      extractLessonInfo(lessonInfoBlocks),
      generateGlossary(qaBlocks),
      generateExplanation(qaBlocks, !!answerImageDataUrl),
    ]);
    console.log(`[teacher] 3 agents done in ${Date.now() - t0}ms`);

    // 用語解説 + 解説本文をマージ
    const explanation = `${glossary}\n\n${explanationData.mainContent ?? ""}`.trim();

    return Response.json({
      lessonInfo: lessonInfo ?? { series: "不明", course: "不明", lesson: "不明", questionInfo: "Q?" },
      keyLearning: explanationData.keyLearning ?? "",
      explanation,
    });
  } catch (error) {
    console.error("Teacher API error:", error);
    return Response.json({ error: "解説の生成に失敗しました" }, { status: 500 });
  }
}
