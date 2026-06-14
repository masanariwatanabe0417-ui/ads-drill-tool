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
  diagram?: string;      // 旧: レッスンまとめの図解（Mermaid記法）。後方互換のため残す
  diagramHtml?: string;  // レッスンまとめの図解（リッチHTML・「図解化」ボタンで生成）
}

export interface CourseData {
  courseKey: string;     // `${series}__${course}` の一意キー
  seriesName: string;
  courseName: string;
  lessons: LessonData[];
  diagram?: string;      // 旧: コースまとめの図解（Mermaid記法）。後方互換のため残す
  diagramHtml?: string;  // コースまとめの図解（リッチHTML・「図解化」ボタンで生成）
  overviewText?: string;          // コースまとめの総括（Sonnet生成・Markdown）。各問のkeyLearningを統合した「コースの幹」
  overviewQuestionCount?: number; // 総括を生成した時点の総問題数。現在の問題数がこれより増えたら自動で作り直す
}

export interface StudyLog {
  courses: CourseData[];
  glossaryOverrides?: Record<string, string>;    // term.toLowerCase() → カスタム定義文
  glossaryManualTerms?: Record<string, string>;  // 表示用term → 定義（手動追加用語）
  glossaryTermRenames?: Record<string, string>;  // 旧term.toLowerCase() → 修正後の表示用term（読み間違い等の手動修正）
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
