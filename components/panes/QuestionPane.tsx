"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Loader2, MessageCircle, CheckCircle2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { QAEntry } from "@/lib/types";
import { cn } from "@/lib/utils";

interface QuestionPaneProps {
  qaEntries: QAEntry[];
  isLoading: boolean;
  hasLesson: boolean;
  onAskQuestion: (question: string) => void;
  onApproveAddition: (entryId: string) => void;
}

export default function QuestionPane({
  qaEntries,
  isLoading,
  hasLesson,
  onAskQuestion,
  onApproveAddition,
}: QuestionPaneProps) {
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [qaEntries, isLoading]);

  const handleSubmit = () => {
    const q = draft.trim();
    if (!q || isLoading) return;
    onAskQuestion(q);
    setDraft("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b flex items-center gap-2">
        <MessageCircle className="h-4 w-4 text-primary" />
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          質問ペイン
        </h2>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-4">
          {qaEntries.length === 0 && !isLoading && (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-muted-foreground">
              <MessageCircle className="h-10 w-10 opacity-20" />
              <p className="text-sm">先生への質問を入力してください</p>
              <p className="text-xs">Ctrl+Enter で送信</p>
            </div>
          )}

          {qaEntries.map((entry) => (
            <div key={entry.id} className="space-y-2">
              {/* ユーザーの質問 */}
              <div className="flex justify-end">
                <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-3 py-2 max-w-[85%]">
                  <p className="text-xs whitespace-pre-wrap">{entry.question}</p>
                </div>
              </div>

              {/* 先生の回答 */}
              <div className="flex justify-start">
                <div className="bg-muted rounded-2xl rounded-tl-sm px-3 py-2 max-w-[85%] space-y-2">
                  <p className="text-xs whitespace-pre-wrap">{entry.answer}</p>

                  {entry.proposedAddition && (
                    <div className={cn(
                      "border rounded-lg p-2 space-y-1.5",
                      entry.approved ? "border-green-200 bg-green-50" : "border-blue-200 bg-blue-50"
                    )}>
                      <p className="text-xs text-muted-foreground font-medium">
                        先生ペインへの追加案：
                      </p>
                      <p className="text-xs italic text-foreground/80">
                        {entry.proposedAddition}
                      </p>
                      {entry.approved ? (
                        <Badge variant="secondary" className="text-xs gap-1 bg-green-100 text-green-700">
                          <CheckCircle2 className="h-3 w-3" />
                          追加済み
                        </Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-xs gap-1 border-blue-300 hover:bg-blue-100"
                          onClick={() => onApproveAddition(entry.id)}
                        >
                          <Plus className="h-3 w-3" />
                          先生ペインに追加
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-2xl rounded-tl-sm px-3 py-2">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      <div className="p-3 border-t space-y-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={hasLesson ? "先生への質問を入力... (Ctrl+Enter で送信)" : "先にレッスンを選択してください"}
          disabled={!hasLesson || isLoading}
          className="min-h-[72px] text-sm resize-none"
        />
        <Button
          onClick={handleSubmit}
          disabled={!draft.trim() || !hasLesson || isLoading}
          className="w-full gap-2"
          size="sm"
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          送信
        </Button>
      </div>
    </div>
  );
}
