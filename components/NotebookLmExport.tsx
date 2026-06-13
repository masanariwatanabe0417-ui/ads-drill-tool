"use client";

import { Headphones, Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// ── まとめを NotebookLM へ「投げる」ボタン（純コピー方式・自動操作なし）──
// クリックで (1)最適化したソース文をクリップボードにコピー (2)NotebookLMを新規タブで開く。
// あとはユーザーが NotebookLM 上で 新規作成→コピーしたテキスト→⌘V→挿入→音声解説 するだけ。
// 自動操作を一切しないので壊れない・ログイン/ToS非依存。

interface NotebookLmExportProps {
  /** NotebookLM で付けるおすすめノート名（表示してユーザーが手入力する） */
  notebookName: string;
  /** NotebookLM にソースとして貼り付けるまとめ本文 */
  sourceText: string;
}

const NOTEBOOKLM_URL = "https://notebooklm.google.com/";

export default function NotebookLmExport({ notebookName, sourceText }: NotebookLmExportProps) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const handleClick = async () => {
    // ポップアップブロック回避のため、クリック直後に同期でタブを開く
    window.open(NOTEBOOKLM_URL, "_blank", "noopener,noreferrer");
    try {
      await navigator.clipboard.writeText(sourceText);
    } catch {
      // クリップボード不可時もタブは開いているので手動コピーへ誘導
    }
    setDone(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone(false), 12000);
  };

  return (
    <div className="relative shrink-0 print:hidden">
      <button
        onClick={handleClick}
        className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-100 transition-colors"
        title="まとめをコピーしてNotebookLMを開きます（高品質な音声解説を作成）"
      >
        {done ? <Check className="h-3.5 w-3.5" /> : <Headphones className="h-3.5 w-3.5" />}
        {done ? "コピー完了" : "音声化(NotebookLM)"}
      </button>

      {done && (
        <div className="absolute right-0 top-full z-20 mt-2 w-72 rounded-lg border bg-popover p-3 text-xs text-popover-foreground shadow-lg">
          <p className="font-semibold text-foreground">✅ まとめをコピーしました</p>
          <p className="mt-1 text-muted-foreground">
            開いた NotebookLM のタブで、次の順に操作してください：
          </p>
          <ol className="mt-1.5 list-decimal space-y-0.5 pl-4 text-muted-foreground">
            <li>「ノートブックを新規作成」</li>
            <li>「コピーしたテキスト」</li>
            <li>
              <kbd className="rounded border bg-muted px-1">⌘V</kbd> で貼り付け →「挿入」
            </li>
            <li>Studio の「音声解説」をクリック</li>
          </ol>
          <div className="mt-2 rounded border bg-muted/50 p-2">
            <span className="text-muted-foreground">おすすめノート名：</span>
            <br />
            <span className="font-medium text-foreground break-all">{notebookName}</span>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            ※ 音声が英語になる場合は ⚙️設定 →「出力言語」→ 日本語 に。
          </p>
        </div>
      )}
    </div>
  );
}
