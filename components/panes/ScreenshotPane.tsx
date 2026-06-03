"use client";

import { useCallback, useEffect, useRef, useState } from "react";

function usePasteShortcut() {
  const [label, setLabel] = useState("Ctrl+V");
  useEffect(() => {
    if (/Mac|iPhone|iPad|iPod/i.test(navigator.platform)) setLabel("⌘V");
  }, []);
  return label;
}
import { Upload, X, Clipboard, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DrillScreenshots } from "@/lib/types";
import { cn } from "@/lib/utils";

interface ScreenshotPaneProps {
  screenshots: DrillScreenshots;
  onScreenshotUpload: (type: "question" | "answer", dataUrl: string) => void;
  onScreenshotClear: (type: "question" | "answer") => void;
  disabled: boolean;
}

const toBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

interface SlotCardProps {
  type: "question" | "answer";
  label: string;
  image: string | null;
  inputRef: React.RefObject<HTMLInputElement>;
  activeSlot: "question" | "answer";
  setActiveSlot: (slot: "question" | "answer") => void;
  onScreenshotClear: (type: "question" | "answer") => void;
  disabled: boolean;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>, type: "question" | "answer") => void;
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
          isActive
            ? "bg-primary/10"
            : "bg-muted/40 group-hover:bg-muted/70"
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
          <img src={image} alt={label} className="w-full rounded object-contain max-h-64" />
        </div>
      ) : (
        <div
          className={cn(
            "m-2 rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-2 p-5 text-center transition-all duration-150",
            isActive
              ? "border-primary/40 bg-primary/5"
              : "border-muted-foreground/20 bg-transparent opacity-50 group-hover:opacity-80 group-hover:border-muted-foreground/40 group-hover:bg-muted/20"
          )}
        >
          <Upload
            className={cn(
              "h-7 w-7 transition-colors",
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
  disabled,
}: ScreenshotPaneProps) {
  const [activeSlot, setActiveSlot] = useState<"question" | "answer">("question");
  const questionInputRef = useRef<HTMLInputElement>(null);
  const answerInputRef = useRef<HTMLInputElement>(null);
  const pasteShortcut = usePasteShortcut();

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>, type: "question" | "answer") => {
      const file = e.target.files?.[0];
      if (!file) return;
      const dataUrl = await toBase64(file);
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
      const dataUrl = await toBase64(blob);
      onScreenshotUpload(activeSlot, dataUrl);
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [activeSlot, onScreenshotUpload]);

  return (
    <div className="flex flex-col h-full border-r">
      <div className="p-3 border-b">
        <div className="flex items-center gap-1.5">
          <Camera className="h-3.5 w-3.5 text-amber-500 shrink-0" />
          <h2 className="text-xs font-bold text-amber-600 uppercase tracking-wider">
            スクリーンショット
          </h2>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          枠をクリック → {pasteShortcut} で貼り付け
        </p>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-3">
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
