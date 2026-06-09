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
  proposedDefinition?: string;        // 単語帳モード時の提案定義
  newTermSuggestions?: NewTermSuggestion[]; // 回答中に出てきた新規登録候補用語
  approvedNewTerms?: string[];        // 登録済み新規用語のterm一覧
  approved: boolean;
}

export interface ExtractedLessonInfo {
  series: string;
  course: string;
  lesson: string;
}

// 階層まとめ用データ構造
export interface QuestionEntry {
  questionInfo: string;   // "Q1", "Q10" など（ドリル本来のQ番号）
  keyLearning: string;    // 要点1〜2文
  explanation: string;    // 全解説テキスト
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
  glossaryOverrides?: Record<string, string>;    // term.toLowerCase() → カスタム定義文
  glossaryManualTerms?: Record<string, string>;  // 表示用term → 定義（手動追加用語）
}

export interface NewTermSuggestion {
  term: string;
  definition: string;
}

// 先生ペインの表示モード
export type TeacherView =
  | { type: "question"; courseKey: string; lessonName: string; questionInfo: string }
  | { type: "lesson"; courseKey: string; lessonName: string }
  | { type: "course"; courseKey: string }
  | { type: "glossary" }
  | null;
