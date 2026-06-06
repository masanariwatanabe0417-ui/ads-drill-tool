export interface DrillScreenshots {
  questionImage: string | null;
  answerImage: string | null;
  courseMapImage: string | null;
}

export type ScreenshotSlot = "question" | "answer" | "courseMap";

export interface QAEntry {
  id: string;
  question: string;
  answer: string;
  proposedAddition: string;
  approved: boolean;
}

export interface ExtractedLessonInfo {
  series: string;
  course: string;
  lesson: string;
  questionInfo: string;
}

// 階層まとめ用データ構造
export interface QuestionEntry {
  questionInfo: string;  // "Q1", "Q10" など
  keyLearning: string;   // 要点1〜2文
  explanation: string;   // 全解説テキスト
  timestamp: number;
}

export interface LessonData {
  lessonName: string;
  questions: QuestionEntry[];
}

export interface CourseData {
  courseKey: string;     // `${series}__${course}` の一意キー
  seriesName: string;
  courseName: string;
  lessons: LessonData[];
}

export interface StudyLog {
  courses: CourseData[];
}

// 先生ペインの表示モード
export type TeacherView =
  | { type: "question"; courseKey: string; lessonName: string; questionInfo: string }
  | { type: "lesson"; courseKey: string; lessonName: string }
  | { type: "course"; courseKey: string }
  | null;
