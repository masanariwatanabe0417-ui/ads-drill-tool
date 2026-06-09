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

// ひらがな→カタカナ正規化（ソート・重複判定で使用）
function toKatakana(s: string): string {
  return s.replace(/[ぁ-ゖ]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) + 0x60)
  );
}

// 用語の「読みキー」を返す。
// - 英字主体 + 括弧内ふりがな → 括弧内を読みにする (例: "conflict(コンフリクト)" → "コンフリクト")
// - それ以外 → 括弧前の本体 (例: "マージ(merge)" → "マージ")
// - 括弧なし → そのまま
function readingKey(term: string): string {
  const m = term.match(/^\s*([^(（]+?)\s*[(（]([^)）]*)[)）]/);
  if (m) {
    const head = m[1].trim();
    const inside = m[2].trim();
    if (/^[A-Za-z0-9.\-\s]+$/.test(head) && inside) return toKatakana(inside);
    return toKatakana(head);
  }
  return toKatakana(term.trim());
}

// 重複判定キー: 読みキーを小文字化して統一（"マージ" と "マージ(merge)" を同一視）
function dedupeKey(term: string): string {
  return readingKey(term).toLowerCase();
}

// studyLog 全体を走査して用語ごとに集約した単語帳を作る（追加API不要）。
// glossaryOverrides に登録された用語はその定義を優先する（AI統合・複数定義を上書き）。
export function buildGlossary(studyLog: StudyLog): GlossaryTerm[] {
  const map = new Map<string, GlossaryTerm>();

  for (const course of studyLog.courses) {
    for (const lesson of course.lessons) {
      for (const q of lesson.questions) {
        for (const { term, definition } of parseGlossaryLines(q.explanation)) {
          const key = dedupeKey(term);
          let entry = map.get(key);
          if (!entry) {
            entry = { term, definitions: [], occurrences: [] };
            map.set(key, entry);
          } else {
            // 括弧付き（より情報量の多い）表記を優先して表示用 term に採用
            if (term.length > entry.term.length) entry.term = term;
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

  // glossaryOverrides が登録されている用語は定義を上書きする
  // キーは entry.term.toLowerCase() で照合（dedupeKey とは別）
  const overrides = studyLog.glossaryOverrides ?? {};
  map.forEach((entry) => {
    const override = overrides[entry.term.toLowerCase()];
    if (override) entry.definitions = [override];
  });

  // 手動追加用語（説明文に登場しないが単語帳に追加されたもの）を補完する
  const manualTerms = studyLog.glossaryManualTerms ?? {};
  Object.entries(manualTerms).forEach(([term, definition]) => {
    const key = dedupeKey(term);
    if (!map.has(key)) {
      map.set(key, { term, definitions: [definition], occurrences: [] });
    } else {
      // 既存エントリがあればオーバーライドとして定義を上書き
      map.get(key)!.definitions = [definition];
    }
  });

  // ひらがな・カタカナを同一視したあいうえお順でソート
  return Array.from(map.values()).sort((a, b) =>
    readingKey(a.term).localeCompare(readingKey(b.term), "ja")
  );
}
