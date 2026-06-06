"use client";

import { useCallback, useEffect, useState } from "react";
import NavigationPane from "./panes/NavigationPane";
import ScreenshotPane from "./panes/ScreenshotPane";
import TeacherPane from "./panes/TeacherPane";
import QuestionPane from "./panes/QuestionPane";
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

  const lesson = { ...course.lessons[lessonIdx], questions: [...course.lessons[lessonIdx].questions] };
  const qIdx = lesson.questions.findIndex((q) => q.questionInfo === lessonInfo.questionInfo);
  const newQ = { questionInfo: lessonInfo.questionInfo, keyLearning, explanation, timestamp: Date.now() };
  if (qIdx === -1) {
    lesson.questions.push(newQ);
  } else {
    lesson.questions[qIdx] = newQ;
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

  const fetchTeacherExplanation = useCallback(
    async (newScreenshots: DrillScreenshots) => {
      if (!newScreenshots.questionImage) return;
      setTeacherLoading(true);
      setTeacherView(null);
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
          setStudyLog((prev) => addToStudyLog(prev, info, data.keyLearning ?? "", data.explanation));
          setTeacherView({
            type: "question",
            courseKey: makeCourseKey(info.series, info.course),
            lessonName: info.lesson,
            questionInfo: info.questionInfo,
          });
        }
      } catch (err) {
        console.error(err);
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
    (type: ScreenshotSlot, dataUrl: string) => {
      setScreenshots((prev) => ({ ...prev, [slotKey(type)]: dataUrl }));
      setQaEntries([]);
    },
    []
  );

  const handleAnalyze = useCallback(() => {
    fetchTeacherExplanation(screenshots);
  }, [fetchTeacherExplanation, screenshots]);

  // 解答がセットされたら自動解析
  useEffect(() => {
    if (screenshots.answerImage && screenshots.questionImage) {
      fetchTeacherExplanation(screenshots);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenshots.answerImage]);

  const handleScreenshotClear = useCallback((type: ScreenshotSlot) => {
    setScreenshots((prev) => ({ ...prev, [slotKey(type)]: null }));
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
      <div className="w-60 shrink-0">
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
          onAnalyze={handleAnalyze}
          disabled={teacherLoading}
        />
      </div>
      <div className="flex-1 min-w-[300px]">
        <TeacherPane
          studyLog={studyLog}
          teacherView={teacherView}
          isLoading={teacherLoading}
          currentLessonInfo={currentLessonInfo}
          hasScreenshots={!!screenshots.questionImage}
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
