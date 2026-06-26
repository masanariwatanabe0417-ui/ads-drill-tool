import Anthropic from "@anthropic-ai/sdk";
import { addToStudyLog } from "@/lib/studyLog";
import { readStudyLog, writeStudyLog } from "@/lib/studyLogStore";
import type { ExtractedLessonInfo, StudyLog } from "@/lib/types";

export const runtime = "nodejs";

const client = new Anthropic();

// drill-import.mjs が DOM から読み取った1問分の構造化データ。
// 画像(/api/teacher)と違い、階層(シリーズ/コース/レッスン/Q番号)は
// ドリルのDOMから確定で取れるため OCR(エージェント①)は不要。
type MatchingPair = { left: string; right: string };

type ImportPayload = {
  series: string;
  course: string;
  lesson: string;
  questionInfo: string;       // "Q1" など（ドリル本来のQ番号）
  questionText: string;       // 問題文
  options: string[];          // 選択肢ラベル一覧（並べ替えでは「並べる項目」/ マッチングでは左項目）
  correctAnswer?: string;     // 正解の選択肢ラベル（並べ替え・マッチングには無い）
  drillExplanation?: string;  // ドリルが回答後に出す「マスターのワンポイント」本文
  kind?: "choice" | "ordering" | "matching"; // 取り込みスクリプトが送る形式。ordering=並べ替え / matching=線結び
  rightItems?: string[];      // マッチング: 右側の項目一覧（左=options と対応づける）
  pairs?: MatchingPair[];     // マッチング: 正しい対応（ドリルから読めた場合のみ。無ければ解説に依存）
};

// サーバー側で確定する問題形式。truefalse=○✕（正誤判定）は choice から検出して分離する。
// （○✕は選択肢が「正しい/間違い」の2択しかないため、多択用の「間違い選択肢のどこが違う？」
//   テンプレートを当てると日本語が破綻する＝旧来の痛み。専用見出し構成に切り替える。）
// matching=線結び（左右の項目を対応づける）は ordering と同じく単一の正解ラベルが無い。
type QuestionKind = "choice" | "ordering" | "truefalse" | "matching";

const TRUE_TOKENS = new Set(["正しい", "○", "◯", "まる", "true", "yes", "はい"]);
const FALSE_TOKENS = new Set(["間違い", "間違っている", "✕", "×", "ばつ", "false", "no", "いいえ"]);

// ○✕（正誤判定）問題かを選択肢から判定する。選択肢が2つで、一方が真トークン・
// 他方が偽トークンのときだけ truefalse とみなす（多択を誤検出しない）。
function detectKind(p: ImportPayload): QuestionKind {
  if (p.kind === "matching") return "matching";
  if (p.kind === "ordering") return "ordering";
  const opts = (p.options ?? []).map((o) => o.trim().toLowerCase());
  if (opts.length === 2) {
    const hasTrue = opts.some((o) => TRUE_TOKENS.has(o));
    const hasFalse = opts.some((o) => FALSE_TOKENS.has(o));
    if (hasTrue && hasFalse) return "truefalse";
  }
  return "choice";
}

// 問題・選択肢・正解・ドリル解説を1つのテキストにまとめる（生成エージェントへの入力）。
function buildQuestionText(p: ImportPayload, kind: QuestionKind): string {
  // ○✕（正誤判定）問題: 問題文は「主張」で、正解は その主張が正しい/間違いか。
  if (kind === "truefalse") {
    const lines = [
      `問題（${p.questionInfo}）[正誤判定]: ${p.questionText}`,
      `これは「正しい」か「間違い」かを判定する○✕問題です（選択肢は2つだけ）。`,
      `正解: この主張は「${p.correctAnswer ?? "(不明)"}」`,
    ];
    if (p.drillExplanation && p.drillExplanation.trim()) {
      lines.push(`ドリル公式の解説（参考。これを噛み砕いて自分の言葉で説明する）:\n${p.drillExplanation.trim()}`);
    }
    return lines.join("\n");
  }

  // マッチング（線結び）問題: 左右の項目を対応づける。単一の正解ラベルは無く、
  // 正しい対応は pairs（読めた場合）かドリル解説に示される。
  if (kind === "matching") {
    const lines = [
      `問題（${p.questionInfo}）[マッチング/線結び]: ${p.questionText}`,
      `左右の項目を正しく対応づける問題です。`,
      `左の項目:`,
      ...p.options.map((o) => `  - ${o}`),
      `右の項目:`,
      ...(p.rightItems ?? []).map((o) => `  - ${o}`),
    ];
    if (p.pairs && p.pairs.length > 0) {
      lines.push(`正しい対応（ドリル公式）:`, ...p.pairs.map((x) => `  - ${x.left} ↔ ${x.right}`));
    }
    if (p.drillExplanation && p.drillExplanation.trim()) {
      lines.push(
        `ドリル公式の解説（参考。正しい対応の根拠が示されている。噛み砕いて説明する）:\n${p.drillExplanation.trim()}`
      );
    }
    return lines.join("\n");
  }

  // 並べ替え問題: 正解は「順序」で、その順序はドリル解説の中に示される。
  if (kind === "ordering") {
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

// 選択肢ラベル o が正解 correct と一致するか。
// 実ドリルの選択肢テキストは先頭に「A」「B」…の記号が付く（例「B部品を…」）一方、
// DOMから読む正解ラベルは記号なし（例「部品を…」）なので、完全一致だけだと印が当たらない。
// 「o が correct で終わり、その差が短い接頭ラベル（1〜2字）」も一致とみなす。
// （合成データのように記号が無い場合は完全一致で拾えるので影響なし。）
function optionMatchesCorrect(option: string, correct: string): boolean {
  const o = option.trim();
  if (!correct) return false;
  if (o === correct) return true;
  return o.endsWith(correct) && o.length - correct.length <= 2;
}

// 「## 回答」セクションの本文を、ドリル原文の選択肢・正解のまま組み立てる（AIに通さない）。
// 正解の選択肢には印を付ける。並べ替えは正解が単一ラベルでないため項目だけ列挙する。
function buildAnswerBlock(p: ImportPayload, kind: QuestionKind): string {
  const opts = p.options ?? [];
  if (kind === "ordering") {
    return [
      "並べ替え問題です。正しい順序は下の「解説」を参照してください。",
      "",
      "並べる項目（提示順）:",
      ...opts.map((o) => `- ${o}`),
    ].join("\n");
  }
  if (kind === "matching") {
    // 正しい対応が読めていれば「左 ↔ 右」で列挙。読めていなければ項目だけ挙げて解説に委ねる。
    if (p.pairs && p.pairs.length > 0) {
      return [
        "線結び（マッチング）問題です。正しい対応は次のとおりです。",
        "",
        ...p.pairs.map((x) => `- ${x.left} ↔ **${x.right}**`),
      ].join("\n");
    }
    return [
      "線結び（マッチング）問題です。正しい対応は下の「解説」を参照してください。",
      "",
      "左の項目:",
      ...opts.map((o) => `- ${o}`),
      "",
      "右の項目:",
      ...(p.rightItems ?? []).map((o) => `- ${o}`),
    ].join("\n");
  }
  // choice / truefalse: 選択肢を原文のまま列挙し、正解に印を付ける。
  const correct = (p.correctAnswer ?? "").trim();
  // aria-label が無い選択問題は正解を確実に読めない（correctAnswer が来ない）。
  // その場合は誤った印を付けず、正解は「解説」に委ねる（ordering/matching と同じ方針）。
  if (!correct) {
    return [
      "選択問題です。正解は下の「解説」を参照してください。",
      "",
      "選択肢:",
      ...opts.map((o) => `- ${o}`),
    ].join("\n");
  }
  const lines: string[] = [];
  let marked = false;
  for (const o of opts) {
    if (optionMatchesCorrect(o, correct)) {
      lines.push(`- **${o}** ✅ 正解`);
      marked = true;
    } else {
      lines.push(`- ${o}`);
    }
  }
  // 選択肢一覧に正解ラベルが見当たらない場合の保険。
  if (!marked && correct) lines.push(`\n**正解: ${correct}**`);
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
## 用語
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
    : "## 用語\n（用語解説を生成できませんでした）";
}

// 解説本文＋keyLearning（画像ルートの generateExplanation をテキスト入力にしたもの。出力形式は同一）。
async function generateExplanation(
  questionText: string,
  kind: QuestionKind
): Promise<{ keyLearning: string; mainContent: string }> {
  // 形式ごとに本文の見出し構成を変える。
  //   ordering=並べ替え（「間違い選択肢」が無い）
  //   truefalse=○✕（選択肢が「正しい/間違い」の2択のみ＝「間違い選択肢」概念が無い）
  //   choice=多択（間違い選択肢を1つずつ解説）
  // 重要: 問題文・選択肢・正解は呼び出し側で「## 問題」「## 回答」として
  // ドリル原文のまま掲載する。ここで生成するのは「## 解説」の中身だけ＝
  // 「なぜそうなるか」に集中し、問題・正解の再掲はしない（### で小見出しを切る）。
  let contentDesc: string;
  let bodyInstruction: string;
  let mainContentTemplate: string;
  if (kind === "ordering") {
    contentDesc =
      "Markdown形式の解説本文（解説セクションの中身のみ）。### 正しい順序 / ### なぜこの順序なのか / ### 覚えるポイント の小見出し構成";
    bodyInstruction = `- これは「並べ替え（順序）問題」です。正しい順序はドリル解説に示されています
- 各段階が「なぜその順番なのか（前の段階が次の前提になる等）」を中心に説明してください
- 問題文・並べる項目は別欄に原文どおり掲載されるので、解説では繰り返しません`;
    mainContentTemplate = `### 正しい順序\\n（正しい並び順を 1. → 2. → 3. … の番号付きで、各項目をわかりやすい日本語で）\\n\\n### なぜこの順序なのか\\n（各段階が次の前提になる理由を順に説明）\\n\\n### 覚えるポイント\\n（この問題から持ち帰るべき核心を1〜3点）`;
  } else if (kind === "matching") {
    contentDesc =
      "Markdown形式の解説本文（解説セクションの中身のみ）。### 正しい対応 / ### なぜその対応なのか / ### 覚えるポイント の小見出し構成";
    bodyInstruction = `- これは「線結び（マッチング）問題」です。左右の項目の正しい対応はドリル解説（または別欄の対応表）に示されています
- 各ペアが「なぜその左と右が結びつくのか」を中心に説明してください
- 取り違えやすい組み合わせ（紛らわしい右項目）があれば、どこで区別するかに触れてください
- 問題文・項目・対応表は別欄に原文どおり掲載されるので、解説では繰り返しません`;
    mainContentTemplate = `### 正しい対応\\n（「左 → 右」の対応を箇条書きで、各項目をわかりやすい日本語で）\\n\\n### なぜその対応なのか\\n（各ペアが結びつく理由を1組ずつ説明）\\n\\n### 覚えるポイント\\n（この問題から持ち帰るべき核心を1〜3点）`;
  } else if (kind === "truefalse") {
    contentDesc =
      "Markdown形式の解説本文（解説セクションの中身のみ）。### なぜそう言えるのか / ### 引っかかりやすいポイント / ### 覚えるポイント の小見出し構成";
    bodyInstruction = `- これは「正しいか間違いか」を判定する○✕問題です。選択肢は「正しい」「間違い」の2つだけで、片方が正解です
- 問題文の主張が、なぜ「正しい」または「間違い」と言えるのかを中心に説明してください
- 「間違い選択肢」という概念はありません。代わりに「### 引っかかりやすいポイント」で、なぜ反対の答えを選びそうになるか・どこを誤解しやすいかを説明してください
- 問題文・選択肢・正解は別欄に原文どおり掲載されるので、解説では再掲せず「なぜ」に集中してください`;
    mainContentTemplate = `### なぜそう言えるのか\\n（その主張が正しい／間違いと言える理由を、原文をそのまま使わず自分の言葉で2〜4文で）\\n\\n### 引っかかりやすいポイント\\n（なぜ反対の答えを選びそうになるか・どこを誤解しやすいかを1〜2文で）\\n\\n### 覚えるポイント\\n（この問題から持ち帰るべき核心を1〜3点）`;
  } else {
    contentDesc =
      "Markdown形式の解説本文（解説セクションの中身のみ）。### なぜこれが正解？ / ### 間違い選択肢のどこが違う？ / ### 覚えるポイント の小見出し構成";
    bodyInstruction = `- 「なぜその答えなのか」を中心に解説してください
- 間違い選択肢は1つずつ「どこが違うのか」を具体的に説明してください
- 問題文・選択肢・正解は別欄に原文どおり掲載されるので、解説では再掲せず「なぜ」に集中してください`;
    mainContentTemplate = `### なぜこれが正解？\\n（「〜だから正解は◯」のように理由から説明。原文をそのまま使わず自分の言葉で）\\n\\n### 間違い選択肢のどこが違う？\\n（各選択肢ごとに「選択肢X：〜だからNG」と1〜2文で説明）\\n\\n### 覚えるポイント\\n（この問題から持ち帰るべき核心を1〜3点）`;
  }

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

// シリーズ名のブレ吸収（同一コースが別シリーズ名で分裂するのを防ぐ）。
// ドリルのDOM「学習中のシリーズ」は末尾の「シリーズ」を落とすことがあり
// （例: 画像取込「Next.jsとデプロイシリーズ」 vs 自動取込「Next.jsとデプロイ」）、
// courseKey=`${series}__${course}` がずれて同じコースが2つに割れる。
// 既存studyLogに「末尾の"シリーズ(（…）)?"を除けば一致するシリーズ名」かつ
// 「同じコース名」のコースが一意に在れば、その正本シリーズ名にスナップする。
// （同名コースが複数シリーズにある「シリーズツアー」のような罠を避けるため
//   コース名一致を必須にし、候補が一意でないときは触らない。）
function reconcileSeriesName(log: StudyLog, series: string, course: string): string {
  const stripSeries = (s: string) => s.replace(/シリーズ(（[^）]*）)?\s*$/, "").trim();
  const key = stripSeries(series);
  const names = log.courses
    .filter((c) => c.courseName === course && stripSeries(c.seriesName) === key)
    .map((c) => c.seriesName)
    .filter((name, i, arr) => arr.indexOf(name) === i);
  return names.length === 1 ? names[0] : series;
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

    const kind = detectKind(p);
    const questionText = buildQuestionText(p, kind);

    // 用語解説と解説本文を並列生成（画像ルートと同じ構成）
    const [glossary, explanationData] = await Promise.all([
      generateGlossary(questionText),
      generateExplanation(questionText, kind),
    ]);

    // 先生ペインの構成: 問題 → 回答 → 解説 → 用語 の順。
    // 問題・回答はドリル原文のまま（AIで言い換えない）。解説・用語はAI生成。
    const explanation = [
      "## 問題",
      p.questionText.trim(),
      "",
      "## 回答",
      buildAnswerBlock(p, kind),
      "",
      "## 解説",
      (explanationData.mainContent ?? "").trim(),
      "",
      glossary.trim(), // generateGlossary が "## 用語" 見出し付きで返す
    ].join("\n").trim();

    // 永続化 studyLog に1問マージ保存（read → addToStudyLog → write）。
    // スクリプトから1問ずつ直列に呼ばれる前提（同時書き込みは想定しない）。
    const current = await readStudyLog();
    // 既存コースに合わせてシリーズ名のブレを吸収してから保存（分裂防止）
    const series = reconcileSeriesName(current, p.series, p.course);
    const lessonInfo: ExtractedLessonInfo = { series, course: p.course, lesson: p.lesson };
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
