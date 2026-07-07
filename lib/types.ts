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
  proposedInsight?: string;           // まとめビュー時の「気づき」提案（一人称の気づきメモ調）
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
  // "lecture" = スクール講義の疑似コース（1レッスン=文字起こしの1セクション・1問のみ）。
  // 未設定は従来どおりドリル。合計問題数の検証ではlectureを除外する。
  contentType?: "lecture";
  lessons: LessonData[];
  diagram?: string;      // 旧: コースまとめの図解（Mermaid記法）。後方互換のため残す
  diagramHtml?: string;  // コースまとめの図解（リッチHTML・「図解化」ボタンで生成）
  overviewText?: string;          // コースまとめの総括（Sonnet生成・Markdown）。各問のkeyLearningを統合した「コースの幹」
  overviewQuestionCount?: number; // 総括を生成した時点の総問題数。現在の問題数がこれより増えたら自動で作り直す
}

// 単語帳の任意範囲ハイライト（マーカー）。引用＋前後文脈でアンカーするため、
// 定義文が再生成されて文言が変わると一致しなくなり自動で外れる（＝静かに消える）。
export interface GlossaryHighlight {
  termKey: string;  // 対象の用語（term.toLowerCase()）。どのカードのハイライトか
  quote: string;    // 選択したテキストそのもの
  prefix: string;   // 直前の文脈（同じ語が複数あるときの曖昧さ回避・最大20文字）
  suffix: string;   // 直後の文脈（同上）
  color: string;    // マーカー色。当面 "yellow" 固定。将来の多色化に備えて保持
}

// まとめ（レッスン/コースまとめ）の任意範囲ハイライト。アンカーの考え方は
// GlossaryHighlight と同じ（引用＋前後文脈・再生成で外れる）。scope で対象ブロックを識別する。
export interface SummaryHighlight {
  scope: string;   // 対象ブロック。"kl:<courseKey>__<lessonName>__<questionInfo>"（keyLearning）/ "ov:<courseKey>"（総括）
  quote: string;
  prefix: string;
  suffix: string;
  color: string;   // 当面 "yellow" 固定
}

// まとめ（レッスン/コース/講義まとめ）の「自分の気づき」。Q&Aの回答からAIが提案し、
// ユーザーが承認したものだけ蓄積する。総括(overviewText)の再生成とは完全に独立。
export interface SummaryInsight {
  id: string;             // 一意ID（削除用）
  scope: string;          // 対象まとめ。"l:<courseKey>__<lessonName>"（レッスン）/ "c:<courseKey>"（コース・講義）
  text: string;           // 気づき本文（一人称の気づきメモ調・1〜3文）
  sourceQuestion: string; // きっかけになった質問の要旨（見出し表示用）
  timestamp: number;
}

export interface StudyLog {
  courses: CourseData[];
  glossaryOverrides?: Record<string, string>;    // term.toLowerCase() → カスタム定義文
  glossaryManualTerms?: Record<string, string>;  // 表示用term → 定義（手動追加用語）
  glossaryTermRenames?: Record<string, string>;  // 旧term.toLowerCase() → 修正後の表示用term（読み間違い等の手動修正）
  glossaryHighlights?: GlossaryHighlight[];       // 単語帳のマーカー（任意範囲ハイライト）
  summaryHighlights?: SummaryHighlight[];         // まとめのマーカー（任意範囲ハイライト）
  summaryInsights?: SummaryInsight[];             // まとめの「自分の気づき」（Q&Aから承認制で追記）
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
