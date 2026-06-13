import Anthropic from "@anthropic-ai/sdk";
import { buildDiagramHtml } from "./template";

const client = new Anthropic();

// 大きめのHTMLを生成するためストリーミングで受ける（タイムアウト回避）。
export const maxDuration = 60;

// レッスンまとめ／コースまとめの「図解化」ボタン用。
// 学習済みの要点（keyLearning）一覧から、前提知識がなくても腹落ちする
// リッチHTML図解を生成する（visual-explainer 方式）。
// 生成されるのは <main> 内の本文HTMLのみ。額縁は template.ts で包む。

interface DiagramSection {
  heading: string;
  points: string[];
}

const SYSTEM_PROMPT = `あなたは概念を図解するのが得意な先輩社員です。学習者が学んだ要点の一覧を受け取り、前提知識がなくても理解できる「図解HTML」を生成します。品質基準は「入社したての新卒社会人が読んでも腹落ちする明快さ」。この基準は出力に書かないこと。

# 出力形式（厳守）
- 出力は <main> タグの中に入れる本文HTMLのみ。<html>/<head>/<body>/<main> タグや説明文、コードフェンス(\`\`\`)は一切付けない。
- スタイリングは Tailwind CSS のユーティリティクラスのみで行う。<style> タグもインライン style 属性も使わない。
- 配色は次のADSテーマ用クラスを使う: bg-ads-bg, bg-ads-surface, bg-ads-hover, border-ads-border, text-ads-text, text-ads-muted, text-ads-dim, text-ads-accent, bg-ads-accent, text-ads-positive, text-ads-negative, text-ads-warning。標準のTailwind色クラスも併用可。
- アイコンは Lucide を <i data-lucide="アイコン名" class="w-5 h-5"></i> の形で使う。絵文字は使わない。
- <script> は書かない。React/JSXも使わない。外部画像URL・追加CDN・追加フォントも読み込まない。
- インタラクティブ要素（トグル・開閉・アニメーション・フォーム）は入れない。静的な図解にする。

# コンテンツの作り方
- 冒頭にヒーロー＋一枚絵サマリー: タイトル → 一言の答え（太字カード）→ それを表すコア図（アイコン＋矢印＋ラベル）→ 各論への橋渡し、を一本の流れにする。
- 概論 → 各論。いきなり詳細に入らず、全体像を見せてから個別へ。
- 専門用語は初出で必ず括弧書きで平易に解説する（例: API（ソフト同士がやり取りする窓口））。
- たとえ話で身近な体験に結びつける。
- 文字の壁を作らない。知識の種類に応じて視覚表現を選ぶ:
  - 定義 → アナロジー図（たとえの登場人物を矢印で関係づけ、主役を中央に大きく）
  - プロセス → 番号つきステップフロー（横並び、各ステップにアイコン＋一言、色を変える）
  - 比較 → 左右2カラム対比（同じ観点を同じ行に、✗/✓ や赤/緑で差を一目に）
  - 事例 → カードグリッド（2列、アイコン＋タイトル＋説明）
  - 数値 → 大きな数字カード（3カラム、text-3xl font-black、色を変える）
  - 構造/階層 → 入れ子ブロック（背景色やボーダーの濃淡で階層）
- カード等は rounded-xl, border, p-5〜p-6, gap, mb-8〜mb-12 などでゆとりを持たせ、見出しは font-bold で明確に。
- 「初心者向け」「入門」など読者のレベルを示すラベルは入れない。
- すべて日本語で書く。

# 重要
あなたは新しいトピックを調べるのではなく、学習者が「すでに学んだ要点」を整理し、全体像として腹落ちさせる図解を作る。要点どうしのつながり・流れ・対比を中心に構成すること。`;

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

    const stream = client.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 32000,
      thinking: { type: "disabled" },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `以下は「${title}」という${scopeLabel}で学んだ要点の一覧です。これらを整理して、${scopeLabel}全体の知識がひと目で腹落ちする図解HTML（<main>の中身のみ）を作ってください。

${pointsText}`,
        },
      ],
    });

    const message = await stream.finalMessage();
    const block = message.content.find((b) => b.type === "text");
    let content = block && block.type === "text" ? block.text.trim() : "";

    // 念のためコードフェンスが付いた場合は剥がす
    content = content
      .replace(/^```(?:html)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    if (!content || content.length < 50) {
      return Response.json(
        { error: "図の生成に失敗しました。もう一度お試しください" },
        { status: 500 }
      );
    }

    const html = buildDiagramHtml({ title, description: title, content });
    return Response.json({ html });
  } catch (error) {
    console.error("Diagram API error:", error);
    return Response.json({ error: "図の生成に失敗しました" }, { status: 500 });
  }
}
