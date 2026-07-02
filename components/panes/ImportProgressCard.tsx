"use client";

import { useEffect, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Hand } from "lucide-react";
import { cn } from "@/lib/utils";

// 取込スクリプトの進捗（/api/import-progress 経由で .import-progress.json を読む）。
// フィールドはすべて任意（scripts/progress-report.mjs 参照）。
export interface ImportProgress {
  phase?: string; // waiting-q1 | waiting-user | importing | review | course-done | done | error
  waiting?: boolean; // true=🟢ユーザー操作待ち / false=⏳自動処理中
  series?: string;
  course?: string;
  lesson?: string;
  question?: string;
  total?: number | null;
  savedLesson?: number;
  savedTotal?: number;
  message?: string;
  recentLogs?: string[];
  updatedAt?: string;
}

// 進捗ファイルの鮮度がこの時間を超えたら「動いていない」扱いで非表示にする
const HIDE_AFTER_MS = 6 * 60 * 60 * 1000; // 6時間
// 自動処理中なのに更新が止まったら警告（スクリプトが固まった/落ちた可能性）
const STALE_WARN_MS = 90 * 1000;

export function useImportProgress(pollMs = 3000) {
  const [progress, setProgress] = useState<ImportProgress | null>(null);

  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/import-progress");
        const json = await res.json();
        if (stopped) return;
        if (!json?.exists || !json.data?.updatedAt) { setProgress(null); return; }
        const age = Date.now() - new Date(json.data.updatedAt).getTime();
        setProgress(age > HIDE_AFTER_MS ? null : json.data);
      } catch {
        if (!stopped) setProgress(null);
      }
    };
    tick();
    const t = setInterval(tick, pollMs);
    return () => { stopped = true; clearInterval(t); };
  }, [pollMs]);

  return progress;
}

function ageLabel(updatedAt?: string): { text: string; stale: boolean } {
  if (!updatedAt) return { text: "", stale: false };
  const ms = Date.now() - new Date(updatedAt).getTime();
  const stale = ms > STALE_WARN_MS;
  if (ms < 10_000) return { text: "たった今", stale };
  if (ms < 60_000) return { text: `${Math.round(ms / 1000)}秒前`, stale };
  if (ms < 3_600_000) return { text: `${Math.round(ms / 60_000)}分前`, stale };
  return { text: `${Math.round(ms / 3_600_000)}時間前`, stale };
}

export default function ImportProgressCard({ progress }: { progress: ImportProgress }) {
  const p = progress;
  const done = p.phase === "done" || p.phase === "course-done";
  const error = p.phase === "error";
  const waiting = !!p.waiting && !done && !error;
  const age = ageLabel(p.updatedAt);
  // 自動処理中に更新が止まった＝スクリプト停止の可能性（done/error/操作待ちでは正常）
  const maybeDead = age.stale && !waiting && !done && !error;

  const qNum = parseInt((p.question || "").replace(/\D/g, ""), 10) || 0;
  const pct = p.total && qNum ? Math.min(100, Math.round((qNum / p.total) * 100)) : null;

  return (
    <div
      className={cn(
        "rounded-lg border-2 p-2.5 space-y-1.5",
        error ? "border-destructive/50 bg-destructive/5"
          : waiting ? "border-green-500/60 bg-green-50"
          : done ? "border-border bg-muted/30"
          : "border-blue-400/50 bg-blue-50/50"
      )}
    >
      {/* 状態バッジ */}
      <div className="flex items-center justify-between gap-1">
        <span className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold",
          error ? "bg-destructive/15 text-destructive"
            : waiting ? "bg-green-100 text-green-700"
            : done ? "bg-muted text-muted-foreground"
            : "bg-blue-100 text-blue-700"
        )}>
          {error ? <AlertTriangle className="h-3 w-3" />
            : waiting ? <Hand className="h-3 w-3" />
            : done ? <CheckCircle2 className="h-3 w-3" />
            : <Activity className="h-3 w-3 animate-pulse" />}
          {error ? "エラー停止" : waiting ? "🟢 操作待ち" : done ? "完了" : "⏳ 自動処理中"}
        </span>
        <span className="text-[10px] text-muted-foreground">{age.text}</span>
      </div>

      {maybeDead && (
        <p className="text-[11px] font-semibold text-amber-600">
          ⚠ 更新が {age.text} から止まっています（スクリプト停止の可能性）
        </p>
      )}

      {/* 取り込み対象 */}
      {(p.course || p.lesson) && (
        <div className="text-[11px] leading-snug text-foreground/80">
          {p.series && <p className="truncate font-semibold">{p.series}</p>}
          {p.course && <p className="truncate">{p.course}</p>}
          {p.lesson && <p className="truncate text-muted-foreground">{p.lesson}</p>}
        </div>
      )}

      {/* 問題の進捗バー */}
      {pct !== null && (
        <div className="space-y-0.5">
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>{p.question}/{p.total}</span>
            <span>
              保存 {p.savedLesson ?? 0}問{p.savedTotal ? `（累計 ${p.savedTotal}）` : ""}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {/* 人間向けメッセージ */}
      {p.message && <p className="text-[11px] leading-snug">{p.message}</p>}

      {/* 復習中などの直近ログ（あれば最新2行だけ） */}
      {(p.recentLogs?.length ?? 0) > 0 && p.phase === "review" && (
        <div className="text-[10px] text-muted-foreground leading-snug space-y-0.5">
          {p.recentLogs!.slice(-2).map((l, i) => (
            <p key={i} className="truncate">{l}</p>
          ))}
        </div>
      )}
    </div>
  );
}
