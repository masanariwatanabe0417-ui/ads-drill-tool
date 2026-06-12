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

// Agent④: 概念のMermaid図解を生成（haiku - 図解特化）
// 図解に向かない問題（単純な暗記・定義のみ等）は applicable=false でスキップする。
// 図はMarkdownのmermaidコードブロックとして解説末尾に合成するため保存形式は変わらない。
async function generateDiagram(imageBlocks: ImageBlock[]) {
  try {
    const message = await client.beta.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              applicable: {
                type: "boolean",
                description: "この問題の核心が図で表せるならtrue。図にしても情報が増えない単純な定義・暗記問題ならfalse",
              },
              mermaid: {
                type: "string",
                description: "Mermaid記法の図。applicableがfalseなら空文字",
              },
            },
            required: ["applicable", "mermaid"],
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
              text: `あなたは概念を図解するのが得意な先輩社員です。
このドリル問題の核心となる概念・関係・流れを、初学者がひと目で理解できるMermaid図にしてください。

Mermaid記法の厳守ルール（構文エラーで表示できなくなるため必ず守る）：
- 1行目は flowchart TD または flowchart LR のみ
- ノードは必ず id["ラベル"] の形式（ラベルはダブルクォートで囲む）
- ラベル内にダブルクォートは使わない
- 矢印は --> または -->|"ラベル"| のみ
- subgraph を使う場合は subgraph id["タイトル"] ... end の形式
- スタイル指定・class・click は使わない
- ノード数は3〜8個に収める

内容ルール：
- 図は問題の「なぜそれが正解か」の理解を助けるものにする
- 英語・コード用語にはカタカナを括弧で補足（例：branch(ブランチ)）
- 図にしても理解が深まらない問題（用語の定義を答えるだけ等）は applicable を false にする`,
            },
          ],
        },
      ],
    });
    const block = message.content.find((b) => b.type === "text");
    const raw = block && block.type === "text" ? block.text : "{}";
    const parsed = parseLooseJson(raw);
    if (!parsed || parsed.applicable !== true || typeof parsed.mermaid !== "string") return null;
    const mermaid = parsed.mermaid.trim();
    // 最低限の妥当性チェック：flowchart宣言で始まらないものは捨てる
    if (!/^flowchart\s+(TD|LR|TB|RL|BT)\b/.test(mermaid)) return null;
    return mermaid;
  } catch (error) {
    // 図解は補助要素なので失敗しても解説生成全体は止めない
    console.error("Diagram agent error:", error);
    return null;
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

    // 4エージェント並列実行
    const [lessonInfo, glossary, explanationData, diagram] = await Promise.all([
      extractLessonInfo(questionImageDataUrl, courseMapImageDataUrl),
      generateGlossary(qaBlocks),
      generateExplanation(qaBlocks, !!answerImageDataUrl),
      generateDiagram(qaBlocks),
    ]);

    // 用語解説 + 解説本文 + 図解をマージ
    const diagramSection = diagram ? `\n\n## 図解\n\`\`\`mermaid\n${diagram}\n\`\`\`` : "";
    const explanation = `${glossary}\n\n${explanationData.mainContent ?? ""}${diagramSection}`.trim();

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
