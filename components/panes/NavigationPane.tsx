"use client";

import { useEffect, useState } from "react";
import { BookOpen, BookMarked, ChevronDown, ChevronRight, FileText, GraduationCap, Pencil } from "lucide-react";
import { StudyLog, TeacherView } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

interface NavigationPaneProps {
  studyLog: StudyLog;
  teacherView: TeacherView;
  onSelectView: (view: TeacherView) => void;
  // Q番号の手動修正（AIの読み取り誤りを直す）。courseKey/lessonName/旧Q番号/入力値 を渡す。
  onRenameQuestion: (courseKey: string, lessonName: string, oldQ: string, rawNew: string) => void;
}

// 編集中のQを一意に指すキー
type EditTarget = { courseKey: string; lessonName: string; oldQ: string };

export default function NavigationPane({ studyLog, teacherView, onSelectView, onRenameQuestion }: NavigationPaneProps) {
  const [expandedCourses, setExpandedCourses] = useState<Set<string>>(new Set());
  const [expandedLessons, setExpandedLessons] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [editValue, setEditValue] = useState("");

  const startEdit = (t: EditTarget) => {
    setEditing(t);
    setEditValue(t.oldQ.replace(/\D/g, "")); // 数字部分だけ入れておく（例：「6」）
  };
  const commitEdit = () => {
    if (editing) onRenameQuestion(editing.courseKey, editing.lessonName, editing.oldQ, editValue);
    setEditing(null);
  };
  const isEditing = (t: EditTarget) =>
    editing?.courseKey === t.courseKey && editing.lessonName === t.lessonName && editing.oldQ === t.oldQ;

  // スクショ貼り付け後、新しいQが追加されたら自動展開
  useEffect(() => {
    if (teacherView?.type === "question") {
      setExpandedCourses((prev) => {
        const next = new Set(prev);
        next.add(teacherView.courseKey);
        return next;
      });
      setExpandedLessons((prev) => {
        const next = new Set(prev);
        next.add(`${teacherView.courseKey}__${teacherView.lessonName}`);
        return next;
      });
    }
  }, [teacherView]);

  const toggleCourse = (key: string) =>
    setExpandedCourses((prev) => {
      const next = new Set(prev);
      if (next.has(key)) { next.delete(key); } else { next.add(key); }
      return next;
    });

  const toggleLesson = (key: string) =>
    setExpandedLessons((prev) => {
      const next = new Set(prev);
      if (next.has(key)) { next.delete(key); } else { next.add(key); }
      return next;
    });

  const isActive = (view: TeacherView) => {
    if (!teacherView || !view) return false;
    if (teacherView.type !== view.type) return false;
    if (teacherView.type === "course" && view.type === "course")
      return teacherView.courseKey === view.courseKey;
    if (teacherView.type === "lesson" && view.type === "lesson")
      return teacherView.courseKey === view.courseKey && teacherView.lessonName === view.lessonName;
    if (teacherView.type === "question" && view.type === "question")
      return (
        teacherView.courseKey === view.courseKey &&
        teacherView.lessonName === view.lessonName &&
        teacherView.questionInfo === view.questionInfo
      );
    return false;
  };

  return (
    <div className="flex flex-col h-full border-r bg-muted/30">
      <div className="p-3 border-b">
        <div className="flex items-center gap-1.5">
          <GraduationCap className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <p className="text-xs font-bold text-foreground">本気AIドリル</p>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">まとめ一覧</p>
      </div>

      {/* 単語帳 */}
      <div className="p-2 border-b">
        <button
          onClick={() => onSelectView({ type: "glossary" })}
          className={cn(
            "w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-left transition-colors",
            teacherView?.type === "glossary"
              ? "bg-primary text-primary-foreground"
              : "hover:bg-accent"
          )}
        >
          <BookMarked className="h-3.5 w-3.5 shrink-0" />
          <p className="text-xs font-semibold">単語帳</p>
        </button>
      </div>

      <ScrollArea className="flex-1">
        {studyLog.courses.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 px-3 text-center text-muted-foreground">
            <BookOpen className="h-8 w-8 opacity-20" />
            <p className="text-xs">
              問題スクショを貼ると<br />コース・レッスンが<br />自動で追加されます
            </p>
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {studyLog.courses.map((course) => {
              const courseView: TeacherView = { type: "course", courseKey: course.courseKey };
              const courseExpanded = expandedCourses.has(course.courseKey);
              const totalQ = course.lessons.reduce((s, l) => s + l.questions.length, 0);

              return (
                <div key={course.courseKey}>
                  {/* コースまとめ行 */}
                  <div className="flex items-center gap-0.5">
                    <button
                      onClick={() => toggleCourse(course.courseKey)}
                      className="p-1 hover:bg-accent rounded"
                    >
                      {courseExpanded
                        ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                        : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                    </button>
                    <button
                      onClick={() => onSelectView(courseView)}
                      className={cn(
                        "flex-1 flex items-center gap-1.5 px-1.5 py-1.5 rounded-md text-left transition-colors",
                        isActive(courseView)
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-accent"
                      )}
                    >
                      <GraduationCap className="h-3.5 w-3.5 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold truncate">{course.seriesName}</p>
                        <p className="text-xs truncate opacity-80">{course.courseName}</p>
                        <p className="text-xs opacity-60">{totalQ}問学習済み</p>
                      </div>
                    </button>
                  </div>

                  {/* レッスン一覧 */}
                  {courseExpanded && (
                    <div className="ml-5 space-y-0.5">
                      {course.lessons.map((lesson) => {
                        const lessonKey = `${course.courseKey}__${lesson.lessonName}`;
                        const lessonView: TeacherView = {
                          type: "lesson",
                          courseKey: course.courseKey,
                          lessonName: lesson.lessonName,
                        };
                        const lessonExpanded = expandedLessons.has(lessonKey);

                        return (
                          <div key={lesson.lessonName}>
                            {/* レッスンまとめ行 */}
                            <div className="flex items-center gap-0.5">
                              <button
                                onClick={() => toggleLesson(lessonKey)}
                                className="p-1 hover:bg-accent rounded"
                              >
                                {lessonExpanded
                                  ? <ChevronDown className="h-3 w-3 text-muted-foreground" />
                                  : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                              </button>
                              <button
                                onClick={() => onSelectView(lessonView)}
                                className={cn(
                                  "flex-1 flex items-center gap-1.5 px-1.5 py-1.5 rounded-md text-left transition-colors",
                                  isActive(lessonView)
                                    ? "bg-primary text-primary-foreground"
                                    : "hover:bg-accent"
                                )}
                              >
                                <BookOpen className="h-3 w-3 shrink-0" />
                                <div className="min-w-0">
                                  <p className="text-xs leading-tight">{lesson.lessonName}</p>
                                  <p className="text-xs opacity-60">{lesson.questions.length}問</p>
                                </div>
                              </button>
                            </div>

                            {/* Q一覧 */}
                            {lessonExpanded && (
                              <div className="ml-5 space-y-0.5">
                                {lesson.questions.map((q) => {
                                  const qView: TeacherView = {
                                    type: "question",
                                    courseKey: course.courseKey,
                                    lessonName: lesson.lessonName,
                                    questionInfo: q.questionInfo,
                                  };
                                  const target: EditTarget = {
                                    courseKey: course.courseKey,
                                    lessonName: lesson.lessonName,
                                    oldQ: q.questionInfo,
                                  };
                                  if (isEditing(target)) {
                                    return (
                                      <div
                                        key={q.questionInfo}
                                        className="flex items-center gap-1 px-2 py-1.5"
                                      >
                                        <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
                                        <span className="text-xs text-muted-foreground">Q</span>
                                        <input
                                          autoFocus
                                          type="text"
                                          inputMode="numeric"
                                          value={editValue}
                                          onChange={(e) => setEditValue(e.target.value)}
                                          onKeyDown={(e) => {
                                            if (e.key === "Enter") commitEdit();
                                            else if (e.key === "Escape") setEditing(null);
                                          }}
                                          onBlur={commitEdit}
                                          className="w-12 text-xs border rounded px-1 py-0.5 bg-background"
                                        />
                                        <span className="text-[10px] text-muted-foreground">Enterで確定</span>
                                      </div>
                                    );
                                  }
                                  return (
                                    <div key={q.questionInfo} className="group flex items-start">
                                      <button
                                        onClick={() => onSelectView(qView)}
                                        className={cn(
                                          "flex-1 min-w-0 flex items-start gap-1.5 px-2 py-1.5 rounded-md text-left transition-colors",
                                          isActive(qView)
                                            ? "bg-primary text-primary-foreground"
                                            : "hover:bg-accent"
                                        )}
                                      >
                                        <FileText className="h-3 w-3 shrink-0 mt-0.5" />
                                        <div className="min-w-0">
                                          <p className="text-xs font-medium">{q.questionInfo}</p>
                                          <p className="text-xs opacity-70 line-clamp-2">{q.keyLearning}</p>
                                        </div>
                                      </button>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); startEdit(target); }}
                                        title="Q番号を修正"
                                        className="p-1 mt-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-accent shrink-0"
                                      >
                                        <Pencil className="h-3 w-3 text-muted-foreground" />
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
