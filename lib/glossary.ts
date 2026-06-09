import { StudyLog } from "./types";

// 単語帳の1エントリ
export interface GlossaryOccurrence {
  courseKey: string;
  courseName: string;
  lessonName: string;
  questionInfo: string;
}

export interface GlossaryTerm {
  term: string; // 例: "マージ(merge)"
  definitions: string[]; // 同一用語が複数問題で別の説明を持つ場合に備えて配列
  occurrences: GlossaryOccurrence[]; // この用語が登場した問題（関連問題へのジャンプ用）
}

// explanation 本文から「## 用語解説」セクションの用語行を抽出する。
// 形式: "- 用語(カタカナ): 説明" / "- 用語：説明"（コロンは半角/全角どちらも）
function parseGlossaryLines(explanation: string): { term: string; definition: string }[] {
  const lines = explanation.split("\n");
  const result: { term: string; definition: string }[] = [];
  let inSection = false;

  for (const line of lines) {
    const heading = line.match(/^\s*#{2,3}\s*(.+?)\s*$/);
    if (heading) {
      // 「用語解説」を含む見出しでセクション開始、それ以外の見出しで終了
      inSection = /用語/.test(heading[1]);
      continue;
    }
    if (!inSection) continue;

    const item = line.match(/^\s*[-*]\s*(.+?)\s*[:：]\s*(.+?)\s*$/);
    if (item) {
      const term = item[1].trim();
      const definition = item[2].trim();
      if (term) result.push({ term, definition });
    }
  }
  return result;
}

// studyLog 全体を走査して用語ごとに集約した単語帳を作る（追加API不要）。
export function buildGlossary(studyLog: StudyLog): GlossaryTerm[] {
  const map = new Map<string, GlossaryTerm>();

  for (const course of studyLog.courses) {
    for (const lesson of course.lessons) {
      for (const q of lesson.questions) {
        for (const { term, definition } of parseGlossaryLines(q.explanation)) {
          const key = term.toLowerCase();
          let entry = map.get(key);
          if (!entry) {
            entry = { term, definitions: [], occurrences: [] };
            map.set(key, entry);
          }
          if (definition && !entry.definitions.includes(definition)) {
            entry.definitions.push(definition);
          }
          const occ: GlossaryOccurrence = {
            courseKey: course.courseKey,
            courseName: course.courseName,
            lessonName: lesson.lessonName,
            questionInfo: q.questionInfo,
          };
          const dup = entry.occurrences.some(
            (o) =>
              o.courseKey === occ.courseKey &&
              o.lessonName === occ.lessonName &&
              o.questionInfo === occ.questionInfo
          );
          if (!dup) entry.occurrences.push(occ);
        }
      }
    }
  }

  // 日本語順にソート
  return Array.from(map.values()).sort((a, b) =>
    a.term.localeCompare(b.term, "ja")
  );
}
