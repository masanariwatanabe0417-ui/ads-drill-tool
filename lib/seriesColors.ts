// シリーズごとのテーマ色。優先順位は「取込スクリプトが本家ドリルのDOMから収集した色
// （data/series-colors.json → /api/series-colors）」＞「下のフォールバック表」＞「名前から自動生成」。
// フォールバック表は収集が済むまでのつなぎ（本家の雰囲気に寄せた仮の配色）。
export const FALLBACK_SERIES_COLORS: Record<string, string> = {
  "Git完全マスターシリーズ": "#f05133", // Git ブランドオレンジ
  "Web開発基礎シリーズ": "#3b82f6",
  "Web開発実践シリーズ": "#6366f1",
  "UIデザイン基礎シリーズ": "#ec4899",
  "UIデザイン実践シリーズ": "#a855f7",
  "パソコンの仕組みシリーズ（GUI編）": "#14b8a6",
  "Next.jsとデプロイシリーズ": "#475569",
  "データベースの仕組みシリーズ": "#22c55e",
};

// 未知のシリーズ名にも安定した色を割り当てる（名前のハッシュ→色相）。
function hashHue(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${h}, 65%, 50%)`;
}

// シリーズの代表色を返す。collected は /api/series-colors の取得結果（無ければ省略可）。
export function seriesColor(
  seriesName: string,
  collected?: Record<string, string> | null
): string {
  return (
    collected?.[seriesName] ??
    FALLBACK_SERIES_COLORS[seriesName] ??
    hashHue(seriesName)
  );
}

// 色に透明度を付けた CSS 値（"#rrggbb" は8桁hex、hsl() は hsl()/alpha 付きに変換）。
// 行の背景や左ボーダーの薄い色付けに使う。
export function withAlpha(color: string, alpha: number): string {
  if (color.startsWith("#") && color.length === 7) {
    const a = Math.round(alpha * 255).toString(16).padStart(2, "0");
    return `${color}${a}`;
  }
  if (color.startsWith("hsl(")) {
    return color.replace("hsl(", "hsla(").replace(")", `, ${alpha})`);
  }
  return color;
}
