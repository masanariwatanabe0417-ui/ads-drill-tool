"use client";

import { useEffect, useState } from "react";

// 同一idでの同時renderはmermaidが衝突するため、呼び出しごとに一意のidを振る
// （React StrictModeでeffectが2回走っても安全にする）
let renderSeq = 0;

// AIが生成したMermaid記法をSVGに描画する。
// 構文エラー時は図を出さずコード原文とエラー内容を折りたたみで残す（解説本文は無傷のまま）。
export default function MermaidDiagram({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const renderId = `mermaid-r${++renderSeq}`;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "neutral",
          fontFamily: "inherit",
        });
        const { svg: rendered } = await mermaid.render(renderId, code);
        if (!cancelled) {
          setSvg(rendered);
          setErrorMsg(null);
        }
      } catch (err) {
        console.error("Mermaid render error:", err);
        // パース失敗時にmermaidがbodyへ残すエラー表示用要素を掃除する
        document.getElementById(renderId)?.remove();
        document.getElementById(`d${renderId}`)?.remove();
        if (!cancelled) setErrorMsg(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (errorMsg) {
    return (
      <details className="my-2 rounded border border-dashed bg-slate-50 p-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer">図を表示できませんでした（クリックで詳細を表示）</summary>
        <p className="mt-2 text-red-600 break-all">{errorMsg}</p>
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
