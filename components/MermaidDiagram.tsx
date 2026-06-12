"use client";

import { useEffect, useId, useState } from "react";

// AIが生成したMermaid記法をSVGに描画する。
// 構文エラー時は図を出さずコード原文を折りたたみで残す（解説本文は無傷のまま）。
export default function MermaidDiagram({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const reactId = useId();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "neutral",
          fontFamily: "inherit",
        });
        // mermaid.renderのidはDOM idになるためuseIdのコロンを除去する
        const renderId = `mermaid-${reactId.replace(/[^a-zA-Z0-9]/g, "")}`;
        const { svg: rendered } = await mermaid.render(renderId, code);
        if (!cancelled) setSvg(rendered);
      } catch {
        // パース失敗時にmermaidがbodyへ残すエラー表示用要素を掃除する
        document.querySelectorAll('[id^="dmermaid-"], [id^="mermaid-"]').forEach((el) => {
          if (el.querySelector('[class*="error"]') || el.textContent?.includes("Syntax error")) {
            el.remove();
          }
        });
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, reactId]);

  if (failed) {
    return (
      <details className="my-2 rounded border border-dashed bg-slate-50 p-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer">図を表示できませんでした（クリックで元データを表示）</summary>
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono">{code}</pre>
      </details>
    );
  }

  if (!svg) {
    return (
      <div className="my-2 flex h-24 items-center justify-center rounded border border-dashed bg-slate-50 text-xs text-muted-foreground">
        図を描画中...
      </div>
    );
  }

  return (
    <div
      className="my-2 flex justify-center overflow-x-auto rounded border bg-white p-3 [&_svg]:h-auto [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
