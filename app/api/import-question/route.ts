import Anthropic from "@anthropic-ai/sdk";
import { addToStudyLog } from "@/lib/studyLog";
import { readStudyLog, writeStudyLog } from "@/lib/studyLogStore";
import type { ExtractedLessonInfo } from "@/lib/types";

export const runtime = "nodejs";

const client = new Anthropic();

// drill-import.mjs が DOM から読み取った1問分の構造化データ。
// 画像(/api/teacher)と違い、階層(シリーズ/コース/レッスン/Q番号)は
// ドリルのDOMから確定で取れるため OCR(エージェント①)は不要。
type ImportPayload = {
  series: string;
  course: string;
  lesson: string;
  questionInfo: string;       // "Q1" など（ドリル本来のQ番号）
  questionText: string;       // 問題文
  options: string[];          // 選択肢ラベル一覧（並べ替えでは「並べる項目」）
  correctAnswer?: string;     // 正解の選択肢ラベル（並べ替えには無い）
  drillExplanation?: string;  // ドリルが回答後に出す「マスターのワンポイント」本文
  kind?: "choice" | "ordering"; // 問題形式。ordering=並べ替え（正解は単一ラベルでなく順序）
};

// 問題・選択肢・正解・ドリル解説を1つのテキストにまとめる（生成エージェントへの入力）。
function buildQuestionText(p: ImportPayload): string {
  // 並べ替え問題: 正解は「順序」で、その順序はドリル解説の中に示される。
  if (p.kind === "ordering") {
    const lines = [
      `問題（${p.questionInfo}）[並べ替え]: ${p.questionText}`,
      `並べる項目（提示順。正しい順序ではない）:`,
      ...p.options.map((o) => `  - ${o}`),
    ];
    if (p.drillExplanation && p.drillExplanation.trim()) {
      lines.push(
        `正しい順序の解説（ドリル公式。ここに正解の並び順が示されている）:\n${p.drillExplanation.trim()}`
      );
    }
    return lines.join("\n");
  }

  // 通常の選択式
  const lines = [
    `問題（${p.questionInfo}）: ${p.questionText}`,
    `選択肢:`,
    ...p.options.map((o) => `  - ${o}${o === p.correctAnswer ? "  ← 正解" : ""}`),
    `正解: ${p.correctAnswer ?? "(不明)"}`,
  ];
  if (p.drillExplanation && p.drillExplanation.trim()) {
    lines.push(`ドリル公式の解説（参考。これを噛み砕いて自分の言葉で説明する）:\n${p.drillExplanation.trim()}`);
  }
  return lines.join("\n");
}

// モデルがJSON文字列内に実改行・タブを入れて返すことがあるため寛容にパースする。
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

// 用語解説（画像ルートの generateGlossary をテキスト入力にしたもの。出力形式は同一）。
async function generateGlossary(questionText: string): Promise<string> {
  const message = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: `あなたは入社したての社員に教える親切な先輩社員です。
このドリルに登場する専門用語だけに絞って、中学生でもわかる言葉で説明してください。

--- ドリルの問題 ---
${questionText}
--- ここまで ---

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
  });
  return message.content.length > 0 && message.content[0].type === "text"
    ? message.content[0].text.trim()
    : "## 用語解説\n（用語解説を生成できませんでした）";
}

// 解説本文＋keyLearning（画像ルートの generateExplanation をテキスト入力にしたもの。出力形式は同一）。
async function generateExplanation(
  questionText: string,
  kind: "choice" | "ordering"
): Promise<{ keyLearning: string; mainContent: string }> {
  // 形式ごとに本文の見出し構成を変える（並べ替えには「間違い選択肢」が無い）。
  const contentDesc =
    kind === "ordering"
      ? "Markdown形式の解説本文。## 問題 / ## 正しい順序 / ## なぜこの順序なのか / ## 覚えるポイント の見出し構成"
      : "Markdown形式の解説本文。## 問題 / ## 正解 / ## なぜこれが正解？ / ## 間違い選択肢のどこが違う？ / ## 覚えるポイント の見出し構成";
  const bodyInstruction =
    kind === "ordering"
      ? `- これは「並べ替え（順序）問題」です。正しい順序はドリル解説に示されています
- 各段階が「なぜその順番なのか（前の段階が次の前提になる等）」を中心に説明してください`
      : `- 問題と正解を一体で説明し「なぜその答えなのか」を中心に解説してください
- 間違い選択肢は1つずつ「どこが違うのか」を具体的に説明してください`;
  const mainContentTemplate =
    kind === "ordering"
      ? `## 問題\\n（何を順番に並べる問題かを1〜2文で）\\n\\n## 正しい順序\\n（正しい並び順を 1. → 2. → 3. … の番号付きで、各項目をわかりやすい日本語で）\\n\\n## なぜこの順序なのか\\n（各段階が次の前提になる理由を順に説明）\\n\\n## 覚えるポイント\\n（この問題から持ち帰るべき核心を1〜3点）`
      : `## 問題\\n（問題文を原文そのままではなく、もっとわかりやすい日本語に言い換えて1〜3文で）\\n\\n## 正解\\n（正解の選択肢を原文そのままではなく、もっとわかりやすい日本語に言い換えて1〜2文で）\\n\\n## なぜこれが正解？\\n（問題と正解をセットで、「〜だから正解は◯」のように理由から説明。原文をそのまま使わず自分の言葉で）\\n\\n## 間違い選択肢のどこが違う？\\n（各選択肢ごとに「選択肢X：〜だからNG」と1〜2文で説明）\\n\\n## 覚えるポイント\\n（この問題から持ち帰るべき核心を1〜3点）`;

  const message = await client.beta.messages.create({
    model: "claude-haiku-4-5",
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
              description: contentDesc,
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
        content: `あなたは入社したての社員に教える親切な先輩社員です。
以下は「本気AIドリル」の問題・選択肢・正解・公式解説です。

重要ルール：
- ドリルの原文をそのまま使わず、自分の言葉で噛み砕いて説明してください
- 英語・コード用語が出てきたら必ず直後にカタカナを括弧で補足してください（例：branch(ブランチ)）
${bodyInstruction}

--- ドリルの問題 ---
${questionText}
--- ここまで ---

以下のJSON形式のみで返してください（他のテキストは含めない）：
{
  "keyLearning": "この問題で学ぶ核心を1〜2文で（自分の言葉で、英語用語にはカタカナを括弧で補足）",
  "mainContent": "${mainContentTemplate}"
}`,
      },
    ],
  });
  const block = message.content.find((b) => b.type === "text");
  const raw = block && block.type === "text" ? block.text : "{}";
  const parsed = parseLooseJson(raw);
  if (!parsed) return { keyLearning: "", mainContent: raw };
  return composeExplanation(parsed);
}

export async function POST(req: Request) {
  try {
    const p = (await req.json()) as ImportPayload;
    if (!p?.series || !p?.course || !p?.lesson || !p?.questionInfo || !p?.questionText) {
      return Response.json(
        { error: "series/course/lesson/questionInfo/questionText は必須です" },
        { status: 400 }
      );
    }

    const kind = p.kind === "ordering" ? "ordering" : "choice";
    const questionText = buildQuestionText(p);

    // 用語解説と解説本文を並列生成（画像ルートと同じ構成）
    const [glossary, explanationData] = await Promise.all([
      generateGlossary(questionText),
      generateExplanation(questionText, kind),
    ]);

    const explanation = `${glossary}\n\n${explanationData.mainContent ?? ""}`.trim();

    // 永続化 studyLog に1問マージ保存（read → addToStudyLog → write）。
    // スクリプトから1問ずつ直列に呼ばれる前提（同時書き込みは想定しない）。
    const lessonInfo: ExtractedLessonInfo = { series: p.series, course: p.course, lesson: p.lesson };
    const current = await readStudyLog();
    const updated = addToStudyLog(current, lessonInfo, p.questionInfo, explanationData.keyLearning ?? "", explanation);
    await writeStudyLog(updated);

    return Response.json({
      ok: true,
      questionInfo: p.questionInfo,
      keyLearning: explanationData.keyLearning ?? "",
    });
  } catch (error) {
    console.error("import-question API error:", error);
    return Response.json({ error: "問題の取り込みに失敗しました" }, { status: 500 });
  }
}
