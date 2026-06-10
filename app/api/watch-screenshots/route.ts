import { type NextRequest } from "next/server";
import chokidar from "chokidar";
import path from "path";
import os from "os";

export const runtime = "nodejs";
// SSE で接続を張り続けるルートのため、ビルド時の静的生成を禁止する
// （これがないと next build がこのルートを実行しようとしてタイムアウトで失敗する）
export const dynamic = "force-dynamic";

const DESKTOP_PATH = path.join(os.homedir(), "Desktop");

// Mac スクリーンショットのファイル名パターン
// 英語: "Screenshot 2024-01-15 at 12.34.56.png" / "Screen Shot 2024-01-15 at 1.04.56 AM.png"
// 日本語: "スクリーンショット 2024-01-15 23.01.46.png" / "スクリーンショット 2024-01-15 1.03.48.png"
// ※ 時(hour)は 0〜9時台で1桁になるため \d{1,2} で受ける（2桁固定だと深夜1時等を取りこぼす）
const MAC_SCREENSHOT_REGEX =
  /^(Screen\s?shot \d{4}-\d{2}-\d{2} at \d{1,2}\.\d{2}\.\d{2}(\s?(AM|PM))?|スクリーンショット \d{4}-\d{2}-\d{2} \d{1,2}\.\d{2}\.\d{2})\.png$/i;

export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          // クライアントが切断済み
        }
      };

      // Desktop を監視
      const watcher = chokidar.watch(DESKTOP_PATH, {
        ignoreInitial: true, // 既存ファイルは無視
        persistent: true,
        depth: 0, // Desktop 直下のみ
        awaitWriteFinish: {
          stabilityThreshold: 500, // 書き込み完了を待つ (ms)
          pollInterval: 100,
        },
      });

      watcher.on("add", (filePath: string) => {
        const fileName = path.basename(filePath);
        if (MAC_SCREENSHOT_REGEX.test(fileName)) {
          send(JSON.stringify({ filePath }));
        }
      });

      watcher.on("error", (error: unknown) => {
        console.error("[watch-screenshots] chokidar error:", error);
      });

      // keep-alive ping（30秒ごと）
      const pingInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          clearInterval(pingInterval);
        }
      }, 30_000);

      // クライアント切断時のクリーンアップ
      request.signal.addEventListener("abort", () => {
        clearInterval(pingInterval);
        watcher.close();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // nginx バッファリング無効
    },
  });
}
