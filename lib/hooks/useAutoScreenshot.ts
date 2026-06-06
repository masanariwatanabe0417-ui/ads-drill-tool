import { useEffect, useRef } from "react";
import { DrillScreenshots, ScreenshotSlot } from "@/lib/types";

interface UseAutoScreenshotOptions {
  isEnabled: boolean;
  screenshots: DrillScreenshots;
  onScreenshotUpload: (type: ScreenshotSlot, dataUrl: string) => void;
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

        // ファイルを base64 で取得
        const res = await fetch(
          `/api/screenshot-file?path=${encodeURIComponent(filePath)}`
        );
        if (!res.ok) return;
        const { dataUrl } = (await res.json()) as { dataUrl: string };

        // コースマップ → 問題 → 解答 の順に振り分け
        if (!ss.courseMapImage) {
          upload("courseMap", dataUrl);
        } else if (!ss.questionImage) {
          upload("question", dataUrl);
        } else {
          upload("answer", dataUrl);
        }
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
