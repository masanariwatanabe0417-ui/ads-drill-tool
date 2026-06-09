"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAutoScreenshot } from "@/lib/hooks/useAutoScreenshot";
import { Upload, X, Clipboard, Camera, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DrillScreenshots, ScreenshotSlot } from "@/lib/types";
import { cn } from "@/lib/utils";

function usePasteShortcut() {
  const [label, setLabel] = useState("Ctrl+V");
  useEffect(() => {
    if (/Mac|iPhone|iPad|iPod/i.test(navigator.platform)) setLabel("⌘V");
  }, []);
  return label;
}

interface ScreenshotPaneProps {
  screenshots: DrillScreenshots;
  onScreenshotUpload: (
    type: ScreenshotSlot,
    dataUrl: string,
    sourcePath?: string | null
  ) => void;
  onScreenshotClear: (type: ScreenshotSlot) => void;
  onNextQuestion: () => void;
  onOpenDrill: () => void;
  disabled: boolean;
  isAutoEnabled: boolean;
  onAutoToggle: (enabled: boolean) => void;
}

// 画像を最大幅 1200px・JPEG 85% に圧縮してから base64 化
const resizeAndEncode = (blob: Blob, maxWidth = 1200): Promise<string> =>
  new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.src = url;
  });

interface SlotCardProps {
  type: ScreenshotSlot;
  label: string;
  image: string | null;
  inputRef: React.RefObject<HTMLInputElement>;
  activeSlot: ScreenshotSlot;
  setActiveSlot: (slot: ScreenshotSlot) => void;
  onScreenshotClear: (type: ScreenshotSlot) => void;
  disabled: boolean;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>, type: ScreenshotSlot) => void;
  pasteShortcut: string;
}

const SlotCard = ({
  type,
  label,
  image,
  inputRef,
  activeSlot,
  setActiveSlot,
  onScreenshotClear,
  disabled,
  onFileChange,
  pasteShortcut,
}: SlotCardProps) => {
  const isActive = activeSlot === type;

  return (
    <div
      className={cn(
        "group rounded-lg border-2 transition-all duration-150 cursor-pointer",
        isActive
          ? "border-primary ring-2 ring-primary/20"
          : "border-border hover:border-muted-foreground/50 hover:shadow-sm"
      )}
      onClick={() => setActiveSlot(type)}
    >
      {/* ヘッダー */}
      <div
        className={cn(
          "flex items-center justify-between px-3 py-1.5 border-b rounded-t-lg transition-colors",
          isActive ? "bg-primary/10" : "bg-muted/40 group-hover:bg-muted/70"
        )}
      >
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "text-xs font-bold transition-colors",
              isActive ? "text-primary" : "text-foreground"
            )}
          >
            {label}
          </span>
          {isActive && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold text-primary">
              <Clipboard className="h-2.5 w-2.5" />
              貼付先
            </span>
          )}
        </div>
        {image && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onScreenshotClear(type);
            }}
            className="text-muted-foreground hover:text-destructive transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* コンテンツ */}
      {image ? (
        <div className="p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image} alt={label} className="w-full rounded object-contain max-h-48" />
        </div>
      ) : (
        <div
          className={cn(
            "m-2 rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-2 p-4 text-center transition-all duration-150",
            isActive
              ? "border-primary/40 bg-primary/5"
              : "border-muted-foreground/20 bg-transparent opacity-50 group-hover:opacity-80 group-hover:border-muted-foreground/40 group-hover:bg-muted/20"
          )}
        >
          <Upload
            className={cn(
              "h-6 w-6 transition-colors",
              isActive ? "text-primary/60" : "text-muted-foreground/40 group-hover:text-muted-foreground/70"
            )}
          />
          {isActive ? (
            <>
              <p className="text-xs text-muted-foreground leading-relaxed">
                <span className="font-semibold text-primary">{pasteShortcut}</span>{" "}
                で今ここに貼り付け
                <br />
                またはファイルを選択
              </p>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={disabled}
                onClick={(e) => {
                  e.stopPropagation();
                  inputRef.current?.click();
                }}
              >
                ファイルを選択
              </Button>
            </>
          ) : (
            <p className="text-xs text-muted-foreground/70 group-hover:text-muted-foreground transition-colors">
              クリックして切り替え
            </p>
          )}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onFileChange(e, type)}
      />
    </div>
  );
};

export default function ScreenshotPane({
  screenshots,
  onScreenshotUpload,
  onScreenshotClear,
  onNextQuestion,
  onOpenDrill,
  disabled,
  isAutoEnabled,
  onAutoToggle,
}: ScreenshotPaneProps) {
  const [activeSlot, setActiveSlot] = useState<ScreenshotSlot>("courseMap");
  const questionInputRef = useRef<HTMLInputElement>(null);
  const answerInputRef = useRef<HTMLInputElement>(null);
  const courseMapInputRef = useRef<HTMLInputElement>(null);
  const pasteShortcut = usePasteShortcut();

  // コースマップが埋まったら自動で「問題」へフォーカス移動
  // （Q2以降はコースマップが既に入っているので、初回マウント時も同様に動作）
  useEffect(() => {
    if (screenshots.courseMapImage && activeSlot === "courseMap") {
      setActiveSlot("question");
    }
  }, [screenshots.courseMapImage]); // eslint-disable-line react-hooks/exhaustive-deps

  // Desktop フォルダ監視・自動取り込み
  useAutoScreenshot({
    isEnabled: isAutoEnabled,
    screenshots,
    onScreenshotUpload,
  });

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>, type: ScreenshotSlot) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const dataUrl = await resizeAndEncode(file);
      onScreenshotUpload(type, dataUrl);
      e.target.value = "";
    },
    [onScreenshotUpload]
  );

  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) =>
        i.type.startsWith("image/")
      );
      if (!item) return;
      const blob = item.getAsFile();
      if (!blob) return;
      const dataUrl = await resizeAndEncode(blob);
      onScreenshotUpload(activeSlot, dataUrl);
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [activeSlot, onScreenshotUpload]);

  return (
    <div className="flex flex-col h-full border-r">
      <div className="p-3 border-b">
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-1.5">
            <Camera className="h-3.5 w-3.5 text-amber-500 shrink-0" />
            <h2 className="text-xs font-bold text-amber-600 uppercase tracking-wider">
              スクリーンショット
            </h2>
          </div>
          {/* 自動取り込みトグル */}
          <button
            onClick={() => onAutoToggle(!isAutoEnabled)}
            title="Desktop の新しいスクリーンショットを自動取り込み"
            className={cn(
              "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold transition-colors",
              isAutoEnabled
                ? "bg-green-100 text-green-700 hover:bg-green-200"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            )}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full transition-colors",
                isAutoEnabled ? "animate-pulse bg-green-500" : "bg-muted-foreground/40"
              )}
            />
            自動取込
          </button>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {isAutoEnabled
            ? "Desktop のスクショを自動検出中..."
            : `枠をクリック → ${pasteShortcut} で貼り付け`}
        </p>
        {/* ドリルを開く / 次の問題へ */}
        <div className="flex gap-1.5 mt-2">
          <Button
            variant="outline"
            className="flex-1 h-8 text-xs gap-1"
            onClick={onOpenDrill}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            ドリルを開く
          </Button>
          <Button
            variant="outline"
            className="flex-1 h-8 text-xs font-bold"
            disabled={!screenshots.questionImage || disabled}
            onClick={onNextQuestion}
          >
            次の問題へ
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-3">
          <SlotCard
            type="courseMap"
            label="コースマップ"
            image={screenshots.courseMapImage}
            inputRef={courseMapInputRef}
            activeSlot={activeSlot}
            setActiveSlot={setActiveSlot}
            onScreenshotClear={onScreenshotClear}
            disabled={disabled}
            onFileChange={handleFileChange}
            pasteShortcut={pasteShortcut}
          />
          <SlotCard
            type="question"
            label="問題"
            image={screenshots.questionImage}
            inputRef={questionInputRef}
            activeSlot={activeSlot}
            setActiveSlot={setActiveSlot}
            onScreenshotClear={onScreenshotClear}
            disabled={disabled}
            onFileChange={handleFileChange}
            pasteShortcut={pasteShortcut}
          />
          <SlotCard
            type="answer"
            label="解答"
            image={screenshots.answerImage}
            inputRef={answerInputRef}
            activeSlot={activeSlot}
            setActiveSlot={setActiveSlot}
            onScreenshotClear={onScreenshotClear}
            disabled={disabled}
            onFileChange={handleFileChange}
            pasteShortcut={pasteShortcut}
          />
        </div>
      </ScrollArea>
    </div>
  );
}
