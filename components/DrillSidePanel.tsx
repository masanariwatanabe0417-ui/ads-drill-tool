"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X, Camera, ScreenShare, CircleStop } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { ScreenshotSlot } from "@/lib/types";

interface DrillSidePanelProps {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (type: ScreenshotSlot, dataUrl: string, sourcePath?: string | null) => void;
}

export default function DrillSidePanel({ isOpen, onClose, onCapture }: DrillSidePanelProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stopShare = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setSharing(false);
  }, []);

  // パネルを閉じたら共有も止める
  useEffect(() => {
    if (!isOpen && sharing) stopShare();
  }, [isOpen, sharing, stopShare]);

  // アンマウント時の後始末
  useEffect(() => () => stopShare(), [stopShare]);

  const startShare = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        // 現在のタブを優先選択（Chrome）。型に無いので any キャスト
        ...( { preferCurrentTab: true } as object ),
        video: { frameRate: 5 },
        audio: false,
      });
      streamRef.current = stream;

      let video = videoRef.current;
      if (!video) {
        video = document.createElement("video");
        video.muted = true;
        video.playsInline = true;
        videoRef.current = video;
      }
      video.srcObject = stream;
      await video.play();

      // ユーザーがブラウザUIから共有を止めた場合
      stream.getVideoTracks()[0].addEventListener("ended", () => stopShare());

      setSharing(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "共有を開始できませんでした");
      setSharing(false);
    }
  }, [stopShare]);

  const capture = useCallback(
    async (type: ScreenshotSlot) => {
      const video = videoRef.current;
      const iframe = iframeRef.current;
      if (!video || !iframe || !streamRef.current) return;

      const rect = iframe.getBoundingClientRect();
      // タブキャプチャの実ピクセル ÷ タブのCSS幅 = スケール（≒devicePixelRatio）
      const scaleX = video.videoWidth / window.innerWidth;
      const scaleY = video.videoHeight / window.innerHeight;

      const sx = Math.max(0, Math.round(rect.left * scaleX));
      const sy = Math.max(0, Math.round(rect.top * scaleY));
      const sw = Math.round(rect.width * scaleX);
      const sh = Math.round(rect.height * scaleY);

      const canvas = document.createElement("canvas");
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);

      const dataUrl = canvas.toDataURL("image/png");

      // ディスクにも一時保存し、そのパスを sourcePath として渡す。
      // これで解説生成成功後に rename-imported が整理フォルダへ移動・保存する
      // （＝⌘+Shift+4 と同じ保存挙動になる）。保存に失敗しても取り込み自体は続行。
      let sourcePath: string | null = null;
      try {
        const res = await fetch("/api/save-capture", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dataUrl, slot: type }),
        });
        if (res.ok) sourcePath = (await res.json()).path ?? null;
      } catch {
        // 保存に失敗してもメモリ上の取り込みは行う
      }

      onCapture(type, dataUrl, sourcePath);
    },
    [onCapture]
  );

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      )}

      <div
        className={cn(
          "fixed top-0 right-0 z-50 h-full w-[600px] bg-background shadow-2xl border-l flex flex-col transition-transform duration-300",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30 shrink-0">
          <span className="text-sm font-bold text-foreground">本気AIドリル</span>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* キャプチャ操作バー（実験） */}
        <div className="px-3 py-2 border-b bg-amber-50 shrink-0 space-y-1.5">
          {!sharing ? (
            <Button
              variant="outline"
              className="w-full h-8 text-xs gap-1"
              onClick={startShare}
            >
              <ScreenShare className="h-3.5 w-3.5" />
              撮影を開始（このタブを共有を選択）
            </Button>
          ) : (
            <>
              <div className="flex gap-1.5">
                <Button
                  variant="outline"
                  className="flex-1 h-8 text-xs gap-1"
                  onClick={() => capture("courseMap")}
                >
                  <Camera className="h-3.5 w-3.5" />
                  コースマップ
                </Button>
                <Button
                  variant="outline"
                  className="flex-1 h-8 text-xs gap-1"
                  onClick={() => capture("question")}
                >
                  <Camera className="h-3.5 w-3.5" />
                  問題
                </Button>
                <Button
                  variant="outline"
                  className="flex-1 h-8 text-xs gap-1"
                  onClick={() => capture("answer")}
                >
                  <Camera className="h-3.5 w-3.5" />
                  解答
                </Button>
              </div>
              <Button
                variant="ghost"
                className="w-full h-7 text-xs gap-1 text-muted-foreground"
                onClick={stopShare}
              >
                <CircleStop className="h-3.5 w-3.5" />
                撮影を停止
              </Button>
            </>
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        {/* iframe */}
        <iframe
          ref={iframeRef}
          src="https://drill.ma-ji.ai/"
          className="flex-1 w-full border-0"
          title="本気AIドリル"
        />
      </div>
    </>
  );
}
