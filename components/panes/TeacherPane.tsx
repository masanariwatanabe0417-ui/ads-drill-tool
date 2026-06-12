"use client";

import { Loader2, GraduationCap, Clipboard, Sparkles, MessageCircle, ChevronRight, BookMarked, X, PenLine, Search, Eye, EyeOff, Pencil } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { ExtractedLessonInfo, StudyLog, TeacherView } from "@/lib/types";
import { buildGlossary, GlossaryTerm, normalizeForSearch } from "@/lib/glossary";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import { useEffect, useRef, useState } from "react";

interface TeacherPaneProps {
  studyLog: StudyLog;
  teacherView: TeacherView;
  isLoading: boolean;
  hasScreenshots: boolean;
  currentLessonInfo: ExtractedLessonInfo | null;
  error?: string | null;
  onSelectView: (view: TeacherView) => void;
  deletedGlossaryTerms?: string[];
  onDeleteGlossaryTerm?: (term: string) => void;
  onRenameGlossaryTerm?: (oldTerm: string, newTerm: string) => void;
  glossaryFocusTerm?: string | null;
  onFocusGlossaryTerm?: (term: string) => void;
}

const markdownComponents: Components = {
  h2: ({ children }) => (
    <h2 className="text-base font-semibold text-foreground border-b pb-1 mt-4 mb-2 first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-semibold text-foreground mt-3 mb-1">
      {children}
    </h3>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  code: ({ children, className }) => {
    const isBlock = className?.startsWith("language-");
    if (isBlock) {
      return (
        <code className="block bg-slate-100 rounded p-3 font-mono text-sm whitespace-pre-wrap text-slate-800">
          {children}
        </code>
      );
    }
    return (
      <code className="bg-slate-100 px-1 rounded font-mono text-xs text-slate-800">
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="bg-slate-100 rounded p-3 overflow-x-auto my-2">{children}</pre>
  ),
  ul: ({ children }) => (
    <ul className="space-y-1 my-2 pl-4 list-disc">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="space-y-1 my-2 pl-4 list-decimal">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="text-sm leading-relaxed text-foreground">{children}</li>
  ),
  p: ({ children }) => (
    <p className="text-sm leading-relaxed text-foreground my-1">{children}</p>
  ),
};

// ── ステップガイド（空状態）────────────────────────────────────────
const STEPS = [
  {
    num: "1",
    icon: Clipboard,
    title: "スクショを貼り付ける",
    desc: "「問題」枠をクリック → ⌘V で貼り付け。解答も貼ると解説の精度UP",
    text: "text-amber-600",
    bg: "bg-amber-50",
    border: "border-amber-200",
    badge: "bg-amber-100",
  },
  {
    num: "2",
    icon: Sparkles,
    title: "AI が解説を生成",
    desc: "用語解説・問題解説・ポイントまとめを 3つの AI が同時生成",
    text: "text-blue-600",
    bg: "bg-blue-50",
    border: "border-blue-200",
    badge: "bg-blue-100",
  },
  {
    num: "3",
    icon: MessageCircle,
    title: "質問して深める",
    desc: "右ペインで疑問を解消。解説への追記もワンクリック",
    text: "text-violet-600",
    bg: "bg-violet-50",
    border: "border-violet-200",
    badge: "bg-violet-100",
  },
] as const;

function StepGuide() {
  return (
    <div className="flex flex-col items-center justify-center gap-8 py-14 px-6">
      {/* ヘッダー */}
      <div className="text-center space-y-1.5">
        <div className="flex items-center justify-center gap-2">
          <GraduationCap className="h-5 w-5 text-primary" />
          <span className="text-base font-bold text-foreground">本気AIドリル</span>
        </div>
        <p className="text-sm text-muted-foreground">
          問題のスクリーンショットを貼り付けるだけで
        </p>
        <p className="text-sm font-semibold text-primary">
          AI が解説・コースまとめ・レッスンまとめを自動生成します
        </p>
      </div>

      {/* ステップカード */}
      <div className="flex items-start gap-2 w-full">
        {STEPS.map((s, i) => (
          <div key={s.num} className="flex items-start gap-2 flex-1 min-w-0">
            {/* カード */}
            <div
              className={`flex-1 min-w-0 rounded-xl border ${s.border} ${s.bg} p-3 space-y-2.5 transition-shadow hover:shadow-sm`}
            >
              {/* バッジ + アイコン */}
              <div className="flex items-center justify-between">
                <span
                  className={`inline-flex h-5 w-5 items-center justify-center rounded-full ${s.badge} text-xs font-bold ${s.text}`}
                >
                  {s.num}
                </span>
                <s.icon className={`h-3.5 w-3.5 ${s.text} opacity-50`} />
              </div>
              {/* テキスト */}
              <div className="space-y-1">
                <p className={`text-xs font-bold ${s.text}`}>{s.title}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {s.desc}
                </p>
              </div>
            </div>
            {/* 矢印 */}
            {i < STEPS.length - 1 && (
              <ChevronRight className="h-4 w-4 text-muted-foreground/30 mt-4 shrink-0" />
            )}
          </div>
        ))}
      </div>

      {/* サブヒント */}
      <p className="text-xs text-muted-foreground/60 text-center">
        左のナビゲーションで Q・レッスン・コースを切り替えてまとめを確認できます
      </p>
    </div>
  );
}

// ── 定義統合キャッシュ（localStorage） ───────────────────────────────
const CACHE_PREFIX = "glossary-consolidated:";

function cacheKey(term: string, defs: string[]): string {
  return CACHE_PREFIX + term.toLowerCase() + ":" + defs.join("|").length;
}

function loadCached(term: string, defs: string[]): string | null {
  try {
    const raw = localStorage.getItem(cacheKey(term, defs));
    if (!raw) return null;
    const { defsHash, consolidated } = JSON.parse(raw);
    return defsHash === defs.join("|") ? consolidated : null;
  } catch { return null; }
}

function saveCache(term: string, defs: string[], consolidated: string) {
  try {
    localStorage.setItem(
      cacheKey(term, defs),
      JSON.stringify({ defsHash: defs.join("|"), consolidated })
    );
  } catch {}
}

// ── 単語カード（統合ロジック付き） ──────────────────────────────────
function GlossaryCard({
  term,
  onSelectView,
  onDeleteTerm,
  onRenameTerm,
  onFocusTerm,
  isFocused,
  concealed = false,
}: {
  term: GlossaryTerm;
  onSelectView: (view: TeacherView) => void;
  onDeleteTerm: (term: string) => void;
  onRenameTerm: (oldTerm: string, newTerm: string) => void;
  onFocusTerm: (term: string) => void;
  isFocused: boolean;
  concealed?: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [termDraft, setTermDraft] = useState(term.term);

  // 暗記モードの ON/OFF が切り替わったら全カードを再び隠す
  useEffect(() => {
    setRevealed(false);
  }, [concealed]);

  const commitRename = () => {
    setEditing(false);
    const next = termDraft.trim();
    if (next && next !== term.term) onRenameTerm(term.term, next);
  };

  const [consolidated, setConsolidated] = useState<string | null>(() =>
    term.definitions.length >= 2 ? loadCached(term.term, term.definitions) : null
  );
  const [consolidating, setConsolidating] = useState(false);
  const didRun = useRef(false);

  useEffect(() => {
    if (term.definitions.length < 2) return;
    if (consolidated !== null) return;
    if (didRun.current) return;
    didRun.current = true;

    setConsolidating(true);
    fetch("/api/glossary-consolidate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ term: term.term, definitions: term.definitions }),
    })
      .then((r) => r.json())
      .then(({ consolidated: c }) => {
        if (c) {
          saveCache(term.term, term.definitions, c);
          setConsolidated(c);
        }
      })
      .finally(() => setConsolidating(false));
  }, [term, consolidated]);

  const displayDefs =
    term.definitions.length >= 2
      ? consolidated !== null
        ? [consolidated]
        : term.definitions
      : term.definitions;

  return (
    <div className={`border rounded-lg p-3 space-y-1.5 relative group ${isFocused ? "border-violet-400 bg-violet-50/40" : ""}`}>
      <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => {
            setTermDraft(term.term);
            setEditing(true);
          }}
          className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-blue-600"
          title="用語名を修正（読みの間違いなど）"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => onFocusTerm(term.term)}
          className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-violet-600"
          title="質問ペインで質問する"
        >
          <PenLine className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => onDeleteTerm(term.term)}
          className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
          title="この用語を非表示"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex items-center gap-1.5 pr-16">
        {editing ? (
          <input
            type="text"
            value={termDraft}
            autoFocus
            onChange={(e) => setTermDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setEditing(false);
            }}
            className="w-full rounded border border-blue-300 bg-background px-1.5 py-0.5 text-sm font-bold text-primary focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        ) : (
          <p className="text-sm font-bold text-primary">{term.term}</p>
        )}
        {consolidating && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />}
      </div>
      {concealed && !revealed ? (
        <button
          onClick={() => setRevealed(true)}
          className="w-full rounded-md border border-dashed border-violet-200 bg-violet-50/50 py-3 text-xs text-violet-500 hover:bg-violet-100/60 transition-colors"
        >
          クリックで意味を表示
        </button>
      ) : (
        <>
          {displayDefs.map((d, i) => (
            <p key={i} className="text-sm text-foreground leading-relaxed">{d}</p>
          ))}
          <div className="flex flex-wrap gap-1 pt-1">
            {term.occurrences.map((o) => (
              <button
                key={`${o.courseKey}__${o.lessonName}__${o.questionInfo}`}
                onClick={() =>
                  onSelectView({
                    type: "question",
                    courseKey: o.courseKey,
                    lessonName: o.lessonName,
                    questionInfo: o.questionInfo,
                  })
                }
                className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs text-blue-700 hover:bg-blue-100 transition-colors"
                title={`${o.courseName} ／ ${o.lessonName}`}
              >
                {o.lessonName} {o.questionInfo}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── 単語帳ビュー ────────────────────────────────────────────────────
function GlossaryView({
  studyLog,
  onSelectView,
  deletedTerms,
  onDeleteTerm,
  onRenameTerm,
  focusTerm,
  onFocusTerm,
}: {
  studyLog: StudyLog;
  onSelectView: (view: TeacherView) => void;
  deletedTerms: string[];
  onDeleteTerm: (term: string) => void;
  onRenameTerm: (oldTerm: string, newTerm: string) => void;
  focusTerm: string | null;
  onFocusTerm: (term: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [courseFilter, setCourseFilter] = useState<string>("all");
  const [memorizeMode, setMemorizeMode] = useState(false);

  const allTerms = buildGlossary(studyLog);
  const deletedSet = new Set(deletedTerms.map((t) => t.toLowerCase()));
  const terms = allTerms.filter((t) => !deletedSet.has(t.term.toLowerCase()));

  if (terms.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
        <BookMarked className="h-10 w-10 opacity-20" />
        <p className="text-sm">まだ用語がありません</p>
        <p className="text-xs">問題を解くと用語解説から自動で単語帳が作られます</p>
      </div>
    );
  }

  // 用語が1語以上登場するコースだけをフィルタ候補に出す
  const courses = studyLog.courses.filter((c) =>
    terms.some((t) => t.occurrences.some((o) => o.courseKey === c.courseKey))
  );

  const normalizedQuery = normalizeForSearch(query.trim());
  const filtered = terms.filter((t) => {
    if (
      courseFilter !== "all" &&
      !t.occurrences.some((o) => o.courseKey === courseFilter)
    ) {
      return false;
    }
    if (normalizedQuery) {
      const haystack = normalizeForSearch(
        [t.term, ...t.definitions].join("\n")
      );
      if (!haystack.includes(normalizedQuery)) return false;
    }
    return true;
  });

  return (
    <div className="space-y-4">
      {/* ヘッダー + 暗記モードトグル */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-foreground">単語帳</h2>
          <p className="text-xs text-muted-foreground mt-1">
            {filtered.length === terms.length
              ? `${terms.length}語`
              : `${filtered.length}語 / 全${terms.length}語`}
          </p>
        </div>
        <button
          onClick={() => setMemorizeMode((v) => !v)}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors shrink-0 ${
            memorizeMode
              ? "border-violet-300 bg-violet-100 text-violet-700"
              : "border-border bg-background text-muted-foreground hover:bg-muted"
          }`}
          title="意味を隠して暗記チェック"
        >
          {memorizeMode ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          暗記モード
        </button>
      </div>

      {/* 検索ボックス */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="用語・意味で検索（ひらがなでもOK）"
          className="w-full rounded-md border bg-background pl-8 pr-8 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-muted text-muted-foreground"
            title="クリア"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* コース別フィルタ */}
      {courses.length >= 2 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setCourseFilter("all")}
            className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
              courseFilter === "all"
                ? "border-blue-300 bg-blue-100 text-blue-700 font-medium"
                : "border-border bg-background text-muted-foreground hover:bg-muted"
            }`}
          >
            すべて
          </button>
          {courses.map((c) => (
            <button
              key={c.courseKey}
              onClick={() => setCourseFilter(c.courseKey)}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors max-w-[180px] truncate ${
                courseFilter === c.courseKey
                  ? "border-blue-300 bg-blue-100 text-blue-700 font-medium"
                  : "border-border bg-background text-muted-foreground hover:bg-muted"
              }`}
              title={c.courseName}
            >
              {c.courseName}
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-muted-foreground">
          <Search className="h-8 w-8 opacity-20" />
          <p className="text-sm">該当する用語がありません</p>
          <p className="text-xs">検索語やコースフィルタを変えてみてください</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((t) => (
            <GlossaryCard
              key={t.term}
              term={t}
              onSelectView={onSelectView}
              onDeleteTerm={onDeleteTerm}
              onRenameTerm={onRenameTerm}
              onFocusTerm={onFocusTerm}
              isFocused={focusTerm?.toLowerCase() === t.term.toLowerCase()}
              concealed={memorizeMode}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── コンテンツ描画 ──────────────────────────────────────────────────
function renderContent(
  studyLog: StudyLog,
  teacherView: TeacherView,
  onSelectView: (view: TeacherView) => void,
  deletedGlossaryTerms: string[],
  onDeleteGlossaryTerm: (term: string) => void,
  onRenameGlossaryTerm: (oldTerm: string, newTerm: string) => void,
  glossaryFocusTerm: string | null,
  onFocusGlossaryTerm: (term: string) => void
): React.ReactNode {
  if (!teacherView) return null;

  if (teacherView.type === "glossary") {
    return (
      <GlossaryView
        studyLog={studyLog}
        onSelectView={onSelectView}
        deletedTerms={deletedGlossaryTerms}
        onDeleteTerm={onDeleteGlossaryTerm}
        onRenameTerm={onRenameGlossaryTerm}
        focusTerm={glossaryFocusTerm}
        onFocusTerm={onFocusGlossaryTerm}
      />
    );
  }

  if (teacherView.type === "question") {
    const course = studyLog.courses.find((c) => c.courseKey === teacherView.courseKey);
    const lesson = course?.lessons.find((l) => l.lessonName === teacherView.lessonName);
    const q = lesson?.questions.find((q) => q.questionInfo === teacherView.questionInfo);
    const explanation = q?.explanation ?? "";
    return (
      <div className="prose-sm max-w-none">
        <ReactMarkdown components={markdownComponents}>
          {explanation}
        </ReactMarkdown>
      </div>
    );
  }

  if (teacherView.type === "lesson") {
    const course = studyLog.courses.find((c) => c.courseKey === teacherView.courseKey);
    const lesson = course?.lessons.find((l) => l.lessonName === teacherView.lessonName);
    if (!lesson) return null;
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-base font-bold text-foreground">{lesson.lessonName} まとめ</h2>
          <p className="text-xs text-muted-foreground mt-1">{lesson.questions.length}問学習済み</p>
        </div>
        <div className="space-y-3">
          {lesson.questions.map((q) => (
            <div key={q.questionInfo} className="border rounded-lg p-3 space-y-1">
              <p className="text-xs font-bold text-primary">{q.questionInfo}</p>
              <p className="text-sm text-foreground">{q.keyLearning}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (teacherView.type === "course") {
    const course = studyLog.courses.find((c) => c.courseKey === teacherView.courseKey);
    if (!course) return null;
    const totalQ = course.lessons.reduce((s, l) => s + l.questions.length, 0);
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-base font-bold text-foreground">{course.courseName} まとめ</h2>
          <p className="text-xs text-muted-foreground mt-1">
            {course.seriesName} ／ {course.lessons.length}レッスン ／ {totalQ}問学習済み
          </p>
        </div>
        {course.lessons.map((lesson) => (
          <div key={lesson.lessonName} className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground border-b pb-1">
              {lesson.lessonName}
            </h3>
            <div className="space-y-2 pl-2">
              {lesson.questions.map((q) => (
                <div key={q.questionInfo} className="flex gap-2">
                  <span className="text-xs font-bold text-primary shrink-0 w-8">{q.questionInfo}</span>
                  <p className="text-xs text-foreground leading-relaxed">{q.keyLearning}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return null;
}

export default function TeacherPane({
  studyLog,
  teacherView,
  isLoading,
  hasScreenshots,
  currentLessonInfo,
  error,
  onSelectView,
  deletedGlossaryTerms = [],
  onDeleteGlossaryTerm = () => {},
  onRenameGlossaryTerm = () => {},
  glossaryFocusTerm = null,
  onFocusGlossaryTerm = () => {},
}: TeacherPaneProps) {
  const viewLabel =
    teacherView?.type === "course"
      ? "コースまとめ"
      : teacherView?.type === "lesson"
      ? "レッスンまとめ"
      : teacherView?.type === "glossary"
      ? "単語帳"
      : teacherView?.type === "question"
      ? teacherView.questionInfo
      : null;

  return (
    <div className="flex flex-col h-full border-r">
      <div className="p-3 border-b flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <GraduationCap className="h-3.5 w-3.5 text-blue-500 shrink-0" />
          <h2 className="text-xs font-bold text-blue-600 uppercase tracking-wider shrink-0">
            先生ペイン
          </h2>
          {viewLabel && (
            <Badge variant="outline" className="text-xs shrink-0">{viewLabel}</Badge>
          )}
        </div>
        {currentLessonInfo && (
          <p className="text-xs text-muted-foreground truncate hidden sm:block">
            {currentLessonInfo.series} › {currentLessonInfo.course}
          </p>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin" />
              <p className="text-sm">スクリーンショットを読み取り中...</p>
              <p className="text-xs">シリーズ名・レッスン名・解説を同時に生成しています</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <p className="text-sm font-medium text-destructive">解析に失敗しました</p>
              <p className="text-xs text-muted-foreground max-w-xs break-all">{error}</p>
            </div>
          ) : teacherView ? (
            renderContent(studyLog, teacherView, onSelectView, deletedGlossaryTerms, onDeleteGlossaryTerm, onRenameGlossaryTerm, glossaryFocusTerm, onFocusGlossaryTerm)
          ) : (
            hasScreenshots ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
                <GraduationCap className="h-10 w-10 opacity-20" />
                <p className="text-sm">解析準備中...</p>
              </div>
            ) : (
              <StepGuide />
            )
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
