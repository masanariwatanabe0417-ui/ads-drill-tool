"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface DrillSidePanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function DrillSidePanel({ isOpen, onClose }: DrillSidePanelProps) {
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

        {/* 案内バー */}
        <div className="px-4 py-2 bg-blue-50 border-b text-xs text-blue-700 shrink-0">
          <span className="font-bold">⌘+Shift+4</span> でスクリーンショットを撮るだけで自動取り込みされます（コースマップ → 問題 → 解答の順）
        </div>

        {/* iframe */}
        <iframe
          src="https://drill.ma-ji.ai/"
          className="flex-1 w-full border-0"
          title="本気AIドリル"
        />
      </div>
    </>
  );
}
