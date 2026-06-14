import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

// コースまとめの「総括」生成用。
// 各レッスンの要点（keyLearning）一覧を受け取り、重複を畳んで
// 「このコースで結局おさえるべき幹」を数行のMarkdownで返す（Sonnet）。
// 図解（/api/diagram）の文章版。出力が短いので非ストリーミング。

interface OverviewSection {
  heading: string;
  points: string[];
}

const SYSTEM_PROMPT = `あなたは学習内容を総括するのが得意な先輩社員です。学習者が1問ずつ学んだ要点（keyLearning）の一覧を受け取り、コース全体を貫く「幹」を抽出して短くまとめます。品質基準は「入社したての新卒社会人が読んで、コースの本質がひと言で腹落ちする」こと。この基準は出力に書かないこと。

# やること
- 要点どうしの重複・言い換えを畳む（同じことを別の言葉で言っている要点はまとめて1つにする）。
- コース全体を貫く「幹」を2〜4点に絞って抽出する。個々の問題の細部ではなく、横断する本質を書く。
- 各レッスンがその幹のどこに位置づくかが伝わるようにする。
- 学習者自身の言葉で噛み砕く。ドリル原文や要点の文をそのままコピーしない。
- 英語・コード用語が出たら直後にカタカナ読みを括弧で補足（例：merge(マージ)）。ただし既にカタカナの外来語（ブランチ・リモート等）には読み仮名を付けない。日本語の意味で補足したい場合のみ括弧を使う（例：コンフリクト(競合)）。同じ語を二重に括弧補足しない。

# 出力形式（厳守）
- Markdownのみを返す。コードフェンス(\`\`\`)や前置き・あいさつは書かない。
- 次の構成にする：
## このコースの幹
（コース全体を1〜2文で言い切るリード文）

- **（幹1の短い見出し）**：1〜2文の説明
- **（幹2の短い見出し）**：1〜2文の説明
- （必要なら幹3・幹4まで。多くても4つ）
- 全体で本文200〜350字程度に収める。長くしすぎない。
- すべて日本語で書く。`;

export async function POST(req: Request) {
  try {
    const { title, sections } = (await req.json()) as {
      title: string;
      sections: OverviewSection[];
    };

    if (!title || !Array.isArray(sections) || sections.length === 0) {
      return Response.json({ error: "総括する要点がありません" }, { status: 400 });
    }

    const pointsText = sections
      .map((s) =>
        [`【${s.heading}】`, ...s.points.map((p) => `- ${p}`)].join("\n")
      )
      .join("\n\n");

    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      thinking: { type: "disabled" },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `以下は「${title}」というコースで、レッスンごとに学んだ要点の一覧です。これらを統合して、コース全体の「幹」がひと目で腹落ちする総括をMarkdownで書いてください。

${pointsText}`,
        },
      ],
    });

    const block = message.content.find((b) => b.type === "text");
    let overview = block && block.type === "text" ? block.text.trim() : "";
    // 念のためコードフェンスが付いた場合は剥がす
    overview = overview
      .replace(/^```(?:markdown)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    if (!overview || overview.length < 20) {
      return Response.json(
        { error: "総括の生成に失敗しました。もう一度お試しください" },
        { status: 500 }
      );
    }

    return Response.json({ overview });
  } catch (error) {
    console.error("Overview API error:", error);
    return Response.json({ error: "総括の生成に失敗しました" }, { status: 500 });
  }
}
