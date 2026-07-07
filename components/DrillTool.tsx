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
  GlossaryHighlight,
  QAEntry,
  ScreenshotSlot,
  StudyLog,
  SummaryHighlight,
  SummaryInsight,
  TeacherView,
} from "@/lib/types";
import { aiFetch } from "@/lib/passcode";
import { addToStudyLog, makeCourseKey } from "@/lib/studyLog";
import { buildGlossary, loadConsolidatedCache } from "@/lib/glossary";

// ── ペイン幅のドラッグ調節 ──────────────────────────────────────────
// ナビ・スクショ・質問ペインの幅を境界のドラッグで変えられるようにする（先生ペインは flex-1）。
// 幅は localStorage に保存し、次回起動時も引き継ぐ。
const PANE_MIN = 200;
const PANE_MAX = 640;
const clampPaneWidth = (w: number) => Math.min(PANE_MAX, Math.max(PANE_MIN, w));

function loadPaneWidth(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(`paneWidth:${key}`);
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) ? clampPaneWidth(n) : fallback;
  } catch {
    return fallback;
  }
}

// ペイン境界のドラッグハンドル。invert=true は「左へ引くほど広がる」ペイン（右端の質問ペイン）用。
function PaneResizer({
  paneKey,
  width,
  setWidth,
  invert = false,
}: {
  paneKey: string;
  width: number;
  setWidth: (w: number) => void;
  invert?: boolean;
}) {
  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    let last = startW;
    const move = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      last = clampPaneWidth(startW + (invert ? -dx : dx));
      setWidth(last);
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try { localStorage.setItem(`paneWidth:${paneKey}`, String(last)); } catch {}
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };
  return (
    <div
      onMouseDown={onMouseDown}
      className="relative z-10 -mx-0.5 w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-blue-400/60 active:bg-blue-500 transition-colors print:hidden"
      title="ドラッグで幅を調節"
    />
  );
}

// 質問ペインへ渡す「いま先生ペインに表示中の内容」。問題ビューだけでなく
// レッスン/コースまとめでも文脈を組み立てる（画面で見えているものをそのままAIに渡す）。
const VIEW_CONTEXT_MAX = 8000; // コースまとめの要点集は長くなり得るためプロンプト肥大を防ぐ

function describeTeacherView(
  studyLog: StudyLog,
  view: TeacherView
): { title: string; context: string } {
  if (!view) return { title: "不明", context: "" };
  if (view.type === "glossary") return { title: "単語帳一覧", context: "" };
  const course = studyLog.courses.find((c) => c.courseKey === view.courseKey);
  if (!course) return { title: "不明", context: "" };
  const courseLabel = `${course.seriesName} ${course.courseName}`;
  if (view.type === "question") {
    const lesson = course.lessons.find((l) => l.lessonName === view.lessonName);
    const q = lesson?.questions.find((q) => q.questionInfo === view.questionInfo);
    return {
      title: `${courseLabel} - ${view.lessonName} ${view.questionInfo}`,
      context: q?.explanation ?? "",
    };
  }
  if (view.type === "lesson") {
    const lesson = course.lessons.find((l) => l.lessonName === view.lessonName);
    const points = (lesson?.questions ?? [])
      .map((q) => `- ${q.questionInfo}: ${q.keyLearning}`)
      .join("\n");
    return {
      title: `${courseLabel} - ${view.lessonName}（レッスンまとめ）`,
      context: points ? `このレッスンの要点一覧：\n${points}` : "",
    };
  }
  // type === "course"
  const digest = course.lessons
    .map((l) => `■ ${l.lessonName}\n${l.questions.map((q) => `- ${q.keyLearning}`).join("\n")}`)
    .join("\n");
  const context = [
    course.overviewText ? `【コース総括】\n${course.overviewText}` : "",
    digest ? `【各レッスンの要点】\n${digest}` : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, VIEW_CONTEXT_MAX);
  return { title: `${courseLabel}（コースまとめ）`, context };
}

// 「自分の気づき」の永続スコープ。まとめビューだけが対象（問題ビューはつまずき補強＝解説追記が担当）
function insightScopeForView(view: TeacherView): string | null {
  if (view?.type === "lesson") return `l:${view.courseKey}__${view.lessonName}`;
  if (view?.type === "course") return `c:${view.courseKey}`;
  return null;
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
  // スクショペインの折りたたみ（取込は全自動でペインを使わないため、普段は畳んで先生ペインを広く）
  const [isScreenshotPaneCollapsed, setIsScreenshotPaneCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("screenshotPaneCollapsed") === "1";
    } catch {
      return false;
    }
  });
  const toggleScreenshotPane = useCallback(() => {
    setIsScreenshotPaneCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem("screenshotPaneCollapsed", next ? "1" : "0"); } catch {}
      return next;
    });
  }, []);

  // ペイン幅（境界のドラッグで調節。w-72=288px / w-80=320px が従来の既定値）
  const [navWidth, setNavWidth] = useState(() => loadPaneWidth("nav", 288));
  const [shotWidth, setShotWidth] = useState(() => loadPaneWidth("shot", 288));
  const [questionWidth, setQuestionWidth] = useState(() => loadPaneWidth("question", 320));
  const [deletedGlossaryTerms, setDeletedGlossaryTerms] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem("deletedGlossaryTerms");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const handleDeleteGlossaryTerm = useCallback((term: string) => {
    setDeletedGlossaryTerms((prev) => {
      const next = [...prev, term];
      try { localStorage.setItem("deletedGlossaryTerms", JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  // 単語帳 Q&A モード
  const [glossaryFocusTerm, setGlossaryFocusTerm] = useState<string | null>(null);
  const [glossaryQaEntries, setGlossaryQaEntries] = useState<QAEntry[]>([]);
  const [glossaryQaLoading, setGlossaryQaLoading] = useState(false);

  const handleFocusGlossaryTerm = useCallback((term: string) => {
    setGlossaryFocusTerm(term);
    setGlossaryQaEntries([]);
  }, []);

  const handleGlossaryQuestion = useCallback(async (question: string) => {
    if (!glossaryFocusTerm) return;
    setGlossaryQaLoading(true);
    // 現在の定義：単語帳カードに表示されているものと同じ内容をAIに渡す。
    // buildGlossary は解説由来の定義に override・手動追加を反映済み。複数定義は
    // 統合キャッシュ（カード表示と同じ統合文）があればそれを優先する。
    // ※以前は手動追加/overrideしか見ておらず、解説由来の用語が全て「未登録」扱いになっていた
    const entry = buildGlossary(studyLog).find(
      (t) => t.term.toLowerCase() === glossaryFocusTerm.toLowerCase()
    );
    const defs = entry?.definitions ?? [];
    const consolidated =
      entry && defs.length >= 2 ? loadConsolidatedCache(entry.term, defs) : null;
    const currentDef =
      consolidated ??
      (defs.length > 0
        ? defs.slice(0, 40).map((d) => `- ${d}`).join("\n") // 定義が極端に多い語はプロンプト肥大を防ぐため40件まで
        : studyLog.glossaryManualTerms?.[glossaryFocusTerm] ??
          studyLog.glossaryOverrides?.[glossaryFocusTerm.toLowerCase()] ??
          "");
    try {
      const res = await aiFetch("/api/question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, glossaryTerm: glossaryFocusTerm, currentDefinition: currentDef }),
      });
      const data = await res.json();
      const entry: QAEntry = {
        id: crypto.randomUUID(),
        question,
        answer: data.answer ?? "",
        proposedAddition: "",
        proposedDefinition: data.proposedDefinition ?? "",
        newTermSuggestions: data.newTerms ?? [],
        approvedNewTerms: [],
        approved: false,
      };
      setGlossaryQaEntries((prev) => [...prev, entry]);
    } finally {
      setGlossaryQaLoading(false);
    }
  }, [glossaryFocusTerm, studyLog]);

  const handleSaveGlossaryDefinition = useCallback((term: string, definition: string) => {
    setStudyLog((prev) => ({
      ...prev,
      glossaryOverrides: {
        ...prev.glossaryOverrides,
        [term.toLowerCase()]: definition,
      },
    }));
    setGlossaryQaEntries((prev) =>
      prev.map((e) =>
        e.proposedDefinition === definition ? { ...e, approved: true } : e
      )
    );
  }, []);

  // 用語名の手動修正（例: 読みの間違い "API(アピアイ)" → "API(エーピーアイ)"）
  const handleRenameGlossaryTerm = useCallback((oldTerm: string, newTerm: string) => {
    const o = oldTerm.trim();
    const n = newTerm.trim();
    if (!n || o === n) return;
    setStudyLog((prev) => {
      const renames = { ...prev.glossaryTermRenames };
      // 既存リネームの行き先が旧名のものは新名へ付け替え（A→B のあと B→C なら A→C にする）
      for (const k of Object.keys(renames)) {
        if (renames[k] === o) renames[k] = n;
      }
      renames[o.toLowerCase()] = n;
      // 定義上書き・手動追加用語のキーも新名へ引き継ぐ
      const overrides = { ...prev.glossaryOverrides };
      const oldDef = overrides[o.toLowerCase()];
      if (oldDef !== undefined) {
        delete overrides[o.toLowerCase()];
        overrides[n.toLowerCase()] = oldDef;
      }
      const manual = { ...prev.glossaryManualTerms };
      const oldManual = manual[o];
      if (oldManual !== undefined) {
        delete manual[o];
        manual[n] = oldManual;
      }
      // マーカーのtermKeyも新名へ引き継ぐ（リネームでハイライトが孤立しないように）
      const highlights = (prev.glossaryHighlights ?? []).map((h) =>
        h.termKey === o.toLowerCase() ? { ...h, termKey: n.toLowerCase() } : h
      );
      return { ...prev, glossaryTermRenames: renames, glossaryOverrides: overrides, glossaryManualTerms: manual, glossaryHighlights: highlights };
    });
    // 質問ペインでフォーカス中の用語名も追従させる
    setGlossaryFocusTerm((cur) => (cur === o ? n : cur));
  }, []);

  const handleAddNewGlossaryTerm = useCallback((entryId: string, term: string, definition: string) => {
    setStudyLog((prev) => ({
      ...prev,
      glossaryManualTerms: {
        ...prev.glossaryManualTerms,
        [term]: definition,
      },
    }));
    setGlossaryQaEntries((prev) =>
      prev.map((e) =>
        e.id === entryId
          ? { ...e, approvedNewTerms: [...(e.approvedNewTerms ?? []), term] }
          : e
      )
    );
  }, []);

  // 先生ペインの解説文から選択した語句を、手動で単語帳に登録する。
  // 用語解説に載っていない重要語（例: Next.js, .tsx）の補完用。保存先は既存の
  // glossaryManualTerms（解説本文に登場しなくても単語帳に補完表示される）。
  const handleAddManualGlossaryTerm = useCallback((term: string, definition: string) => {
    const t = term.trim();
    if (!t) return;
    setStudyLog((prev) => ({
      ...prev,
      glossaryManualTerms: {
        ...prev.glossaryManualTerms,
        [t]: definition.trim(),
      },
    }));
  }, []);

  // 単語帳のマーカー（任意範囲ハイライト）。引用＋前後文脈でアンカーする。
  // 同じ範囲が二重登録されないよう、4つのアンカー項目が一致するものは弾く。
  const handleAddGlossaryHighlight = useCallback((h: GlossaryHighlight) => {
    if (!h.quote.trim()) return;
    setStudyLog((prev) => {
      const list = prev.glossaryHighlights ?? [];
      const dup = list.some(
        (x) => x.termKey === h.termKey && x.quote === h.quote && x.prefix === h.prefix && x.suffix === h.suffix
      );
      if (dup) return prev;
      return { ...prev, glossaryHighlights: [...list, h] };
    });
  }, []);

  const handleRemoveGlossaryHighlight = useCallback((h: GlossaryHighlight) => {
    setStudyLog((prev) => {
      const list = prev.glossaryHighlights ?? [];
      const next = list.filter(
        (x) => !(x.termKey === h.termKey && x.quote === h.quote && x.prefix === h.prefix && x.suffix === h.suffix)
      );
      return { ...prev, glossaryHighlights: next };
    });
  }, []);

  // まとめ（レッスン/コースまとめ）のマーカー。単語帳と同じく引用＋前後文脈でアンカーする。
  const handleAddSummaryHighlight = useCallback((h: SummaryHighlight) => {
    if (!h.quote.trim()) return;
    setStudyLog((prev) => {
      const list = prev.summaryHighlights ?? [];
      const dup = list.some(
        (x) => x.scope === h.scope && x.quote === h.quote && x.prefix === h.prefix && x.suffix === h.suffix
      );
      if (dup) return prev;
      return { ...prev, summaryHighlights: [...list, h] };
    });
  }, []);

  const handleRemoveSummaryHighlight = useCallback((h: SummaryHighlight) => {
    setStudyLog((prev) => {
      const list = prev.summaryHighlights ?? [];
      const next = list.filter(
        (x) => !(x.scope === h.scope && x.quote === h.quote && x.prefix === h.prefix && x.suffix === h.suffix)
      );
      return { ...prev, summaryHighlights: next };
    });
  }, []);

  // レッスン／コースまとめの「図解化」。生成中のまとめを示すキー（courseKey or courseKey__lessonName）
  const [diagramLoadingKey, setDiagramLoadingKey] = useState<string | null>(null);

  const handleGenerateDiagram = useCallback(async (view: TeacherView) => {
    if (view?.type !== "lesson" && view?.type !== "course") return;
    const course = studyLogRef.current.courses.find((c) => c.courseKey === view.courseKey);
    if (!course) return;

    const isLesson = view.type === "lesson";
    const lesson = isLesson ? course.lessons.find((l) => l.lessonName === view.lessonName) : null;
    if (isLesson && !lesson) return;

    const key = isLesson ? `${view.courseKey}__${view.lessonName}` : view.courseKey;
    const payload = isLesson
      ? {
          scope: "lesson",
          title: `${course.courseName} ${lesson!.lessonName}`,
          sections: [
            {
              heading: lesson!.lessonName,
              points: lesson!.questions.map((q) => q.keyLearning).filter(Boolean),
            },
          ],
        }
      : {
          scope: "course",
          title: `${course.seriesName} ${course.courseName}`,
          sections: course.lessons.map((l) => ({
            heading: l.lessonName,
            points: l.questions.map((q) => q.keyLearning).filter(Boolean),
          })),
        };

    setDiagramLoadingKey(key);
    try {
      const res = await aiFetch("/api/diagram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.html) {
        throw new Error(data.error ?? "図の生成に失敗しました");
      }
      setStudyLog((prev) => ({
        ...prev,
        courses: prev.courses.map((c) => {
          if (c.courseKey !== view.courseKey) return c;
          if (!isLesson) return { ...c, diagramHtml: data.html };
          return {
            ...c,
            lessons: c.lessons.map((l) =>
              l.lessonName === view.lessonName ? { ...l, diagramHtml: data.html } : l
            ),
          };
        }),
      }));
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : "図の生成に失敗しました");
    } finally {
      setDiagramLoadingKey(null);
    }
  }, []);

  // コースまとめの「総括」（Sonnet）。生成中のコースのcourseKeyを保持。
  const [overviewLoadingKey, setOverviewLoadingKey] = useState<string | null>(null);

  // 指定コースの総括をSonnetで生成し、overviewText / overviewQuestionCount を保存する。
  // forceがfalseのときは、既に最新（保存済みの問題数 === 現在の問題数）ならスキップする。
  const generateOverview = useCallback(async (courseKey: string, force: boolean) => {
    const course = studyLogRef.current.courses.find((c) => c.courseKey === courseKey);
    if (!course) return;
    const totalQ = course.lessons.reduce((s, l) => s + l.questions.length, 0);
    if (totalQ === 0) return;                          // 問題ゼロなら総括しない
    if (overviewLoadingKey === courseKey) return;      // 多重起動防止
    if (!force && course.overviewText && course.overviewQuestionCount === totalQ) return; // 最新なら何もしない

    const sections = course.lessons
      .map((l) => ({
        heading: l.lessonName,
        points: l.questions.map((q) => q.keyLearning).filter(Boolean),
      }))
      .filter((s) => s.points.length > 0);
    if (sections.length === 0) return;

    setOverviewLoadingKey(courseKey);
    try {
      const res = await aiFetch("/api/overview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `${course.seriesName} ${course.courseName}`,
          sections,
          kind: course.contentType === "lecture" ? "lecture" : "course",
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.overview) {
        throw new Error(data.error ?? "総括の生成に失敗しました");
      }
      setStudyLog((prev) => ({
        ...prev,
        courses: prev.courses.map((c) =>
          c.courseKey === courseKey
            ? { ...c, overviewText: data.overview, overviewQuestionCount: totalQ }
            : c
        ),
      }));
    } catch (err) {
      console.error(err);
      // 自動生成の失敗は無言で握りつぶす（手動再生成で別途alertする）
      if (force) alert(err instanceof Error ? err.message : "総括の生成に失敗しました");
    } finally {
      setOverviewLoadingKey(null);
    }
  }, [overviewLoadingKey]);

  // コースまとめを開いたとき、総括が未生成 or 問題数が増えていたら自動で作り直す（賢い自動キャッシュ方式）。
  useEffect(() => {
    if (teacherView?.type !== "course") return;
    generateOverview(teacherView.courseKey, false);
  }, [teacherView, studyLog, generateOverview]);

  // 「再生成」ボタン用（中身が変わっていなくても強制的に作り直す）。
  const handleRegenerateOverview = useCallback((courseKey: string) => {
    generateOverview(courseKey, true);
  }, [generateOverview]);

  // 自動取込で読み取った Desktop 上の元ファイルパス。
  // 解説生成が成功した（＝ドリルと確定した）時だけ取込フォルダへ移動・改名する。
  const [importedFiles, setImportedFiles] = useState<Partial<Record<ScreenshotSlot, string>>>({});
  const importedFilesRef = useRef(importedFiles);
  importedFilesRef.current = importedFiles;

  // 保存の版印（rev）。読み込んだ時点の rev を保存時に添えることで、サーバー側が
  // 「読込後に取込等の別書き込みが挟まった」ことを検出し、全置換でなく補完マージに倒す。
  // （古いコピーを持つタブの保存が取込分を丸ごと消す事故の再発防止・2026-07-02）
  const studyLogRevRef = useRef<string | null>(null);

  // 起動時に保存済み studyLog を読み込む
  useEffect(() => {
    fetch("/api/study-log")
      .then((r) => r.json())
      .then((data) => {
        if (!data?.courses) return;
        studyLogRevRef.current = typeof data._rev === "string" ? data._rev : null;
        delete data._rev;
        setStudyLog(data);
      })
      .catch(() => {});
  }, []);

  // studyLog が変化したら JSON に保存。
  // 保存は直列化する（前の保存の rev 返却を待ってから次を送る）: 並行 POST は古い rev を
  // 持つため救済マージに倒れ、直前の削除・改名が復活し得る。直列なら常に rev 一致＝全置換。
  const studyLogRef = useRef(studyLog);
  studyLogRef.current = studyLog;
  const saveInFlightRef = useRef(false);
  const savePendingRef = useRef(false);
  useEffect(() => {
    if (studyLog.courses.length === 0) return;
    if (saveInFlightRef.current) {
      savePendingRef.current = true; // 保存中に変化した分は完了後にまとめて保存
      return;
    }
    const run = async () => {
      saveInFlightRef.current = true;
      try {
        do {
          savePendingRef.current = false;
          const r = await fetch("/api/study-log", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...studyLogRef.current, _rev: studyLogRevRef.current }),
          });
          const j = await r.json().catch(() => null);
          if (typeof j?.rev === "string") studyLogRevRef.current = j.rev;
        } while (savePendingRef.current);
      } catch {
        // 失敗しても次の変化で再保存される
      } finally {
        saveInFlightRef.current = false;
      }
    };
    run();
  }, [studyLog]);

  // ナビからのQ番号修正（AIの読み取り誤り＝例：Q6をQ8と誤読 を手で直す）。
  // studyLogのラベルを更新するだけ。スクショの保存ファイルとは独立しているので影響しない。
  const renameQuestion = useCallback(
    (courseKey: string, lessonName: string, oldQ: string, rawNew: string) => {
      const digits = rawNew.replace(/\D/g, "");
      if (!digits) return;
      const newQ = `Q${parseInt(digits, 10)}`;
      if (newQ === oldQ) return;
      const lesson = studyLogRef.current.courses
        .find((c) => c.courseKey === courseKey)
        ?.lessons.find((l) => l.lessonName === lessonName);
      // 対象が見つからない（blur二重発火等で既に改名済み）なら静かに何もしない
      if (!lesson?.questions.some((q) => q.questionInfo === oldQ)) return;
      if (lesson.questions.some((q) => q.questionInfo === newQ)) {
        alert(`${newQ} はこのレッスンに既にあります。先に重複しない番号へ調整してください。`);
        return;
      }
      setStudyLog((prev) => ({
        ...prev,
        courses: prev.courses.map((c) => {
          if (c.courseKey !== courseKey) return c;
          return {
            ...c,
            lessons: c.lessons.map((l) => {
              if (l.lessonName !== lessonName) return l;
              const questions = l.questions
                .map((q) => (q.questionInfo === oldQ ? { ...q, questionInfo: newQ } : q))
                .sort((a, b) => {
                  const n = (s: string) => parseInt(s.replace(/\D/g, ""), 10) || 0;
                  return n(a.questionInfo) - n(b.questionInfo);
                });
              return { ...l, questions };
            }),
          };
        }),
      }));
      // 今その問題を表示中なら表示も追従させる
      setTeacherView((v) =>
        v?.type === "question" &&
        v.courseKey === courseKey &&
        v.lessonName === lessonName &&
        v.questionInfo === oldQ
          ? { ...v, questionInfo: newQ }
          : v
      );
    },
    []
  );

  const fetchTeacherExplanation = useCallback(
    async (newScreenshots: DrillScreenshots) => {
      if (!newScreenshots.questionImage) return;
      setTeacherLoading(true);
      setTeacherView(null);
      setTeacherError(null);
      try {
        // 既存の登録済みコース/レッスン名をAPIに渡し、OCRのブレ（同じコース名の漢字を
        // 毎回違う字に誤読する）で別コースに分裂するのを防ぐ。一致するなら既存名をそのまま再利用させる。
        const knownCourses = studyLogRef.current.courses.map((c) => ({
          series: c.seriesName,
          course: c.courseName,
          lessons: c.lessons.map((l) => l.lessonName),
        }));
        const res = await aiFetch("/api/teacher", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            questionImageDataUrl: newScreenshots.questionImage,
            answerImageDataUrl: newScreenshots.answerImage,
            courseMapImageDataUrl: newScreenshots.courseMapImage,
            knownCourses,
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
          // 解説生成成功＝ドリルと確定。Desktop の元ファイルを取込フォルダへ移動＋改名
          const filesToRename = importedFilesRef.current;
          if (Object.keys(filesToRename).length > 0) {
            fetch("/api/rename-imported", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                files: filesToRename,
                series: info.series,
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
    (type: ScreenshotSlot, dataUrl: string, sourcePath?: string | null) => {
      setScreenshots((prev) => ({ ...prev, [slotKey(type)]: dataUrl }));
      if (sourcePath) {
        setImportedFiles((prev) => ({ ...prev, [type]: sourcePath }));
      }
      setQaEntries([]);
    },
    []
  );

  // 次の問題へ：問題・解答スロットをクリア（コースマップは維持）し、ドリルを自動で開く
  const handleNextQuestion = useCallback(() => {
    setScreenshots((prev) => ({ ...prev, questionImage: null, answerImage: null }));
    setImportedFiles((prev) => ({ courseMap: prev.courseMap }));
    setTeacherView(null);
    setQaEntries([]);
    setIsDrillPanelOpen(true);
    setIsAutoEnabled(true);
  }, []);

  // ビュー切替でQ&Aスレッドをクリア。文脈の混線と、問題Aで出た補強案を
  // 問題B閲覧中に承認して誤追記する事故を根絶する（履歴の永続化は不採用＝消えてよい方針）
  const teacherViewKey =
    teacherView === null
      ? "none"
      : teacherView.type === "question"
      ? `q:${teacherView.courseKey}:${teacherView.lessonName}:${teacherView.questionInfo}`
      : teacherView.type === "lesson"
      ? `l:${teacherView.courseKey}:${teacherView.lessonName}`
      : teacherView.type === "course"
      ? `c:${teacherView.courseKey}`
      : "glossary";
  useEffect(() => {
    setQaEntries([]);
  }, [teacherViewKey]);

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
        const view = describeTeacherView(studyLog, teacherView);
        const isSummaryView = insightScopeForView(teacherView) !== null;
        const res = await aiFetch("/api/question", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question,
            questionImageDataUrl: screenshots.questionImage,
            answerImageDataUrl: screenshots.answerImage,
            currentExplanation: view.context,
            summaryMode: isSummaryView,
            lessonTitle:
              teacherView !== null
                ? view.title
                : currentLessonInfo
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
          // 追加案の永続先（解説本文）があるのは問題ビューだけ。他ビューでは非表示にする
          proposedAddition:
            teacherView?.type === "question" ? data.proposedAddition || "" : "",
          // 気づき提案はまとめビュー（レッスン/コース/講義まとめ）だけ
          proposedInsight: isSummaryView ? data.proposedInsight || "" : "",
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
        // 見出しに質問の要旨を入れ、後から読み返したとき「自分がつまずいた箇所」だと分かる形で蓄積する
        const q1line = entry.question.replace(/\s+/g, " ").trim();
        const shortQ = q1line.length > 24 ? `${q1line.slice(0, 24)}…` : q1line;
        const addition = `\n\n---\n\n#### 💡 つまずき補強（「${shortQ}」の質問から）\n\n${entry.proposedAddition}`;
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
                    return { ...q, explanation: `${q.explanation}${addition}` };
                  }),
                };
              }),
            };
          });
          // ...prev を必ず維持（courses だけ返すと単語帳の手動定義・リネーム・マーカーが全消失する）
          return { ...prev, courses };
        });
      }
      setQaEntries((prev) =>
        prev.map((e) => (e.id === entryId ? { ...e, approved: true } : e))
      );
    },
    [qaEntries, teacherView]
  );

  // まとめビューのQ&Aで出た「気づき」提案を承認し、studyLog.summaryInsights に蓄積する。
  // 総括(overviewText)の再生成とは独立したデータなので、再生成しても消えない。
  const handleApproveInsight = useCallback(
    (entryId: string) => {
      const entry = qaEntries.find((e) => e.id === entryId);
      const scope = insightScopeForView(teacherView);
      if (entry?.proposedInsight && scope) {
        const q1line = entry.question.replace(/\s+/g, " ").trim();
        const shortQ = q1line.length > 24 ? `${q1line.slice(0, 24)}…` : q1line;
        const insight: SummaryInsight = {
          id: crypto.randomUUID(),
          scope,
          text: entry.proposedInsight,
          sourceQuestion: shortQ,
          timestamp: Date.now(),
        };
        setStudyLog((prev) => ({
          ...prev,
          summaryInsights: [...(prev.summaryInsights ?? []), insight],
        }));
      }
      setQaEntries((prev) =>
        prev.map((e) => (e.id === entryId ? { ...e, approved: true } : e))
      );
    },
    [qaEntries, teacherView]
  );

  const handleRemoveInsight = useCallback((id: string) => {
    setStudyLog((prev) => ({
      ...prev,
      summaryInsights: (prev.summaryInsights ?? []).filter((i) => i.id !== id),
    }));
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <DrillSidePanel
        isOpen={isDrillPanelOpen}
        onClose={() => setIsDrillPanelOpen(false)}
        onCapture={handleScreenshotUpload}
      />
      <div className="shrink-0" style={{ width: navWidth }}>
        <NavigationPane
          studyLog={studyLog}
          teacherView={teacherView}
          onSelectView={setTeacherView}
          onRenameQuestion={renameQuestion}
        />
      </div>
      <PaneResizer paneKey="nav" width={navWidth} setWidth={setNavWidth} />
      <div
        className={isScreenshotPaneCollapsed ? "w-9 shrink-0" : "shrink-0"}
        style={isScreenshotPaneCollapsed ? undefined : { width: shotWidth }}
      >
        <ScreenshotPane
          screenshots={screenshots}
          onScreenshotUpload={handleScreenshotUpload}
          onScreenshotClear={handleScreenshotClear}
          onNextQuestion={handleNextQuestion}
          onOpenDrill={() => { setIsDrillPanelOpen(true); setIsAutoEnabled(true); }}
          disabled={teacherLoading}
          isAutoEnabled={isAutoEnabled}
          onAutoToggle={setIsAutoEnabled}
          collapsed={isScreenshotPaneCollapsed}
          onToggleCollapse={toggleScreenshotPane}
        />
      </div>
      {!isScreenshotPaneCollapsed && (
        <PaneResizer paneKey="shot" width={shotWidth} setWidth={setShotWidth} />
      )}
      <div className="flex-1 min-w-[300px]">
        <TeacherPane
          studyLog={studyLog}
          teacherView={teacherView}
          isLoading={teacherLoading}
          error={teacherError}
          currentLessonInfo={currentLessonInfo}
          hasScreenshots={!!screenshots.questionImage}
          onSelectView={setTeacherView}
          deletedGlossaryTerms={deletedGlossaryTerms}
          onDeleteGlossaryTerm={handleDeleteGlossaryTerm}
          onRenameGlossaryTerm={handleRenameGlossaryTerm}
          glossaryFocusTerm={glossaryFocusTerm}
          onFocusGlossaryTerm={handleFocusGlossaryTerm}
          glossaryHighlights={studyLog.glossaryHighlights ?? []}
          onAddGlossaryHighlight={handleAddGlossaryHighlight}
          onRemoveGlossaryHighlight={handleRemoveGlossaryHighlight}
          summaryHighlights={studyLog.summaryHighlights ?? []}
          onAddSummaryHighlight={handleAddSummaryHighlight}
          onRemoveSummaryHighlight={handleRemoveSummaryHighlight}
          summaryInsights={studyLog.summaryInsights ?? []}
          onRemoveInsight={handleRemoveInsight}
          diagramLoadingKey={diagramLoadingKey}
          onGenerateDiagram={handleGenerateDiagram}
          overviewLoadingKey={overviewLoadingKey}
          onRegenerateOverview={handleRegenerateOverview}
          onAddManualGlossaryTerm={handleAddManualGlossaryTerm}
        />
      </div>
      <PaneResizer paneKey="question" width={questionWidth} setWidth={setQuestionWidth} invert />
      <div className="shrink-0" style={{ width: questionWidth }}>
        <QuestionPane
          qaEntries={qaEntries}
          isLoading={questionLoading}
          canAsk={teacherView !== null || !!screenshots.questionImage}
          onAskQuestion={handleAskQuestion}
          onApproveAddition={handleApproveAddition}
          onApproveInsight={handleApproveInsight}
          glossaryFocusTerm={glossaryFocusTerm}
          glossaryQaEntries={glossaryQaEntries}
          glossaryQaLoading={glossaryQaLoading}
          onAskGlossaryQuestion={handleGlossaryQuestion}
          onSaveGlossaryDefinition={handleSaveGlossaryDefinition}
          onAddNewGlossaryTerm={handleAddNewGlossaryTerm}
          onClearGlossaryFocus={() => setGlossaryFocusTerm(null)}
        />
      </div>
    </div>
  );
}
