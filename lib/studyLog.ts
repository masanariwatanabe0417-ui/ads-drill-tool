import { CourseData, ExtractedLessonInfo, StudyLog } from "./types";

// `${series}__${course}` の一意キー。クライアント(DrillTool)とサーバ(import-question)の双方で使う。
export function makeCourseKey(series: string, course: string): string {
  return `${series}__${course}`;
}

// 1問分を StudyLog にマージする純関数。
// - 同じ courseKey / lessonName / questionInfo があれば上書き、無ければ追加
// - レッスンは "Lesson N" 番号順、問題は Q番号順にソート
// 画像取り込み(DrillTool)とテキスト自動取り込み(import-question API)で共有する。
export function addToStudyLog(
  log: StudyLog,
  lessonInfo: ExtractedLessonInfo,
  questionInfo: string,
  keyLearning: string,
  explanation: string
): StudyLog {
  const courseKey = makeCourseKey(lessonInfo.series, lessonInfo.course);
  const courses: CourseData[] = [...log.courses];

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
  return { ...log, courses };
}
