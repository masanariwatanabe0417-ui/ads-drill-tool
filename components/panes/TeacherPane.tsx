"use client";

import { Loader2, GraduationCap } from "lucide-react";
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
          <GraduationCap className="h-4 w-4 text-primary shrink-0" />
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider shrink-0">
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
          ) : teacherView ? (
            renderContent(studyLog, teacherView)
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-muted-foreground">
              <GraduationCap className="h-12 w-12 opacity-20" />
              {hasScreenshots ? (
                <p className="text-sm">解析中...</p>
              ) : (
                <>
                  <p className="text-sm font-medium">問題のスクリーンショットを貼り付けると</p>
                  <p className="text-sm text-primary font-medium">
                    AIが解説・コースまとめ・レッスンまとめを<br />自動で生成します
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    左のナビゲーションでQ・レッスン・コースを<br />クリックして切り替えられます
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
