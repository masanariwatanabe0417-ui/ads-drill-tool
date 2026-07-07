"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Loader2, MessageCircle, CheckCircle2, Plus, X, BookMarked, PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { QAEntry } from "@/lib/types";

import { cn } from "@/lib/utils";

interface QuestionPaneProps {
  qaEntries: QAEntry[];
  isLoading: boolean;
  // 先生ペインに何か表示中（ナビ選択 or スクショ貼付）なら質問できる
  canAsk: boolean;
  onAskQuestion: (question: string) => void;
  onApproveAddition: (entryId: string) => void;
  // まとめビューの「気づき」提案を承認して気づき欄に追加
  onApproveInsight: (entryId: string) => void;
  // 単語帳モード
  glossaryFocusTerm?: string | null;
  glossaryQaEntries?: QAEntry[];
  glossaryQaLoading?: boolean;
  onAskGlossaryQuestion?: (question: string) => void;
  onSaveGlossaryDefinition?: (term: string, definition: string) => void;
  onAddNewGlossaryTerm?: (entryId: string, term: string, definition: string) => void;
  onClearGlossaryFocus?: () => void;
}

export default function QuestionPane({
  qaEntries,
  isLoading,
  canAsk,
  onAskQuestion,
  onApproveAddition,
  onApproveInsight,
  glossaryFocusTerm,
  glossaryQaEntries = [],
  glossaryQaLoading = false,
  onAskGlossaryQuestion,
  onSaveGlossaryDefinition,
  onAddNewGlossaryTerm,
  onClearGlossaryFocus,
}: QuestionPaneProps) {
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const isGlossaryMode = !!glossaryFocusTerm;
  const activeEntries = isGlossaryMode ? glossaryQaEntries : qaEntries;
  const activeLoading = isGlossaryMode ? glossaryQaLoading : isLoading;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeEntries, activeLoading]);

  // 単語帳モード切替時にdraftをリセット
  useEffect(() => {
    setDraft("");
  }, [glossaryFocusTerm]);

  const handleSubmit = () => {
    const q = draft.trim();
    if (!q || activeLoading) return;
    if (isGlossaryMode) {
      onAskGlossaryQuestion?.(q);
    } else {
      onAskQuestion(q);
    }
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
      {/* ヘッダー */}
      <div className="p-3 border-b flex items-center gap-2">
        <MessageCircle className="h-3.5 w-3.5 text-violet-500 shrink-0" />
        <h2 className="text-xs font-bold text-violet-600 uppercase tracking-wider shrink-0">
          質問ペイン
        </h2>
        {isGlossaryMode && (
          <>
            <Badge variant="outline" className="text-xs gap-1 border-violet-300 text-violet-700 shrink-0">
              <BookMarked className="h-3 w-3" />
              {glossaryFocusTerm}
            </Badge>
            <button
              onClick={onClearGlossaryFocus}
              className="ml-auto p-0.5 rounded hover:bg-muted text-muted-foreground"
              title="単語帳モードを終了"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>

      {/* チャット履歴 */}
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-4">
          {activeEntries.length === 0 && !activeLoading && (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-muted-foreground">
              <MessageCircle className="h-10 w-10 opacity-20" />
              {isGlossaryMode ? (
                <>
                  <p className="text-sm font-medium text-violet-600">「{glossaryFocusTerm}」について質問</p>
                  <p className="text-xs">「もっと詳しく」「具体例を教えて」など<br/>Ctrl+Enter で送信</p>
                </>
              ) : canAsk ? (
                <>
                  <p className="text-sm">表示中の内容について質問できます</p>
                  <p className="text-xs">Ctrl+Enter で送信</p>
                </>
              ) : (
                <>
                  <p className="text-sm">ナビで問題やまとめを選ぶと質問できます</p>
                </>
              )}
            </div>
          )}

          {activeEntries.map((entry) => (
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

                  {/* 通常モード：解説追加案 */}
                  {!isGlossaryMode && entry.proposedAddition && (
                    <div className={cn(
                      "border rounded-lg p-2 space-y-1.5",
                      entry.approved ? "border-green-200 bg-green-50" : "border-blue-200 bg-blue-50"
                    )}>
                      <p className="text-xs text-muted-foreground font-medium">💡 つまずき補強の提案：</p>
                      <p className="text-xs italic text-foreground/80">{entry.proposedAddition}</p>
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

                  {/* 通常モード（まとめビュー）：気づき追加案 */}
                  {!isGlossaryMode && entry.proposedInsight && (
                    <div className={cn(
                      "border rounded-lg p-2 space-y-1.5",
                      entry.approved ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"
                    )}>
                      <p className="text-xs text-muted-foreground font-medium">💭 気づきの提案：</p>
                      <p className="text-xs italic text-foreground/80">{entry.proposedInsight}</p>
                      {entry.approved ? (
                        <Badge variant="secondary" className="text-xs gap-1 bg-green-100 text-green-700">
                          <CheckCircle2 className="h-3 w-3" />
                          追加済み
                        </Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-xs gap-1 border-amber-300 hover:bg-amber-100 text-amber-800"
                          onClick={() => onApproveInsight(entry.id)}
                        >
                          <Plus className="h-3 w-3" />
                          気づきとして追加
                        </Button>
                      )}
                    </div>
                  )}

                  {/* 単語帳モード：定義登録案 */}
                  {isGlossaryMode && entry.proposedDefinition && (
                    <div className={cn(
                      "border rounded-lg p-2 space-y-1.5",
                      entry.approved ? "border-green-200 bg-green-50" : "border-violet-200 bg-violet-50"
                    )}>
                      <p className="text-xs text-muted-foreground font-medium">定義の改善案：</p>
                      <p className="text-xs italic text-foreground/80">{entry.proposedDefinition}</p>
                      {entry.approved ? (
                        <Badge variant="secondary" className="text-xs gap-1 bg-green-100 text-green-700">
                          <CheckCircle2 className="h-3 w-3" />
                          登録済み
                        </Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-xs gap-1 border-violet-300 hover:bg-violet-100 text-violet-700"
                          onClick={() =>
                            onSaveGlossaryDefinition?.(glossaryFocusTerm!, entry.proposedDefinition!)
                          }
                        >
                          <BookMarked className="h-3 w-3" />
                          単語帳に登録
                        </Button>
                      )}
                    </div>
                  )}

                  {/* 単語帳モード：新規用語の追加提案 */}
                  {isGlossaryMode && (entry.newTermSuggestions ?? []).length > 0 && (
                    <div className="border border-blue-200 bg-blue-50 rounded-lg p-2 space-y-1.5">
                      <p className="text-xs text-muted-foreground font-medium">関連用語を単語帳に追加：</p>
                      {(entry.newTermSuggestions ?? []).map((s) => {
                        const alreadyAdded = (entry.approvedNewTerms ?? []).includes(s.term);
                        return (
                          <div key={s.term} className="space-y-0.5">
                            <p className="text-xs font-semibold text-blue-800">{s.term}</p>
                            <p className="text-xs text-foreground/70 italic">{s.definition}</p>
                            {alreadyAdded ? (
                              <Badge variant="secondary" className="text-xs gap-1 bg-green-100 text-green-700">
                                <CheckCircle2 className="h-3 w-3" />
                                追加済み
                              </Badge>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 text-xs gap-1 border-blue-300 hover:bg-blue-100 text-blue-700"
                                onClick={() => onAddNewGlossaryTerm?.(entry.id, s.term, s.definition)}
                              >
                                <PlusCircle className="h-3 w-3" />
                                「{s.term}」を追加
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}

          {activeLoading && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-2xl rounded-tl-sm px-3 py-2">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* 入力欄 */}
      <div className="p-3 border-t space-y-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            isGlossaryMode
              ? `「${glossaryFocusTerm}」について質問... (Ctrl+Enter で送信)`
              : canAsk
              ? "表示中の内容について質問... (Ctrl+Enter で送信)"
              : "ナビで問題やまとめを選ぶと質問できます"
          }
          disabled={(!canAsk && !isGlossaryMode) || activeLoading}
          className="min-h-[72px] text-sm resize-none"
        />
        <Button
          onClick={handleSubmit}
          disabled={!draft.trim() || ((!canAsk && !isGlossaryMode) || activeLoading)}
          className={cn("w-full gap-2", isGlossaryMode && "bg-violet-600 hover:bg-violet-700")}
          size="sm"
        >
          {activeLoading ? (
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
