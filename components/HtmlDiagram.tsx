"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";

// AIが生成した自己完結HTML図解を iframe(srcDoc) で安全に表示する。
// 額縁内のスクリプトが postMessage で実高さを送ってくるので、それに合わせて伸縮させる。
// 「別タブで開く」でフルサイズ表示＋PDF保存（額縁内のPDFボタン）ができる。
export default function HtmlDiagram({ html }: { html: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(480);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const data = e.data;
      if (data && data.type === "ads-diagram-height" && typeof data.height === "number") {
        // 余白ぶん少しだけ足す
        setHeight(Math.max(240, Math.ceil(data.height) + 8));
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  function openInNewTab() {
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    // すぐ revoke すると一部ブラウザで開けないため、少し待ってから解放
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  return (
    <div className="my-2">
      <div className="flex justify-end print:hidden">
        <button
          onClick={openInNewTab}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-blue-700 transition-colors"
          title="別タブでフルサイズ表示・PDF保存"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          別タブで開く / PDF
        </button>
      </div>
      <iframe
        ref={iframeRef}
        srcDoc={html}
        title="図解"
        sandbox="allow-scripts allow-popups allow-modals allow-downloads"
        className="w-full rounded-lg border bg-white"
        style={{ height }}
      />
    </div>
  );
}
