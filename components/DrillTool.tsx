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
  TeacherView,
} from "@/lib/types";
import { aiFetch } from "@/lib/passcode";

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
    // 現在の定義：手動追加 > override > なし
    const currentDef =
      studyLog.glossaryManualTerms?.[glossaryFocusTerm] ??
      studyLog.glossaryOverrides?.[glossaryFocusTerm.toLowerCase()] ??
      "";
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
  }, [glossaryFocusTerm, studyLog.glossaryOverrides, studyLog.glossaryManualTerms]);

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
        body: JSON.stringify({ title: `${course.seriesName} ${course.courseName}`, sections }),
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
        const res = await aiFetch("/api/question", {
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
          onRenameQuestion={renameQuestion}
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
          diagramLoadingKey={diagramLoadingKey}
          onGenerateDiagram={handleGenerateDiagram}
          overviewLoadingKey={overviewLoadingKey}
          onRegenerateOverview={handleRegenerateOverview}
          onAddManualGlossaryTerm={handleAddManualGlossaryTerm}
        />
      </div>
      <div className="w-80 shrink-0">
        <QuestionPane
          qaEntries={qaEntries}
          isLoading={questionLoading}
          hasLesson={!!screenshots.questionImage}
          onAskQuestion={handleAskQuestion}
          onApproveAddition={handleApproveAddition}
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
