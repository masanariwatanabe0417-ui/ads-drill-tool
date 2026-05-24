"use client";

import { useCallback, useEffect, useRef, useState } from "react";

function usePasteShortcut() {
  const [label, setLabel] = useState("Ctrl+V");
  useEffect(() => {
    if (/Mac|iPhone|iPad|iPod/i.test(navigator.platform)) setLabel("⌘V");
  }, []);
  return label;
}
import { Upload, X, Clipboard } from "lucide-react";
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
}: SlotCardProps) => (
  <div
    className={cn(
      "rounded-lg border-2 transition-colors cursor-pointer",
      activeSlot === type ? "border-primary" : "border-border"
    )}
    onClick={() => setActiveSlot(type)}
  >
    <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/40 rounded-t-lg">
      <span className="text-xs font-semibold">{label}</span>
      <div className="flex gap-1">
        {activeSlot === type && (
          <span className="text-xs text-primary font-medium flex items-center gap-1">
            <Clipboard className="h-3 w-3" />
            貼付先
          </span>
        )}
        {image && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onScreenshotClear(type);
            }}
            className="text-muted-foreground hover:text-destructive"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>

    {image ? (
      <div className="p-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} alt={label} className="w-full rounded object-contain max-h-64" />
      </div>
    ) : (
      <div className="flex flex-col items-center justify-center gap-2 p-6 text-center">
        <Upload className="h-8 w-8 text-muted-foreground/50" />
        <p className="text-xs text-muted-foreground">
          クリックして選択するか
          <br />
          {pasteShortcut} で貼り付け
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            setActiveSlot(type);
            inputRef.current?.click();
          }}
        >
          ファイルを選択
        </Button>
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
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          スクリーンショット
        </h2>
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
