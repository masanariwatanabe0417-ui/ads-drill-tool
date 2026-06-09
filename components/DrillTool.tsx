"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import NavigationPane from "./panes/NavigationPane";
import ScreenshotPane from "./panes/ScreenshotPane";
import TeacherPane from "./panes/TeacherPane";
import QuestionPane from "./panes/QuestionPane";
import DrillSidePanel from "./DrillSidePanel";
import {
  DrillScreenshots,
  ExtractedLessonInfo,
  QAEntry,
  ScreenshotSlot,
  StudyLog,
  TeacherView,
} from "@/lib/types";

function makeCourseKey(series: string, course: string) {
  return `${series}__${course}`;
}

function addToStudyLog(
  log: StudyLog,
  lessonInfo: ExtractedLessonInfo,
  questionInfo: string,
  keyLearning: string,
  explanation: string
): StudyLog {
  const courseKey = makeCourseKey(lessonInfo.series, lessonInfo.course);
  const courses = [...log.courses];

  let courseIdx = courses.findIndex((c) => c.courseKey === courseKey);
  if (courseIdx === -1) {
    courses.push({
      courseKey,
      seriesName: lessonInfo.series,
      courseName: lessonInfo.course,
      lessons: [],
    });
    courseIdx = courses.length - 1;
  }

  const course = { ...courses[courseIdx], lessons: [...courses[courseIdx].lessons] };
  let lessonIdx = course.lessons.findIndex((l) => l.lessonName === lessonInfo.lesson);
  if (lessonIdx === -1) {
    course.lessons.push({ lessonName: lessonInfo.lesson, questions: [] });
    lessonIdx = course.lessons.length - 1;
  }

  // レッスンを Lesson 番号順にソート
  course.lessons.sort((a, b) => {
    const n = (s: string) => parseInt(s.match(/Lesson\s*(\d+)/i)?.[1] ?? "9999", 10);
    return n(a.lessonName) - n(b.lessonName);
  });
  lessonIdx = course.lessons.findIndex((l) => l.lessonName === lessonInfo.lesson);

  const lesson = { ...course.lessons[lessonIdx], questions: [...course.lessons[lessonIdx].questions] };
  const entry = { questionInfo, keyLearning, explanation, timestamp: Date.now() };
  const existingIdx = lesson.questions.findIndex((q) => q.questionInfo === questionInfo);
  if (existingIdx !== -1) {
    lesson.questions[existingIdx] = entry;
  } else {
    lesson.questions.push(entry);
    lesson.questions.sort((a, b) => {
      const n = (s: string) => parseInt(s.replace(/\D/g, ""), 10) || 0;
      return n(a.questionInfo) - n(b.questionInfo);
    });
  }

  course.lessons[lessonIdx] = lesson;
  courses[courseIdx] = course;
  return { courses };
}

function findExplanation(studyLog: StudyLog, view: TeacherView): string {
  if (view?.type !== "question") return "";
  const course = studyLog.courses.find((c) => c.courseKey === view.courseKey);
  const lesson = course?.lessons.find((l) => l.lessonName === view.lessonName);
  const q = lesson?.questions.find((q) => q.questionInfo === view.questionInfo);
  return q?.explanation ?? "";
}

export default function DrillTool() {
  const [screenshots, setScreenshots] = useState<DrillScreenshots>({
    questionImage: null,
    answerImage: null,
    courseMapImage: null,
  });
  const [currentLessonInfo, setCurrentLessonInfo] = useState<ExtractedLessonInfo | null>(null);
  const [studyLog, setStudyLog] = useState<StudyLog>({ courses: [] });
  const [teacherView, setTeacherView] = useState<TeacherView>(null);
  const [teacherLoading, setTeacherLoading] = useState(false);
  const [qaEntries, setQaEntries] = useState<QAEntry[]>([]);
  const [questionLoading, setQuestionLoading] = useState(false);
  const [teacherError, setTeacherError] = useState<string | null>(null);
  const [isDrillPanelOpen, setIsDrillPanelOpen] = useState(false);
  const [isAutoEnabled, setIsAutoEnabled] = useState(false);
  // 案B: 自動取込で移動済みファイルの絶対パス（解説生成後にLesson名・Q番号で改名）
  const [importedFiles, setImportedFiles] = useState<Partial<Record<ScreenshotSlot, string>>>({});
  const importedFilesRef = useRef(importedFiles);
  importedFilesRef.current = importedFiles;

  // 起動時に保存済み studyLog を読み込む
  useEffect(() => {
    fetch("/api/study-log")
      .then((r) => r.json())
      .then((data) => { if (data?.courses) setStudyLog(data); })
      .catch(() => {});
  }, []);

  // studyLog が変化したら JSON に保存
  const studyLogRef = useRef(studyLog);
  studyLogRef.current = studyLog;
  useEffect(() => {
    if (studyLog.courses.length === 0) return;
    fetch("/api/study-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(studyLog),
    }).catch(() => {});
  }, [studyLog]);

  const fetchTeacherExplanation = useCallback(
    async (newScreenshots: DrillScreenshots) => {
      if (!newScreenshots.questionImage) return;
      setTeacherLoading(true);
      setTeacherView(null);
      setTeacherError(null);
      try {
        const res = await fetch("/api/teacher", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            questionImageDataUrl: newScreenshots.questionImage,
            answerImageDataUrl: newScreenshots.answerImage,
            courseMapImageDataUrl: newScreenshots.courseMapImage,
          }),
        });
        if (!res.ok) {
          const errText = await res.text();
          throw new Error(errText);
        }
        const data = await res.json();
        if (data.lessonInfo && data.explanation) {
          const info: ExtractedLessonInfo = data.lessonInfo;
          setCurrentLessonInfo(info);
          const courseKey = makeCourseKey(info.series, info.course);
          // ドリル本来のQ番号を使用。取得できなければ既存件数+1でフォールバック
          const drillQ: string | null = data.lessonInfo.questionNumber ?? null;
          let assignedQuestionInfo = drillQ ?? "Q?";
          if (!drillQ) {
            const existingLesson = studyLogRef.current.courses
              .find((c) => c.courseKey === courseKey)
              ?.lessons.find((l) => l.lessonName === info.lesson);
            assignedQuestionInfo = `Q${(existingLesson?.questions.length ?? 0) + 1}`;
          }
          setStudyLog((prev) =>
            addToStudyLog(prev, info, assignedQuestionInfo, data.keyLearning ?? "", data.explanation)
          );
          setTeacherView({
            type: "question",
            courseKey,
            lessonName: info.lesson,
            questionInfo: assignedQuestionInfo,
          });
          // 案B: 取り込んだファイルを「Lesson_タイトル_Q_役割」に改名
          const filesToRename = importedFilesRef.current;
          if (Object.keys(filesToRename).length > 0) {
            fetch("/api/rename-imported", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                files: filesToRename,
                course: info.course,
                lesson: info.lesson,
                questionInfo: assignedQuestionInfo,
              }),
            }).catch(() => {});
            setImportedFiles({});
          }
        }
      } catch (err) {
        console.error(err);
        setTeacherError(err instanceof Error ? err.message : "解析中にエラーが発生しました");
      } finally {
        setTeacherLoading(false);
      }
    },
    []
  );

  const slotKey = (type: ScreenshotSlot): keyof DrillScreenshots =>
    type === "question" ? "questionImage"
    : type === "answer" ? "answerImage"
    : "courseMapImage";

  const handleScreenshotUpload = useCallback(
    (type: ScreenshotSlot, dataUrl: string, movedPath?: string | null) => {
      setScreenshots((prev) => ({ ...prev, [slotKey(type)]: dataUrl }));
      if (movedPath) {
        setImportedFiles((prev) => ({ ...prev, [type]: movedPath }));
      }
      setQaEntries([]);
    },
    []
  );

  // 次の問題へ：問題・解答スロットをクリア（コースマップは維持）
  const handleNextQuestion = useCallback(() => {
    setScreenshots((prev) => ({ ...prev, questionImage: null, answerImage: null }));
    setImportedFiles((prev) => ({ courseMap: prev.courseMap }));
    setTeacherView(null);
    setQaEntries([]);
  }, []);

  // 解答がセットされたら自動解析
  useEffect(() => {
    if (screenshots.answerImage && screenshots.questionImage) {
      fetchTeacherExplanation(screenshots);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenshots.answerImage]);

  const handleScreenshotClear = useCallback((type: ScreenshotSlot) => {
    setScreenshots((prev) => ({ ...prev, [slotKey(type)]: null }));
    setImportedFiles((prev) => {
      const next = { ...prev };
      delete next[type];
      return next;
    });
    if (type === "question") {
      setTeacherView(null);
      setCurrentLessonInfo(null);
    }
  }, []);

  const handleAskQuestion = useCallback(
    async (question: string) => {
      setQuestionLoading(true);
      try {
        const res = await fetch("/api/question", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question,
            questionImageDataUrl: screenshots.questionImage,
            answerImageDataUrl: screenshots.answerImage,
            currentExplanation: findExplanation(studyLog, teacherView),
            lessonTitle: currentLessonInfo
              ? `${currentLessonInfo.series} ${currentLessonInfo.course} - ${currentLessonInfo.lesson}`
              : "不明",
          }),
        });
        if (!res.ok) {
          const errText = await res.text();
          throw new Error(errText);
        }
        const data = await res.json();
        const entry: QAEntry = {
          id: Date.now().toString(),
          question,
          answer: data.answer || "回答を取得できませんでした",
          proposedAddition: data.proposedAddition || "",
          approved: false,
        };
        setQaEntries((prev) => [...prev, entry]);
      } catch (err) {
        console.error(err);
      } finally {
        setQuestionLoading(false);
      }
    },
    [screenshots, teacherView, studyLog, currentLessonInfo]
  );

  const handleApproveAddition = useCallback(
    (entryId: string) => {
      const entry = qaEntries.find((e) => e.id === entryId);
      if (entry?.proposedAddition && teacherView?.type === "question") {
        const { courseKey, lessonName, questionInfo } = teacherView;
        setStudyLog((prev) => {
          const courses = prev.courses.map((c) => {
            if (c.courseKey !== courseKey) return c;
            return {
              ...c,
              lessons: c.lessons.map((l) => {
                if (l.lessonName !== lessonName) return l;
                return {
                  ...l,
                  questions: l.questions.map((q) => {
                    if (q.questionInfo !== questionInfo) return q;
                    return { ...q, explanation: `${q.explanation}\n\n---\n${entry.proposedAddition}` };
                  }),
                };
              }),
            };
          });
          return { courses };
        });
      }
      setQaEntries((prev) =>
        prev.map((e) => (e.id === entryId ? { ...e, approved: true } : e))
      );
    },
    [qaEntries, teacherView]
  );

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <DrillSidePanel
        isOpen={isDrillPanelOpen}
        onClose={() => setIsDrillPanelOpen(false)}
      />
      <div className="w-72 shrink-0">
        <NavigationPane
          studyLog={studyLog}
          teacherView={teacherView}
          onSelectView={setTeacherView}
        />
      </div>
      <div className="w-72 shrink-0">
        <ScreenshotPane
          screenshots={screenshots}
          onScreenshotUpload={handleScreenshotUpload}
          onScreenshotClear={handleScreenshotClear}
          onNextQuestion={handleNextQuestion}
          onOpenDrill={() => { setIsDrillPanelOpen(true); setIsAutoEnabled(true); }}
          disabled={teacherLoading}
          isAutoEnabled={isAutoEnabled}
          onAutoToggle={setIsAutoEnabled}
        />
      </div>
      <div className="flex-1 min-w-[300px]">
        <TeacherPane
          studyLog={studyLog}
          teacherView={teacherView}
          isLoading={teacherLoading}
          error={teacherError}
          currentLessonInfo={currentLessonInfo}
          hasScreenshots={!!screenshots.questionImage}
          onSelectView={setTeacherView}
        />
      </div>
      <div className="w-80 shrink-0">
        <QuestionPane
          qaEntries={qaEntries}
          isLoading={questionLoading}
          hasLesson={!!screenshots.questionImage}
          onAskQuestion={handleAskQuestion}
          onApproveAddition={handleApproveAddition}
        />
      </div>
    </div>
  );
}
