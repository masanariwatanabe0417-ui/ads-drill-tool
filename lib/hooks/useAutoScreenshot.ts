import { useEffect, useRef } from "react";
import { DrillScreenshots, ScreenshotSlot } from "@/lib/types";

interface UseAutoScreenshotOptions {
  isEnabled: boolean;
  screenshots: DrillScreenshots;
  onScreenshotUpload: (
    type: ScreenshotSlot,
    dataUrl: string,
    movedPath?: string | null
  ) => void;
}

/**
 * Desktop フォルダを SSE で監視し、新しい Mac スクリーンショットを
 * 問題 → 解答 の順に自動取り込みする hook。
 */
export function useAutoScreenshot({
  isEnabled,
  screenshots,
  onScreenshotUpload,
}: UseAutoScreenshotOptions) {
  const eventSourceRef = useRef<EventSource | null>(null);

  // screenshots / onScreenshotUpload が変わっても最新値を参照できるよう ref に保持
  const latestRef = useRef({ screenshots, onScreenshotUpload });
  latestRef.current = { screenshots, onScreenshotUpload };

  useEffect(() => {
    if (!isEnabled) {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      return;
    }

    // 既に接続中なら何もしない
    if (eventSourceRef.current) return;

    const es = new EventSource("/api/watch-screenshots");
    eventSourceRef.current = es;

    es.onmessage = async (event) => {
      try {
        const { filePath } = JSON.parse(event.data) as { filePath: string };
        const { screenshots: ss, onScreenshotUpload: upload } = latestRef.current;

        // 全スロットが埋まっていたら取り込まない
        if (ss.courseMapImage && ss.questionImage && ss.answerImage) return;

        // 役割（コースマップ → 問題 → 解答）を先に確定し、改名に使う
        const slot: ScreenshotSlot = !ss.courseMapImage
          ? "courseMap"
          : !ss.questionImage
          ? "question"
          : "answer";

        // ファイルを base64 で取得（役割を渡し、取込済みフォルダで「役割_日時」に改名させる）
        const res = await fetch(
          `/api/screenshot-file?path=${encodeURIComponent(filePath)}&slot=${slot}`
        );
        if (!res.ok) return;
        const { dataUrl, movedPath } = (await res.json()) as {
          dataUrl: string;
          movedPath?: string | null;
        };

        upload(slot, dataUrl, movedPath ?? null);
      } catch {
        // ping メッセージなど JSON でないイベントは無視
      }
    };

    es.onerror = () => {
      console.error("[useAutoScreenshot] SSE connection error");
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [isEnabled]);
}
