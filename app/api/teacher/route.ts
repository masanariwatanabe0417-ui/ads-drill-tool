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

// クライアントから渡される既存コース一覧の型（OCRブレ防止のアンカーに使う）
type KnownCourse = { series: string; course: string; lessons: string[] };

// Agent①: スクリーンショットからレッスン情報を抽出（haiku - 高速）
async function extractLessonInfo(
  questionImageDataUrl: string,
  courseMapImageDataUrl?: string,
  knownCourses?: KnownCourse[]
) {
  const content: Anthropic.MessageParam["content"] = [];

  if (courseMapImageDataUrl) {
    content.push({ type: "text", text: "【コースマップ画像】（シリーズ名・コース名・現在のレッスン名を読み取ってください）" });
    content.push(buildImageBlock(courseMapImageDataUrl));
  }
  content.push({ type: "text", text: "【問題画像】（問題番号「Q数字」を読み取ってください）" });
  content.push(buildImageBlock(questionImageDataUrl));

  // 既存コース一覧があれば、OCRのブレで別コースに分裂しないよう「一致したら既存名をそのまま使う」よう指示。
  // haikuはコース名の漢字（例：壊→棲→襲）を毎回違う字に誤読することがあり、これで正しい名前に寄せる。
  if (knownCourses && knownCourses.length > 0) {
    const list = knownCourses
      .map((c) => `- シリーズ「${c.series}」/ コース「${c.course}」/ レッスン: ${c.lessons.join(" 、 ")}`)
      .join("\n");
    content.push({
      type: "text",
      text: `【登録済みコース一覧】（過去に読み取り済みの正しい名前）:
${list}

重要: コースマップのシリーズ名・コース名・レッスン名が上の一覧のいずれかと同じものを指していると判断できる場合は、画像から読み取り直さず、一覧に書かれた文字列をそのまま完全コピーして返してください（漢字の細かな差異は一覧側を正とする）。一覧に該当が無い新規のコース/レッスンのときだけ、画像から新しく読み取ってください。`,
    });
  }

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
  const parsed = (match ? parseLooseJson(match[0]) : null) ?? {};
  return {
    series: typeof parsed.series === "string" ? parsed.series : "不明",
    course: typeof parsed.course === "string" ? parsed.course : "不明",
    lesson: typeof parsed.lesson === "string" ? parsed.lesson : "不明",
    questionNumber: typeof parsed.questionNumber === "string" ? parsed.questionNumber : null,
  };
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

// モデルがJSON文字列内に実改行・タブを入れて返すことがあり、素のJSON.parseだと失敗する。
// 文字列内の制御文字だけをエスケープしてから再パースする。
function parseLooseJson(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text);
  } catch {}
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      if (escaped) { out += ch; escaped = false; continue; }
      if (ch === "\\") { out += ch; escaped = true; continue; }
      if (ch === '"') { inString = false; out += ch; continue; }
      if (ch === "\n") { out += "\\n"; continue; }
      if (ch === "\r") continue;
      if (ch === "\t") { out += "\\t"; continue; }
      out += ch;
    } else {
      if (ch === '"') inString = true;
      out += ch;
    }
  }
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
}

// モデルが「覚えるポイント」等を mainContent の外側の独自キーに分けて返すことがあるため、
// keyLearning/mainContent 以外のキーは見出し付きで本文に取り込む。
function composeExplanation(parsed: Record<string, unknown>): { keyLearning: string; mainContent: string } {
  const keyLearning = typeof parsed.keyLearning === "string" ? parsed.keyLearning : "";
  let mainContent = typeof parsed.mainContent === "string" ? parsed.mainContent : "";
  for (const [key, value] of Object.entries(parsed)) {
    if (key === "keyLearning" || key === "mainContent") continue;
    const heading = key.replace(/^#+\s*/, "");
    if (typeof value === "string" && value.trim()) {
      mainContent += `\n\n## ${heading}\n${value.trim()}`;
    } else if (Array.isArray(value)) {
      const items = value.filter((v): v is string => typeof v === "string");
      if (items.length > 0) {
        mainContent += `\n\n## ${heading}\n${items.map((v) => `- ${v}`).join("\n")}`;
      }
    }
  }
  return { keyLearning, mainContent: mainContent.trim() };
}

// Agent③: 解説・keyLearning・覚えるべきポイントを生成（haiku - 高品質）
// structured outputs（output_config.format）でJSONの妥当性とキー構成をAPIレベルで保証する。
// 以前はテキストでJSONを書かせていたため、文字列内の実改行やキー欠落でパースが壊れ、
// 画面に生JSONが表示される事故があった。
async function generateExplanation(imageBlocks: ImageBlock[], hasAnswer: boolean) {
  const message = await client.beta.messages.create({
    model: "claude-haiku-4-5",
    // max_tokensに達するとJSONが途中で切れてパース不能になるため余裕を持たせる
    max_tokens: 2048,
    output_config: {
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            keyLearning: {
              type: "string",
              description: "この問題で学ぶ核心を1〜2文で（自分の言葉で、英語用語にはカタカナを括弧で補足）",
            },
            mainContent: {
              type: "string",
              description: "Markdown形式の解説本文。## 問題 / ## 正解 / ## なぜこれが正解？ / ## 間違い選択肢のどこが違う？ / ## 覚えるポイント の見出し構成",
            },
          },
          required: ["keyLearning", "mainContent"],
          additionalProperties: false,
        },
      },
    },
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
- ドリルの原文をそのまま使わず、自分の言葉で噛み砕いて説明してください
- 英語・コード用語が出てきたら必ず直後にカタカナを括弧で補足してください（例：branch(ブランチ)）
- 問題と正解を一体で説明し「なぜその答えなのか」を中心に解説してください
- 間違い選択肢は1つずつ「どこが違うのか」を具体的に説明してください

以下のJSON形式のみで返してください（他のテキストは含めない）：
{
  "keyLearning": "この問題で学ぶ核心を1〜2文で（自分の言葉で、英語用語にはカタカナを括弧で補足）",
  "mainContent": "## 問題\\n（ドリルの問題文を原文そのままではなく、もっとわかりやすい日本語に言い換えて1〜3文で）\\n\\n## 正解\\n（正解の選択肢を原文そのままではなく、もっとわかりやすい日本語に言い換えて1〜2文で）\\n\\n## なぜこれが正解？\\n（問題と正解をセットで、「〜だから正解は◯」のように理由から説明。ドリル原文をそのまま使わず自分の言葉で）\\n\\n## 間違い選択肢のどこが違う？\\n（各選択肢ごとに「選択肢X：〜だからNG」と1〜2文で説明）\\n\\n## 覚えるポイント\\n（この問題から持ち帰るべき核心を1〜3点）"
}`,
          },
        ],
      },
    ],
  });
  const block = message.content.find((b) => b.type === "text");
  const raw = block && block.type === "text" ? block.text : "{}";
  // structured outputsで有効なJSONが保証されるが、保険として寛容パースを通す
  const parsed = parseLooseJson(raw);
  if (!parsed) {
    return { keyLearning: "", mainContent: raw };
  }
  return composeExplanation(parsed);
}

export async function POST(req: Request) {
  try {
    const { questionImageDataUrl, answerImageDataUrl, courseMapImageDataUrl, knownCourses } = await req.json();

    if (!questionImageDataUrl) {
      return Response.json({ error: "問題のスクリーンショットが必要です" }, { status: 400 });
    }

    // glossary・explanation: 問題 + 解答のみ（コースマップ不要）
    const qaBlocks = buildImageBlocks(questionImageDataUrl, answerImageDataUrl);

    // 3エージェント並列実行
    const [lessonInfo, glossary, explanationData] = await Promise.all([
      extractLessonInfo(questionImageDataUrl, courseMapImageDataUrl, knownCourses),
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
