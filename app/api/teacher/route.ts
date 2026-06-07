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
async function extractLessonInfo(questionImageDataUrl: string, courseMapImageDataUrl?: string) {
  const content: Anthropic.MessageParam["content"] = [];

  if (courseMapImageDataUrl) {
    content.push({ type: "text", text: "【コースマップ画像】（シリーズ名・コース名・現在のレッスン名を読み取ってください）" });
    content.push(buildImageBlock(courseMapImageDataUrl));
  }
  content.push({ type: "text", text: "【問題画像】（問題番号「Q数字」を読み取ってください）" });
  content.push(buildImageBlock(questionImageDataUrl));
  content.push({
    type: "text",
    text: `上の画像から情報を読み取り、以下のJSON形式のみで返してください（他のテキストは含めない）：
{
  "series": "【コースマップ画像】の最上部に書かれたシリーズ名（例：Git完全マスターシリーズ）",
  "course": "【コースマップ画像】の大見出しに書かれたコース名（例：Git概念マスターコース）",
  "lesson": "【コースマップ画像】で再生ボタン▶またはピンク色でハイライトされているレッスンの「Lesson X レッスン名」形式（例：Lesson 6 分散型の世界）",
  "questionNumber": "【問題画像】の左上などに表示されているQ番号の数字のみ（例：「Q1/10」なら「Q1」、「Q3」なら「Q3」）"
}`,
  });

  const message = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 256,
    messages: [{ role: "user", content }],
  });
  const raw = message.content.length > 0 && message.content[0].type === "text" ? message.content[0].text : "{}";
  const match = raw.match(/\{[\s\S]*\}/);
  try {
    const parsed = match ? JSON.parse(match[0]) : {};
    return {
      series: parsed.series ?? "不明",
      course: parsed.course ?? "不明",
      lesson: parsed.lesson ?? "不明",
      questionNumber: parsed.questionNumber ?? null,
    };
  } catch {
    return { series: "不明", course: "不明", lesson: "不明", questionNumber: null };
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

    // glossary・explanation: 問題 + 解答のみ（コースマップ不要）
    const qaBlocks = buildImageBlocks(questionImageDataUrl, answerImageDataUrl);

    // 3エージェント並列実行
    const [lessonInfo, glossary, explanationData] = await Promise.all([
      extractLessonInfo(questionImageDataUrl, courseMapImageDataUrl),
      generateGlossary(qaBlocks),
      generateExplanation(qaBlocks, !!answerImageDataUrl),
    ]);

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
