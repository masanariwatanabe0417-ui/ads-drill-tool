"use client";

import { Loader2, GraduationCap, Clipboard, Sparkles, MessageCircle, ChevronRight } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { ExtractedLessonInfo, StudyLog, TeacherView } from "@/lib/types";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";

interface TeacherPaneProps {
  studyLog: StudyLog;
  teacherView: TeacherView;
  isLoading: boolean;
  hasScreenshots: boolean;
  currentLessonInfo: ExtractedLessonInfo | null;
  error?: string | null;
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

// ── コンテンツ描画 ──────────────────────────────────────────────────
function renderContent(studyLog: StudyLog, teacherView: TeacherView): React.ReactNode {
  if (!teacherView) return null;

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
}: TeacherPaneProps) {
  const viewLabel =
    teacherView?.type === "course"
      ? "コースまとめ"
      : teacherView?.type === "lesson"
      ? "レッスンまとめ"
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
            renderContent(studyLog, teacherView)
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
