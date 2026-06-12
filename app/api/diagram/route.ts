import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

// レッスンまとめ／コースまとめの「図解化」ボタン用。
// 学習済みの要点（keyLearning）一覧から全体像のMermaid図を生成する。
// structured outputs（output_config.format）でJSONの妥当性をAPIレベルで保証する。

interface DiagramSection {
  heading: string;
  points: string[];
}

export async function POST(req: Request) {
  try {
    const { scope, title, sections } = (await req.json()) as {
      scope: "lesson" | "course";
      title: string;
      sections: DiagramSection[];
    };

    if (!title || !Array.isArray(sections) || sections.length === 0) {
      return Response.json({ error: "図解する要点がありません" }, { status: 400 });
    }

    const pointsText = sections
      .map((s) =>
        [`【${s.heading}】`, ...s.points.map((p) => `- ${p}`)].join("\n")
      )
      .join("\n\n");

    const scopeLabel = scope === "course" ? "コース" : "レッスン";
    const maxNodes = scope === "course" ? "6〜14" : "4〜10";

    const message = await client.beta.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1536,
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              mermaid: {
                type: "string",
                description: "Mermaid記法の図",
              },
            },
            required: ["mermaid"],
            additionalProperties: false,
          },
        },
      },
      messages: [
        {
          role: "user",
          content: `あなたは概念を図解するのが得意な先輩社員です。
以下は「${title}」という${scopeLabel}で学んだ要点の一覧です。
個々の要点をそのまま並べるのではなく、概念どうしのつながり・流れ・対比を整理して、
${scopeLabel}全体の知識の地図がひと目でわかるMermaid図を1つ作ってください。

${pointsText}

Mermaid記法の厳守ルール（構文エラーで表示できなくなるため必ず守る）：
- 1行目は flowchart TD または flowchart LR のみ
- ノードは必ず id["ラベル"] の形式（ラベルはダブルクォートで囲む）
- ラベル内にダブルクォートと括弧記号 ( ) は使わない（補足は 全角括弧（） を使う）
- 矢印は --> または -->|"ラベル"| のみ
- グループ化したいときは subgraph sg1["タイトル"] ... end の形式（idは英数字）
- スタイル指定・class・click は使わない
- ノード数は${maxNodes}個に収める

内容ルール：
- 「何が何のためにあり、どうつながるか」という関係性を中心に描く
- 英語・コード用語にはカタカナを補足（例：branch（ブランチ））
- ラベルは短く（15文字以内目安）`,
        },
      ],
    });

    const block = message.content.find((b) => b.type === "text");
    const raw = block && block.type === "text" ? block.text : "{}";
    let mermaid = "";
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed.mermaid === "string") mermaid = parsed.mermaid.trim();
    } catch {}

    // flowchart宣言で始まらない出力は描画できないため失敗扱いにする
    if (!/^flowchart\s+(TD|LR|TB|RL|BT)\b/.test(mermaid)) {
      return Response.json(
        { error: "図の生成に失敗しました。もう一度お試しください" },
        { status: 500 }
      );
    }

    return Response.json({ mermaid });
  } catch (error) {
    console.error("Diagram API error:", error);
    return Response.json({ error: "図の生成に失敗しました" }, { status: 500 });
  }
}
