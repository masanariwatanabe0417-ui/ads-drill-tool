"use client";

import { Loader2, GraduationCap, Clipboard, Sparkles, MessageCircle, ChevronRight, BookMarked, X, Search, Eye, EyeOff, Pencil, Network, FileDown, Headphones, Highlighter, BookPlus, Check } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { CourseData, ExtractedLessonInfo, GlossaryHighlight, LessonData, StudyLog, SummaryHighlight, SummaryInsight, TeacherView } from "@/lib/types";
import { buildGlossary, findGlossaryEntry, GlossaryTerm, loadConsolidatedCache, normalizeForSearch, saveConsolidatedCache } from "@/lib/glossary";
import { aiFetch } from "@/lib/passcode";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import { visit, SKIP } from "unist-util-visit";
import type { Root } from "hast";
import { useEffect, useMemo, useRef, useState, isValidElement } from "react";
import MermaidDiagram from "@/components/MermaidDiagram";
import HtmlDiagram from "@/components/HtmlDiagram";

// まとめの音声化先となるNotebookLMノート（名称「AIドリル」）。「NotebookLM」ボタンで開く。
const NOTEBOOKLM_NOTEBOOK_URL =
  "https://notebooklm.google.com/notebook/811e6107-7677-470a-8cb3-197d867f0fac";

interface TeacherPaneProps {
  studyLog: StudyLog;
  teacherView: TeacherView;
  isLoading: boolean;
  hasScreenshots: boolean;
  currentLessonInfo: ExtractedLessonInfo | null;
  error?: string | null;
  onSelectView: (view: TeacherView) => void;
  deletedGlossaryTerms?: string[];
  onDeleteGlossaryTerm?: (term: string) => void;
  onRenameGlossaryTerm?: (oldTerm: string, newTerm: string) => void;
  glossaryFocusTerm?: string | null;
  onFocusGlossaryTerm?: (term: string) => void;
  glossaryHighlights?: GlossaryHighlight[];
  onAddGlossaryHighlight?: (h: GlossaryHighlight) => void;
  onRemoveGlossaryHighlight?: (h: GlossaryHighlight) => void;
  summaryHighlights?: SummaryHighlight[];
  onAddSummaryHighlight?: (h: SummaryHighlight) => void;
  onRemoveSummaryHighlight?: (h: SummaryHighlight) => void;
  diagramLoadingKey?: string | null;
  onGenerateDiagram?: (view: TeacherView) => void;
  overviewLoadingKey?: string | null;
  onRegenerateOverview?: (courseKey: string) => void;
  onAddManualGlossaryTerm?: (term: string, definition: string) => void;
  summaryInsights?: SummaryInsight[];
  onRemoveInsight?: (id: string) => void;
}

// ── まとめの図解化ボタン + 図表示 ──────────────────────────────────
function DiagramButton({
  hasDiagram,
  loading,
  onGenerate,
}: {
  hasDiagram?: boolean;
  loading: boolean;
  onGenerate: () => void;
}) {
  return (
    <button
      onClick={onGenerate}
      disabled={loading}
      className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors shrink-0 disabled:opacity-60 print:hidden"
      title="学んだ要点の全体像をAIが図にします"
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Network className="h-3.5 w-3.5" />
      )}
      {loading ? "図を生成中..." : hasDiagram ? "図解を再生成" : "図解化"}
    </button>
  );
}

// ── コースまとめの「総括」（Sonnet）ブロック ──────────────────────
// コースまとめを開くと自動生成され、各問のkeyLearningを統合した「コースの幹」を
// まとめの最上部に表示する。生成中はスピナー、生成済みは本文＋小さな再生成ボタン。
function OverviewBlock({
  text,
  loading,
  onRegenerate,
  scope,
  highlights,
  onRemoveHighlight,
  unitLabel = "コース",
}: {
  text?: string;
  loading: boolean;
  onRegenerate: () => void;
  scope: string;
  highlights: SummaryHighlight[];
  onRemoveHighlight: (h: SummaryHighlight) => void;
  unitLabel?: string; // 講義まとめでは「講義」（コース/レッスン表記を出さない）
}) {
  if (loading && !text) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-center gap-2 text-sm text-amber-800">
        <Loader2 className="h-4 w-4 animate-spin shrink-0" />
        {unitLabel}の総括を作成中...
      </div>
    );
  }
  if (!text) return null;
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
      <div className="flex items-start justify-between gap-2 mb-1">
        <p className="text-xs font-bold text-amber-700 flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5" />
          {unitLabel}の総括
        </p>
        <button
          onClick={onRegenerate}
          disabled={loading}
          className="inline-flex items-center gap-1 text-[11px] text-amber-700 hover:text-amber-900 disabled:opacity-60 print:hidden shrink-0"
          title="総括をもう一度作り直します"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Network className="h-3 w-3" />}
          {loading ? "生成中..." : "再生成"}
        </button>
      </div>
      <div data-hl-block={scope} className="prose-sm max-w-none text-foreground">
        <HighlightedMarkdown text={text} highlights={highlights} onRemove={onRemoveHighlight} />
      </div>
    </div>
  );
}

const markdownComponents: Components = {
  h2: ({ children }) => (
    <h2 className="text-base font-semibold text-foreground border-b pb-1 mt-4 mb-2 first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-semibold text-foreground mt-3 mb-1">
      {children}
    </h3>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  code: ({ children, className }) => {
    if (className === "language-mermaid") {
      return <MermaidDiagram code={String(children).trim()} />;
    }
    const isBlock = className?.startsWith("language-");
    if (isBlock) {
      return (
        <code className="block bg-slate-100 rounded p-3 font-mono text-sm whitespace-pre-wrap text-slate-800">
          {children}
        </code>
      );
    }
    return (
      <code className="bg-slate-100 px-1 rounded font-mono text-xs text-slate-800">
        {children}
      </code>
    );
  },
  pre: ({ children }) => {
    // mermaidブロックはMermaidDiagramが描画するため<pre>の装飾を付けない
    if (
      isValidElement(children) &&
      (children.props as { className?: string }).className === "language-mermaid"
    ) {
      return <>{children}</>;
    }
    return <pre className="bg-slate-100 rounded p-3 overflow-x-auto my-2">{children}</pre>;
  },
  ul: ({ children }) => (
    <ul className="space-y-1 my-2 pl-4 list-disc">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="space-y-1 my-2 pl-4 list-decimal">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="text-sm leading-relaxed text-foreground">{children}</li>
  ),
  p: ({ children }) => (
    <p className="text-sm leading-relaxed text-foreground my-1">{children}</p>
  ),
};

// 問題ビュー専用のMarkdown装飾。トップの「## 問題 / ## 回答 / ## 解説 / ## 用語」を
// セクションの帯（バナー）として描画し、4ブロックを視覚的に区切る。
// 解説内の小見出しは「### 〜」なので h3（控えめなラベル）として残す。
// まとめ（総括）の h2 装飾には影響させないため ExplanationView 専用にする。
const questionMarkdownComponents: Components = {
  ...markdownComponents,
  h2: ({ children }) => (
    <h2 className="flex items-center text-sm font-bold text-primary bg-primary/5 border-l-4 border-primary rounded-r px-3 py-1.5 mt-6 mb-2 first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-semibold text-foreground/90 mt-3 mb-1">{children}</h3>
  ),
};

// ── ステップガイド（空状態）────────────────────────────────────────
const STEPS = [
  {
    num: "1",
    icon: Clipboard,
    title: "スクショを貼り付ける",
    desc: "「問題」枠をクリック → ⌘V で貼り付け。解答も貼ると解説の精度UP",
    text: "text-amber-600",
    bg: "bg-amber-50",
    border: "border-amber-200",
    badge: "bg-amber-100",
  },
  {
    num: "2",
    icon: Sparkles,
    title: "AI が解説を生成",
    desc: "用語解説・問題解説・ポイントまとめを 3つの AI が同時生成",
    text: "text-blue-600",
    bg: "bg-blue-50",
    border: "border-blue-200",
    badge: "bg-blue-100",
  },
  {
    num: "3",
    icon: MessageCircle,
    title: "質問して深める",
    desc: "右ペインで疑問を解消。解説への追記もワンクリック",
    text: "text-violet-600",
    bg: "bg-violet-50",
    border: "border-violet-200",
    badge: "bg-violet-100",
  },
] as const;

function StepGuide() {
  return (
    <div className="flex flex-col items-center justify-center gap-8 py-14 px-6">
      {/* ヘッダー */}
      <div className="text-center space-y-1.5">
        <div className="flex items-center justify-center gap-2">
          <GraduationCap className="h-5 w-5 text-primary" />
          <span className="text-base font-bold text-foreground">本気AIドリル</span>
        </div>
        <p className="text-sm text-muted-foreground">
          問題のスクリーンショットを貼り付けるだけで
        </p>
        <p className="text-sm font-semibold text-primary">
          AI が解説・コースまとめ・レッスンまとめを自動生成します
        </p>
      </div>

      {/* ステップカード */}
      <div className="flex items-start gap-2 w-full">
        {STEPS.map((s, i) => (
          <div key={s.num} className="flex items-start gap-2 flex-1 min-w-0">
            {/* カード */}
            <div
              className={`flex-1 min-w-0 rounded-xl border ${s.border} ${s.bg} p-3 space-y-2.5 transition-shadow hover:shadow-sm`}
            >
              {/* バッジ + アイコン */}
              <div className="flex items-center justify-between">
                <span
                  className={`inline-flex h-5 w-5 items-center justify-center rounded-full ${s.badge} text-xs font-bold ${s.text}`}
                >
                  {s.num}
                </span>
                <s.icon className={`h-3.5 w-3.5 ${s.text} opacity-50`} />
              </div>
              {/* テキスト */}
              <div className="space-y-1">
                <p className={`text-xs font-bold ${s.text}`}>{s.title}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {s.desc}
                </p>
              </div>
            </div>
            {/* 矢印 */}
            {i < STEPS.length - 1 && (
              <ChevronRight className="h-4 w-4 text-muted-foreground/30 mt-4 shrink-0" />
            )}
          </div>
        ))}
      </div>

      {/* サブヒント */}
      <p className="text-xs text-muted-foreground/60 text-center">
        左のナビゲーションで Q・レッスン・コースを切り替えてまとめを確認できます
      </p>
    </div>
  );
}

// 単語帳を開いた直後、キャッシュ未作成のカード全部が一斉に統合APIを叩くと
// fetch失敗（Failed to fetch）が出るため、同時実行を絞る簡易キュー。
let consolidateActive = 0;
const consolidateWaiters: (() => void)[] = [];
async function withConsolidateSlot<T>(fn: () => Promise<T>): Promise<T> {
  while (consolidateActive >= 4) {
    await new Promise<void>((resolve) => consolidateWaiters.push(resolve));
  }
  consolidateActive++;
  try {
    return await fn();
  } finally {
    consolidateActive--;
    consolidateWaiters.shift()?.();
  }
}

// ── マーカー（任意範囲ハイライト）共通基盤 ───────────────────────────
// 単語帳（GlossaryHighlight）とまとめ（SummaryHighlight）で共有する。
const HL_CTX = 20; // アンカーの前後文脈として保持する文字数
const MARK_CLASS =
  "rounded-sm bg-yellow-200 px-0.5 cursor-pointer hover:bg-yellow-300 transition-colors print:bg-yellow-200";

// 引用と前後の文脈を持つアンカーの最小形。
type HLAnchor = { quote: string; prefix: string; suffix: string };

// テキストの中からハイライトの位置を引用＋前後文脈で特定する。
// 文言が変わって見つからなければ null（＝そのハイライトは静かに消える）。
function locateHighlight(text: string, h: HLAnchor): { start: number; end: number } | null {
  const probes = [h.prefix + h.quote + h.suffix, h.prefix + h.quote, h.quote + h.suffix, h.quote];
  for (const probe of probes) {
    if (!probe) continue;
    const idx = text.indexOf(probe);
    if (idx < 0) continue;
    const off = probe.indexOf(h.quote);
    return { start: idx + off, end: idx + off + h.quote.length };
  }
  return null;
}

// プレーンテキストを、ハイライト箇所だけ<mark>で囲んだReactノード列に変換する。
function renderWithHighlights<T extends HLAnchor>(
  text: string,
  highlights: T[],
  onRemove: (h: T) => void
): React.ReactNode {
  if (highlights.length === 0) return text;
  const spans: { start: number; end: number; h: T }[] = [];
  for (const h of highlights) {
    const loc = locateHighlight(text, h);
    if (loc && loc.end > loc.start) spans.push({ ...loc, h });
  }
  if (spans.length === 0) return text;
  spans.sort((a, b) => a.start - b.start);

  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  for (const s of spans) {
    if (s.start < cursor) continue; // 重なりはスキップ
    if (s.start > cursor) nodes.push(text.slice(cursor, s.start));
    nodes.push(
      <mark
        key={key++}
        onClick={() => onRemove(s.h)}
        className={MARK_CLASS}
        title="クリックでマーカーを解除"
      >
        {text.slice(s.start, s.end)}
      </mark>
    );
    cursor = s.end;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

// ドラッグ選択を捕捉して「マーカー」ボタンを出し、確定/解除を扱う共通フック。
// 対象ブロックは [data-hl-block]（その値が scope）で識別する。
function useRangeMarker(
  onCommit: (scope: string, anchor: HLAnchor) => void,
  // 指定すると「マーカー」の隣に「単語帳に追加」ボタンも出す（まとめ画面用）
  onPickTerm?: (text: string) => void
) {
  const [pending, setPending] = useState<
    { top: number; left: number; scope: string; anchor: HLAnchor } | null
  >(null);

  const handleMouseUp = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) { setPending(null); return; }
    const range = sel.getRangeAt(0);
    const quote = range.toString(); // textContent と整合させるため sel ではなく range を使う
    if (!quote.trim()) { setPending(null); return; }
    const blockOf = (node: Node | null): HTMLElement | null => {
      const el = node?.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement | null);
      return el?.closest("[data-hl-block]") as HTMLElement | null;
    };
    const a = blockOf(range.startContainer);
    const b = blockOf(range.endContainer);
    if (!a || a !== b) { setPending(null); return; } // 単一ブロック内のみ
    const pre = document.createRange();
    pre.selectNodeContents(a);
    pre.setEnd(range.startContainer, range.startOffset);
    const start = pre.toString().length;
    const full = a.textContent ?? "";
    const end = start + quote.length;
    const rect = range.getBoundingClientRect();
    setPending({
      top: rect.top,
      left: rect.left + rect.width / 2,
      scope: a.getAttribute("data-hl-block") ?? "",
      anchor: {
        quote,
        prefix: full.slice(Math.max(0, start - HL_CTX), start),
        suffix: full.slice(end, end + HL_CTX),
      },
    });
  };

  const commit = () => {
    if (!pending) return;
    onCommit(pending.scope, pending.anchor);
    window.getSelection()?.removeAllRanges();
    setPending(null);
  };

  // 選択以外の場所のクリックでボタンを消す。ただしボタン自身へのmousedownは無視
  // （消すと後続clickが届かず確定できない／Phase1で踏んだ罠）。
  useEffect(() => {
    if (!pending) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("[data-marker-btn]")) return;
      setPending(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [pending]);

  const pickTerm = () => {
    if (!pending || !onPickTerm) return;
    const text = pending.anchor.quote.trim();
    window.getSelection()?.removeAllRanges();
    setPending(null);
    if (text) onPickTerm(text);
  };

  const marker = pending ? (
    <div
      data-marker-btn=""
      style={{
        position: "fixed",
        top: pending.top,
        left: pending.left,
        transform: "translate(-50%, -100%) translateY(-6px)",
        zIndex: 50,
      }}
      className="flex items-center gap-1.5 print:hidden"
    >
      <button
        data-marker-btn=""
        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onClick={commit}
        className="inline-flex items-center gap-1 rounded-full bg-yellow-400 px-2.5 py-1 text-xs font-medium text-yellow-950 shadow-lg hover:bg-yellow-500"
      >
        <Highlighter className="h-3.5 w-3.5" />
        マーカー
      </button>
      {onPickTerm && (
        <button
          data-marker-btn=""
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onClick={pickTerm}
          className="inline-flex items-center gap-1 rounded-full bg-blue-600 px-2.5 py-1 text-xs font-medium text-white shadow-lg hover:bg-blue-700"
        >
          <BookPlus className="h-3.5 w-3.5" />
          単語帳に追加
        </button>
      )}
    </div>
  ) : null;

  return { handleMouseUp, marker };
}

// Markdown描画の中の該当テキストを<mark>で囲む rehype プラグインを作る。
// 各テキストノード内で「引用＋前後文脈」を探し、見つかれば mark 要素に分割する。
// （太字などをまたぐ選択＝複数ノードにまたがる引用は一致せず描画されない＝既知の制限）
function makeRehypeHighlight(highlights: SummaryHighlight[]) {
  return () => (tree: Root) => {
    if (highlights.length === 0) return;
    visit(tree, "text", (node, index, parent) => {
      if (!parent || index == null) return;
      for (let hi = 0; hi < highlights.length; hi++) {
        const loc = locateHighlight(node.value, highlights[hi]);
        if (!loc || loc.end <= loc.start) continue;
        const before = node.value.slice(0, loc.start);
        const mid = node.value.slice(loc.start, loc.end);
        const after = node.value.slice(loc.end);
        const repl: Root["children"] = [];
        if (before) repl.push({ type: "text", value: before });
        repl.push({
          type: "element",
          tagName: "mark",
          properties: { dataHlIdx: String(hi) },
          children: [{ type: "text", value: mid }],
        });
        if (after) repl.push({ type: "text", value: after });
        parent.children.splice(index, 1, ...repl);
        // after があればそのノードを再訪して残りのハイライトも処理する
        return after ? index + repl.length - 1 : index + repl.length;
      }
      return SKIP;
    });
  };
}

// 総括などMarkdown本文を、ハイライト付きで描画する。
function HighlightedMarkdown({
  text,
  highlights,
  onRemove,
}: {
  text: string;
  highlights: SummaryHighlight[];
  onRemove: (h: SummaryHighlight) => void;
}) {
  const rehypePlugins = useMemo(() => [makeRehypeHighlight(highlights)], [highlights]);
  const components = useMemo<Components>(
    () => ({
      ...markdownComponents,
      mark: (props) => {
        const idx = Number(
          (props as { "data-hl-idx"?: string })["data-hl-idx"] ??
            (props as { node?: { properties?: { dataHlIdx?: string } } }).node?.properties?.dataHlIdx ??
            -1
        );
        const h = highlights[idx];
        return (
          <mark
            onClick={() => h && onRemove(h)}
            className={MARK_CLASS}
            title="クリックでマーカーを解除"
          >
            {props.children}
          </mark>
        );
      },
    }),
    [highlights, onRemove]
  );
  return (
    <ReactMarkdown rehypePlugins={rehypePlugins} components={components}>
      {text}
    </ReactMarkdown>
  );
}

// ── 単語カード（統合ロジック付き） ──────────────────────────────────
function GlossaryCard({
  term,
  onSelectView,
  onDeleteTerm,
  onRenameTerm,
  onFocusTerm,
  isFocused,
  concealed = false,
  highlights,
  onAddHighlight,
  onRemoveHighlight,
}: {
  term: GlossaryTerm;
  onSelectView: (view: TeacherView) => void;
  onDeleteTerm: (term: string) => void;
  onRenameTerm: (oldTerm: string, newTerm: string) => void;
  onFocusTerm: (term: string) => void;
  isFocused: boolean;
  concealed?: boolean;
  highlights: GlossaryHighlight[];
  onAddHighlight: (h: GlossaryHighlight) => void;
  onRemoveHighlight: (h: GlossaryHighlight) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [termDraft, setTermDraft] = useState(term.term);

  // ドラッグ選択 →「マーカー」ボタン（共通フック）。scope=termKey で保存する。
  const { handleMouseUp, marker } = useRangeMarker((scope, anchor) =>
    onAddHighlight({ termKey: scope, color: "yellow", ...anchor })
  );

  // 暗記モードの ON/OFF が切り替わったら全カードを再び隠す
  useEffect(() => {
    setRevealed(false);
  }, [concealed]);

  const commitRename = () => {
    setEditing(false);
    const next = termDraft.trim();
    if (next && next !== term.term) onRenameTerm(term.term, next);
  };

  const [consolidated, setConsolidated] = useState<string | null>(() =>
    term.definitions.length >= 2 ? loadConsolidatedCache(term.term, term.definitions) : null
  );
  const [consolidating, setConsolidating] = useState(false);
  const didRun = useRef(false);

  useEffect(() => {
    if (term.definitions.length < 2) return;
    if (consolidated !== null) return;
    if (didRun.current) return;
    didRun.current = true;

    let cancelled = false; // 単語帳を離れたら、順番待ちのカードはAPIを叩かず終わる
    setConsolidating(true);
    withConsolidateSlot(async () => {
      if (cancelled) return null;
      const r = await aiFetch("/api/glossary-consolidate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ term: term.term, definitions: term.definitions }),
      });
      return r.json();
    })
      .then((data) => {
        const c = data?.consolidated;
        if (c) {
          saveConsolidatedCache(term.term, term.definitions, c);
          setConsolidated(c);
        }
      })
      .catch(() => {}) // 失敗時は統合前の複数定義表示のまま（次回開いたとき再試行される）
      .finally(() => setConsolidating(false));
    return () => { cancelled = true; };
  }, [term, consolidated]);

  const displayDefs =
    term.definitions.length >= 2
      ? consolidated !== null
        ? [consolidated]
        : term.definitions
      : term.definitions;

  return (
    <div className={`border rounded-lg p-3 space-y-1.5 relative group ${isFocused ? "border-violet-400 bg-violet-50/40" : ""}`}>
      <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => {
            setTermDraft(term.term);
            setEditing(true);
          }}
          className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-blue-600"
          title="用語名を修正（読みの間違いなど）"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => onFocusTerm(term.term)}
          className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-violet-600"
          title="質問ペインで質問する"
        >
          <MessageCircle className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => onDeleteTerm(term.term)}
          className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
          title="この用語を非表示"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex items-center gap-1.5 pr-16">
        {editing ? (
          <input
            type="text"
            value={termDraft}
            autoFocus
            onChange={(e) => setTermDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setEditing(false);
            }}
            className="w-full rounded border border-blue-300 bg-background px-1.5 py-0.5 text-sm font-bold text-primary focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        ) : (
          <p className="text-sm font-bold text-primary">{term.term}</p>
        )}
        {consolidating && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />}
      </div>
      {concealed && !revealed ? (
        <button
          onClick={() => setRevealed(true)}
          className="w-full rounded-md border border-dashed border-violet-200 bg-violet-50/50 py-3 text-xs text-violet-500 hover:bg-violet-100/60 transition-colors"
        >
          クリックで意味を表示
        </button>
      ) : (
        <>
          <div onMouseUp={handleMouseUp}>
            {displayDefs.map((d, i) => (
              <p key={i} data-hl-block={term.term.toLowerCase()} className="text-sm text-foreground leading-relaxed">
                {renderWithHighlights(d, highlights, onRemoveHighlight)}
              </p>
            ))}
          </div>
          {marker}
          <div className="flex flex-wrap gap-1 pt-1">
            {term.occurrences.map((o) => (
              <button
                key={`${o.courseKey}__${o.lessonName}__${o.questionInfo}`}
                onClick={() =>
                  onSelectView({
                    type: "question",
                    courseKey: o.courseKey,
                    lessonName: o.lessonName,
                    questionInfo: o.questionInfo,
                  })
                }
                className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs text-blue-700 hover:bg-blue-100 transition-colors"
                title={`${o.courseName} ／ ${o.lessonName}`}
              >
                {o.lessonName} {o.questionInfo}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── 単語帳ビュー ────────────────────────────────────────────────────
function GlossaryView({
  studyLog,
  onSelectView,
  deletedTerms,
  onDeleteTerm,
  onRenameTerm,
  focusTerm,
  onFocusTerm,
  highlights,
  onAddHighlight,
  onRemoveHighlight,
}: {
  studyLog: StudyLog;
  onSelectView: (view: TeacherView) => void;
  deletedTerms: string[];
  onDeleteTerm: (term: string) => void;
  onRenameTerm: (oldTerm: string, newTerm: string) => void;
  focusTerm: string | null;
  onFocusTerm: (term: string) => void;
  highlights: GlossaryHighlight[];
  onAddHighlight: (h: GlossaryHighlight) => void;
  onRemoveHighlight: (h: GlossaryHighlight) => void;
}) {
  const [query, setQuery] = useState("");
  const [courseFilter, setCourseFilter] = useState<string>("all");
  const [memorizeMode, setMemorizeMode] = useState(false);

  const allTerms = buildGlossary(studyLog);
  const deletedSet = new Set(deletedTerms.map((t) => t.toLowerCase()));
  const terms = allTerms.filter((t) => !deletedSet.has(t.term.toLowerCase()));

  if (terms.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
        <BookMarked className="h-10 w-10 opacity-20" />
        <p className="text-sm">まだ用語がありません</p>
        <p className="text-xs">問題を解くと用語解説から自動で単語帳が作られます</p>
      </div>
    );
  }

  // 用語が1語以上登場するコースだけをフィルタ候補に出す
  const courses = studyLog.courses.filter((c) =>
    terms.some((t) => t.occurrences.some((o) => o.courseKey === c.courseKey))
  );

  const normalizedQuery = normalizeForSearch(query.trim());
  const filtered = terms.filter((t) => {
    if (
      courseFilter !== "all" &&
      !t.occurrences.some((o) => o.courseKey === courseFilter)
    ) {
      return false;
    }
    if (normalizedQuery) {
      const haystack = normalizeForSearch(
        [t.term, ...t.definitions].join("\n")
      );
      if (!haystack.includes(normalizedQuery)) return false;
    }
    return true;
  });

  return (
    <div className="space-y-4">
      {/* ヘッダー + 暗記モードトグル */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-foreground">単語帳</h2>
          <p className="text-xs text-muted-foreground mt-1">
            {filtered.length === terms.length
              ? `${terms.length}語`
              : `${filtered.length}語 / 全${terms.length}語`}
          </p>
        </div>
        <button
          onClick={() => setMemorizeMode((v) => !v)}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors shrink-0 ${
            memorizeMode
              ? "border-violet-300 bg-violet-100 text-violet-700"
              : "border-border bg-background text-muted-foreground hover:bg-muted"
          }`}
          title="意味を隠して暗記チェック"
        >
          {memorizeMode ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          暗記モード
        </button>
      </div>

      {/* 検索ボックス */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="用語・意味で検索（ひらがなでもOK）"
          className="w-full rounded-md border bg-background pl-8 pr-8 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-muted text-muted-foreground"
            title="クリア"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* コース別フィルタ */}
      {courses.length >= 2 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setCourseFilter("all")}
            className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
              courseFilter === "all"
                ? "border-blue-300 bg-blue-100 text-blue-700 font-medium"
                : "border-border bg-background text-muted-foreground hover:bg-muted"
            }`}
          >
            すべて
          </button>
          {courses.map((c) => (
            <button
              key={c.courseKey}
              onClick={() => setCourseFilter(c.courseKey)}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors max-w-[180px] truncate ${
                courseFilter === c.courseKey
                  ? "border-blue-300 bg-blue-100 text-blue-700 font-medium"
                  : "border-border bg-background text-muted-foreground hover:bg-muted"
              }`}
              title={c.courseName}
            >
              {c.courseName}
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-muted-foreground">
          <Search className="h-8 w-8 opacity-20" />
          <p className="text-sm">該当する用語がありません</p>
          <p className="text-xs">検索語やコースフィルタを変えてみてください</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((t) => (
            <GlossaryCard
              key={t.term}
              term={t}
              onSelectView={onSelectView}
              onDeleteTerm={onDeleteTerm}
              onRenameTerm={onRenameTerm}
              onFocusTerm={onFocusTerm}
              isFocused={focusTerm?.toLowerCase() === t.term.toLowerCase()}
              concealed={memorizeMode}
              highlights={highlights.filter((h) => h.termKey === t.term.toLowerCase())}
              onAddHighlight={onAddHighlight}
              onRemoveHighlight={onRemoveHighlight}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── まとめの「自分の気づき」欄 ──────────────────────────────────────
// Q&Aから承認制で溜まる気づき（studyLog.summaryInsights）。総括の再生成とは独立。
// まとめ本文の後・図解の前に置く。PDF出力に含める（削除ボタンだけ print:hidden）。
function InsightsSection({
  insights,
  onRemove,
}: {
  insights: SummaryInsight[];
  onRemove: (id: string) => void;
}) {
  if (insights.length === 0) return null;
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 space-y-2">
      <h3 className="text-sm font-semibold text-amber-800">💭 自分の気づき（Q&Aから）</h3>
      <div className="space-y-2">
        {insights.map((i) => (
          <div key={i.id} className="group rounded-md bg-white/70 border border-amber-100 p-2">
            <div className="flex items-start gap-2">
              <p className="flex-1 text-xs text-foreground leading-relaxed whitespace-pre-wrap">{i.text}</p>
              <button
                onClick={() => onRemove(i.id)}
                className="shrink-0 p-0.5 rounded text-muted-foreground/50 opacity-0 group-hover:opacity-100 hover:text-destructive hover:bg-destructive/10 transition-opacity print:hidden"
                title="この気づきを削除"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              「{i.sourceQuestion}」の質問から・
              {new Date(i.timestamp).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── レッスンまとめ（ハイライト対応） ───────────────────────────────
function LessonSummary({
  lesson,
  view,
  diagramLoadingKey,
  onGenerateDiagram,
  highlights,
  onAddHighlight,
  onRemoveHighlight,
  glossary,
  onAddTerm,
  onOpenGlossary,
  insights,
  onRemoveInsight,
}: {
  lesson: LessonData;
  view: Extract<TeacherView, { type: "lesson" }>;
  diagramLoadingKey: string | null;
  onGenerateDiagram: (view: TeacherView) => void;
  highlights: SummaryHighlight[];
  onAddHighlight: (h: SummaryHighlight) => void;
  onRemoveHighlight: (h: SummaryHighlight) => void;
  glossary: GlossaryTerm[];
  onAddTerm: (term: string, definition: string) => void;
  onOpenGlossary: (term: string) => void;
  insights: SummaryInsight[];
  onRemoveInsight: (id: string) => void;
}) {
  const { startAdd, dialog } = useGlossaryTermAdder({
    getContext: () =>
      [lesson.lessonName, ...lesson.questions.map((q) => q.keyLearning)].join("\n"),
    glossary,
    onAddTerm,
    onOpenGlossary,
  });
  const { handleMouseUp, marker } = useRangeMarker(
    (scope, anchor) => onAddHighlight({ scope, color: "yellow", ...anchor }),
    startAdd
  );
  const hlFor = (scope: string) => highlights.filter((h) => h.scope === scope);
  return (
    <div id="teacher-print-area" className="space-y-4" onMouseUp={handleMouseUp}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-foreground">{lesson.lessonName} まとめ</h2>
          <p className="text-xs text-muted-foreground mt-1">{lesson.questions.length}問学習済み</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <DiagramButton
            hasDiagram={!!(lesson.diagramHtml || lesson.diagram)}
            loading={diagramLoadingKey === `${view.courseKey}__${view.lessonName}`}
            onGenerate={() => onGenerateDiagram(view)}
          />
        </div>
      </div>
      <div className="space-y-3">
        {lesson.questions.map((q) => {
          const scope = `kl:${view.courseKey}__${view.lessonName}__${q.questionInfo}`;
          return (
            <div key={q.questionInfo} className="border rounded-lg p-3 space-y-1">
              <p className="text-xs font-bold text-primary">{q.questionInfo}</p>
              <p data-hl-block={scope} className="text-sm text-foreground">
                {renderWithHighlights(q.keyLearning, hlFor(scope), onRemoveHighlight)}
              </p>
            </div>
          );
        })}
      </div>
      {/* 気づき欄はまとめ本文の後・図解の前（Q&Aから承認制で蓄積） */}
      <InsightsSection insights={insights} onRemove={onRemoveInsight} />
      {/* 図解はテキストの後ろに置く（図解を作ってもまとめ本文がそのまま読めるように） */}
      {lesson.diagramHtml ? (
        <HtmlDiagram html={lesson.diagramHtml} />
      ) : (
        lesson.diagram && <MermaidDiagram code={lesson.diagram} />
      )}
      {marker}
      {dialog}
    </div>
  );
}

// ── コースまとめ（ハイライト対応） ─────────────────────────────────
function CourseSummary({
  course,
  view,
  diagramLoadingKey,
  onGenerateDiagram,
  overviewLoadingKey,
  onRegenerateOverview,
  highlights,
  onAddHighlight,
  onRemoveHighlight,
  glossary,
  onAddTerm,
  onOpenGlossary,
  insights,
  onRemoveInsight,
}: {
  course: CourseData;
  view: Extract<TeacherView, { type: "course" }>;
  diagramLoadingKey: string | null;
  onGenerateDiagram: (view: TeacherView) => void;
  overviewLoadingKey: string | null;
  onRegenerateOverview: (courseKey: string) => void;
  highlights: SummaryHighlight[];
  onAddHighlight: (h: SummaryHighlight) => void;
  onRemoveHighlight: (h: SummaryHighlight) => void;
  glossary: GlossaryTerm[];
  onAddTerm: (term: string, definition: string) => void;
  onOpenGlossary: (term: string) => void;
  insights: SummaryInsight[];
  onRemoveInsight: (id: string) => void;
}) {
  const { startAdd, dialog } = useGlossaryTermAdder({
    getContext: () =>
      [
        course.courseName,
        course.overviewText ?? "",
        ...course.lessons.flatMap((l) => [l.lessonName, ...l.questions.map((q) => q.keyLearning)]),
      ].join("\n"),
    glossary,
    onAddTerm,
    onOpenGlossary,
  });
  const { handleMouseUp, marker } = useRangeMarker(
    (scope, anchor) => onAddHighlight({ scope, color: "yellow", ...anchor }),
    startAdd
  );
  const hlFor = (scope: string) => highlights.filter((h) => h.scope === scope);
  const totalQ = course.lessons.reduce((s, l) => s + l.questions.length, 0);
  // 講義はセクション数だけ見せる（レッスン/問の数え方・Q番号は出さない）
  const isLecture = course.contentType === "lecture";
  return (
    <div id="teacher-print-area" className="space-y-5" onMouseUp={handleMouseUp}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-foreground">{course.courseName} まとめ</h2>
          <p className="text-xs text-muted-foreground mt-1">
            {isLecture
              ? `${course.seriesName} ／ ${course.lessons.length}セクション`
              : `${course.seriesName} ／ ${course.lessons.length}レッスン ／ ${totalQ}問学習済み`}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <DiagramButton
            hasDiagram={!!(course.diagramHtml || course.diagram)}
            loading={diagramLoadingKey === view.courseKey}
            onGenerate={() => onGenerateDiagram(view)}
          />
        </div>
      </div>
      <OverviewBlock
        text={course.overviewText}
        loading={overviewLoadingKey === view.courseKey}
        onRegenerate={() => onRegenerateOverview(view.courseKey)}
        scope={`ov:${view.courseKey}`}
        highlights={hlFor(`ov:${view.courseKey}`)}
        onRemoveHighlight={onRemoveHighlight}
        unitLabel={isLecture ? "講義" : "コース"}
      />
      {course.lessons.map((lesson) => (
        <div key={lesson.lessonName} className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground border-b pb-1">
            {lesson.lessonName}
          </h3>
          <div className="space-y-2 pl-2">
            {lesson.questions.map((q) => {
              const scope = `kl:${view.courseKey}__${lesson.lessonName}__${q.questionInfo}`;
              return (
                <div key={q.questionInfo} className="flex gap-2">
                  {!isLecture && (
                    <span className="text-xs font-bold text-primary shrink-0 w-8">{q.questionInfo}</span>
                  )}
                  <p data-hl-block={scope} className="text-xs text-foreground leading-relaxed">
                    {renderWithHighlights(q.keyLearning, hlFor(scope), onRemoveHighlight)}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {/* 気づき欄はまとめ本文の後・図解の前（Q&Aから承認制で蓄積） */}
      <InsightsSection insights={insights} onRemove={onRemoveInsight} />
      {/* 図解はテキストの後ろに置く（図解を作ってもまとめ本文がそのまま読めるように） */}
      {course.diagramHtml ? (
        <HtmlDiagram html={course.diagramHtml} />
      ) : (
        course.diagram && <MermaidDiagram code={course.diagram} />
      )}
      {marker}
      {dialog}
    </div>
  );
}

// ── 解説文：選択した語句を単語帳に追加する ────────────────────────────
// useRangeMarker と同じ「選択を捕捉して浮遊ボタン」方式だが、こちらは範囲ハイライト
// ではなく "選択テキスト" だけを取り出して単語帳登録に使う（アンカー不要）。
// mousedownでボタンを消す際 data-marker-btn を無視するのは Phase1 で踏んだ罠の対策。
function useSelectionPicker(onPick: (text: string, top: number, left: number) => void) {
  const [pending, setPending] = useState<{ top: number; left: number; text: string } | null>(null);

  const handleMouseUp = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) { setPending(null); return; }
    const range = sel.getRangeAt(0);
    const text = range.toString().trim();
    if (!text) { setPending(null); return; }
    const rect = range.getBoundingClientRect();
    setPending({ top: rect.top, left: rect.left + rect.width / 2, text });
  };

  useEffect(() => {
    if (!pending) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("[data-marker-btn]")) return;
      setPending(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [pending]);

  const dismiss = () => { window.getSelection()?.removeAllRanges(); setPending(null); };

  const button = pending ? (
    <button
      data-marker-btn=""
      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onClick={() => { onPick(pending.text, pending.top, pending.left); dismiss(); }}
      style={{
        position: "fixed",
        top: pending.top,
        left: pending.left,
        transform: "translate(-50%, -100%) translateY(-6px)",
        zIndex: 50,
      }}
      className="inline-flex items-center gap-1 rounded-full bg-blue-600 px-2.5 py-1 text-xs font-medium text-white shadow-lg hover:bg-blue-700 print:hidden"
    >
      <BookPlus className="h-3.5 w-3.5" />
      単語帳に追加
    </button>
  ) : null;

  return { handleMouseUp, button };
}

// ── 単語帳への手動追加の共通フック ──────────────────────────────────
// 選択語句 → AI定義ドラフト → 確認カード、の流れを問題解説と各まとめ画面で共用する。
// 既に単語帳にある用語は重複登録せず「登録済み」の案内を出す（2026-07-07要望）。
// 重複チェックは選択時と「追加する」押下時の2回行う（AI生成で用語名が変わるため）。
function useGlossaryTermAdder({
  getContext,
  glossary,
  onAddTerm,
  onOpenGlossary,
}: {
  getContext: () => string;
  glossary: GlossaryTerm[];
  onAddTerm: (term: string, definition: string) => void;
  onOpenGlossary: (term: string) => void;
}) {
  // 確認カード（AI生成中／編集可能なterm・definition）。
  const [draft, setDraft] = useState<{ term: string; definition: string; loading: boolean } | null>(null);
  const [existing, setExisting] = useState<GlossaryTerm | null>(null);

  const startAdd = async (selected: string) => {
    const hit = findGlossaryEntry(glossary, selected);
    if (hit) { setExisting(hit); return; }
    setDraft({ term: selected, definition: "", loading: true });
    try {
      const res = await aiFetch("/api/glossary-term", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // まとめ画面はコース全文だと長いので、AIに渡す文脈は先頭8000字に丸める
        body: JSON.stringify({ selectedText: selected, context: getContext().slice(0, 8000) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "生成に失敗しました");
      setDraft({ term: data.term || selected, definition: data.definition || "", loading: false });
    } catch {
      // 生成失敗時も手入力できるよう、選択語をtermに入れた空フォームにする。
      setDraft({ term: selected, definition: "", loading: false });
    }
  };

  const commit = () => {
    if (!draft || !draft.term.trim() || !draft.definition.trim()) return;
    const hit = findGlossaryEntry(glossary, draft.term);
    if (hit) { setDraft(null); setExisting(hit); return; }
    onAddTerm(draft.term, draft.definition);
    setDraft(null);
  };

  const dialog = (
    <>
      {draft && (
        <div className="not-prose fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4 print:hidden">
          <div className="w-full max-w-md rounded-xl border bg-background p-4 shadow-xl space-y-3">
            <div className="flex items-center gap-2">
              <BookPlus className="h-4 w-4 text-blue-600" />
              <h3 className="text-sm font-semibold">単語帳に追加</h3>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">用語名</label>
              <input
                value={draft.term}
                onChange={(e) => setDraft((d) => d && { ...d, term: e.target.value })}
                className="w-full rounded-md border px-2 py-1.5 text-sm"
                placeholder="例: Next.js(ネクストジェイエス)"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">定義</label>
              <textarea
                value={draft.definition}
                onChange={(e) => setDraft((d) => d && { ...d, definition: e.target.value })}
                rows={4}
                className="w-full rounded-md border px-2 py-1.5 text-sm resize-y"
                placeholder={draft.loading ? "AIが定義を作成中..." : "やさしい定義（1〜2文）"}
              />
              {draft.loading && (
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> AIが定義を作成中...
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDraft(null)}
                className="rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
              >
                キャンセル
              </button>
              <button
                onClick={commit}
                disabled={!draft.term.trim() || !draft.definition.trim()}
                className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" />
                追加する
              </button>
            </div>
          </div>
        </div>
      )}

      {existing && (
        <div className="not-prose fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4 print:hidden">
          <div className="w-full max-w-md rounded-xl border bg-background p-4 shadow-xl space-y-3">
            <div className="flex items-center gap-2">
              <BookMarked className="h-4 w-4 text-violet-600" />
              <h3 className="text-sm font-semibold">既に単語帳に登録済みです</h3>
            </div>
            <p className="text-sm font-medium">{existing.term}</p>
            {existing.definitions[0] && (
              <p className="text-xs text-muted-foreground leading-relaxed">
                {existing.definitions[0]}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setExisting(null)}
                className="rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
              >
                閉じる
              </button>
              <button
                onClick={() => { onOpenGlossary(existing.term); setExisting(null); }}
                className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700"
              >
                <BookMarked className="h-3.5 w-3.5" />
                単語帳で開く
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  return { startAdd, dialog };
}

// 問題の解説を描画し、選択した語句を単語帳に追加できるようにする。
function ExplanationView({
  explanation,
  glossary,
  onAddTerm,
  onOpenGlossary,
}: {
  explanation: string;
  glossary: GlossaryTerm[];
  onAddTerm: (term: string, definition: string) => void;
  onOpenGlossary: (term: string) => void;
}) {
  const { startAdd, dialog } = useGlossaryTermAdder({
    getContext: () => explanation,
    glossary,
    onAddTerm,
    onOpenGlossary,
  });
  const { handleMouseUp, button } = useSelectionPicker((text) => startAdd(text));

  return (
    <div className="prose-sm max-w-none" onMouseUp={handleMouseUp}>
      <ReactMarkdown components={questionMarkdownComponents}>{explanation}</ReactMarkdown>
      {button}
      {dialog}
    </div>
  );
}

// ── コンテンツ描画 ──────────────────────────────────────────────────
function renderContent(
  studyLog: StudyLog,
  teacherView: TeacherView,
  onSelectView: (view: TeacherView) => void,
  deletedGlossaryTerms: string[],
  onDeleteGlossaryTerm: (term: string) => void,
  onRenameGlossaryTerm: (oldTerm: string, newTerm: string) => void,
  glossaryFocusTerm: string | null,
  onFocusGlossaryTerm: (term: string) => void,
  glossaryHighlights: GlossaryHighlight[],
  onAddGlossaryHighlight: (h: GlossaryHighlight) => void,
  onRemoveGlossaryHighlight: (h: GlossaryHighlight) => void,
  summaryHighlights: SummaryHighlight[],
  onAddSummaryHighlight: (h: SummaryHighlight) => void,
  onRemoveSummaryHighlight: (h: SummaryHighlight) => void,
  diagramLoadingKey: string | null,
  onGenerateDiagram: (view: TeacherView) => void,
  overviewLoadingKey: string | null,
  onRegenerateOverview: (courseKey: string) => void,
  onAddManualGlossaryTerm: (term: string, definition: string) => void,
  glossary: GlossaryTerm[],
  summaryInsights: SummaryInsight[],
  onRemoveInsight: (id: string) => void
): React.ReactNode {
  if (!teacherView) return null;

  // 「登録済み」案内から単語帳の該当カードへ飛ぶ
  const openGlossary = (term: string) => {
    onSelectView({ type: "glossary" });
    onFocusGlossaryTerm(term);
  };

  if (teacherView.type === "glossary") {
    return (
      <GlossaryView
        studyLog={studyLog}
        onSelectView={onSelectView}
        deletedTerms={deletedGlossaryTerms}
        onDeleteTerm={onDeleteGlossaryTerm}
        onRenameTerm={onRenameGlossaryTerm}
        focusTerm={glossaryFocusTerm}
        onFocusTerm={onFocusGlossaryTerm}
        highlights={glossaryHighlights}
        onAddHighlight={onAddGlossaryHighlight}
        onRemoveHighlight={onRemoveGlossaryHighlight}
      />
    );
  }

  if (teacherView.type === "question") {
    const course = studyLog.courses.find((c) => c.courseKey === teacherView.courseKey);
    const lesson = course?.lessons.find((l) => l.lessonName === teacherView.lessonName);
    const q = lesson?.questions.find((q) => q.questionInfo === teacherView.questionInfo);
    const explanation = q?.explanation ?? "";
    return (
      <ExplanationView
        explanation={explanation}
        glossary={glossary}
        onAddTerm={onAddManualGlossaryTerm}
        onOpenGlossary={openGlossary}
      />
    );
  }

  if (teacherView.type === "lesson") {
    const course = studyLog.courses.find((c) => c.courseKey === teacherView.courseKey);
    const lesson = course?.lessons.find((l) => l.lessonName === teacherView.lessonName);
    if (!lesson) return null;
    return (
      <LessonSummary
        lesson={lesson}
        view={teacherView}
        diagramLoadingKey={diagramLoadingKey}
        onGenerateDiagram={onGenerateDiagram}
        highlights={summaryHighlights}
        onAddHighlight={onAddSummaryHighlight}
        onRemoveHighlight={onRemoveSummaryHighlight}
        glossary={glossary}
        onAddTerm={onAddManualGlossaryTerm}
        onOpenGlossary={openGlossary}
        insights={summaryInsights.filter(
          (i) => i.scope === `l:${teacherView.courseKey}__${teacherView.lessonName}`
        )}
        onRemoveInsight={onRemoveInsight}
      />
    );
  }

  if (teacherView.type === "course") {
    const course = studyLog.courses.find((c) => c.courseKey === teacherView.courseKey);
    if (!course) return null;
    return (
      <CourseSummary
        course={course}
        view={teacherView}
        diagramLoadingKey={diagramLoadingKey}
        onGenerateDiagram={onGenerateDiagram}
        overviewLoadingKey={overviewLoadingKey}
        onRegenerateOverview={onRegenerateOverview}
        highlights={summaryHighlights}
        onAddHighlight={onAddSummaryHighlight}
        onRemoveHighlight={onRemoveSummaryHighlight}
        glossary={glossary}
        onAddTerm={onAddManualGlossaryTerm}
        onOpenGlossary={openGlossary}
        insights={summaryInsights.filter((i) => i.scope === `c:${teacherView.courseKey}`)}
        onRemoveInsight={onRemoveInsight}
      />
    );
  }

  return null;
}

export default function TeacherPane({
  studyLog,
  teacherView,
  isLoading,
  hasScreenshots,
  currentLessonInfo,
  error,
  onSelectView,
  deletedGlossaryTerms = [],
  onDeleteGlossaryTerm = () => {},
  onRenameGlossaryTerm = () => {},
  glossaryFocusTerm = null,
  onFocusGlossaryTerm = () => {},
  glossaryHighlights = [],
  onAddGlossaryHighlight = () => {},
  onRemoveGlossaryHighlight = () => {},
  summaryHighlights = [],
  onAddSummaryHighlight = () => {},
  onRemoveSummaryHighlight = () => {},
  diagramLoadingKey = null,
  onGenerateDiagram = () => {},
  overviewLoadingKey = null,
  onRegenerateOverview = () => {},
  onAddManualGlossaryTerm = () => {},
  summaryInsights = [],
  onRemoveInsight = () => {},
}: TeacherPaneProps) {
  // 単語帳への重複登録チェック用（非表示にした用語は「未登録」扱いにして再追加を許す）
  const glossaryForDup = useMemo(() => {
    const all = buildGlossary(studyLog);
    const deletedSet = new Set(deletedGlossaryTerms.map((t) => t.toLowerCase()));
    return all.filter((t) => !deletedSet.has(t.term.toLowerCase()));
  }, [studyLog, deletedGlossaryTerms]);

  const [printHint, setPrintHint] = useState(false);
  const printHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (printHintTimer.current) clearTimeout(printHintTimer.current);
  }, []);

  // 講義（contentType: "lecture"）ではQ番号やコース/レッスン表記を出さない
  const viewCourse =
    teacherView && teacherView.type !== "glossary"
      ? studyLog.courses.find((c) => c.courseKey === teacherView.courseKey)
      : undefined;
  const isLectureView = viewCourse?.contentType === "lecture";
  const viewLabel =
    teacherView?.type === "course"
      ? (isLectureView ? "講義まとめ" : "コースまとめ")
      : teacherView?.type === "lesson"
      ? "レッスンまとめ"
      : teacherView?.type === "glossary"
      ? "単語帳"
      : teacherView?.type === "question"
      ? (isLectureView ? teacherView.lessonName : teacherView.questionInfo)
      : null;

  // PDF出力はレッスン/コースまとめ表示時のみ
  const printable = teacherView?.type === "lesson" || teacherView?.type === "course";
  // 保存PDFの既定ファイル名。並び順が分かるよう シリーズ名｜コース名｜レッスン名 を全て載せる。
  // ファイル名に使えない「/」は全角「／」に置換する。
  const printTitle = (() => {
    const join = (...parts: (string | undefined)[]) =>
      parts.filter((p) => p && p.trim()).map((p) => p!.replace(/\//g, "／")).join("｜");
    if (teacherView?.type === "lesson") {
      const c = studyLog.courses.find((c) => c.courseKey === teacherView.courseKey);
      return join(c?.seriesName, c?.courseName, teacherView.lessonName) || teacherView.lessonName;
    }
    if (teacherView?.type === "course") {
      const c = studyLog.courses.find((c) => c.courseKey === teacherView.courseKey);
      return join(c?.seriesName, c?.courseName) || c?.courseName || "コース";
    }
    return "まとめ";
  })();

  // まとめ領域をbody直下にクローンして印刷する（4ペイン/スクロールのレイアウトに
  // 干渉されず全幅で出力するため）。ブラウザの「PDFに保存」でPDF化できる。
  // NotebookLMはこちらからは開かない（既に開いてある「AIドリル」タブにユーザーが
  // 保存したPDFをドロップする運用）。
  // 理由: NotebookLMのCOOPヘッダ(same-origin-allow-popups)でタブの「名前」が消去され、
  // 名前付きタブの再利用が効かないため、開くと毎回タブが増えてしまう。また他オリジンの
  // 既存タブを探して前面化するAPIはブラウザに無いので、自動で開かないのが最善。
  const handlePrint = () => {
    const src = document.getElementById("teacher-print-area");
    if (!src) return;
    setPrintHint(true);
    if (printHintTimer.current) clearTimeout(printHintTimer.current);
    printHintTimer.current = setTimeout(() => setPrintHint(false), 12000);

    const clone = src.cloneNode(true) as HTMLElement;
    clone.id = "print-clone";
    document.body.appendChild(clone);
    document.body.classList.add("printing");
    const prevTitle = document.title;
    document.title = printTitle; // 保存PDFの既定ファイル名になる
    const cleanup = () => {
      clone.remove();
      document.body.classList.remove("printing");
      document.title = prevTitle;
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.print();
  };

  return (
    <div className="flex flex-col h-full border-r">
      <div className="p-3 border-b flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <GraduationCap className="h-3.5 w-3.5 text-blue-500 shrink-0" />
          <h2 className="text-xs font-bold text-blue-600 uppercase tracking-wider shrink-0">
            先生ペイン
          </h2>
          {viewLabel && (
            <Badge variant="outline" className="text-xs shrink-0">{viewLabel}</Badge>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {currentLessonInfo && (
            <p className="text-xs text-muted-foreground truncate hidden sm:block">
              {currentLessonInfo.series} › {currentLessonInfo.course}
            </p>
          )}
          {printable && (
            <div className="relative shrink-0 print:hidden">
              <button
                onClick={handlePrint}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors"
                title="このまとめをPDFで保存（印刷ダイアログで「PDFに保存」を選択）"
              >
                <FileDown className="h-3.5 w-3.5" />
                PDFで保存
              </button>

              {printHint && (
                <div className="absolute right-0 top-full z-20 mt-2 w-72 rounded-lg border bg-popover p-3 text-xs text-popover-foreground shadow-lg">
                  <p className="font-semibold text-foreground">📄 PDFを保存 → NotebookLMへ</p>
                  <ol className="mt-1.5 list-decimal space-y-0.5 pl-4 text-muted-foreground">
                    <li>印刷ダイアログで「PDFに保存」を選んで保存</li>
                    <li>隣の「NotebookLM」ボタンで AIドリル を開く</li>
                    <li>保存したPDFを「ソースを追加」へドロップ</li>
                    <li>Studio の「音声解説」をクリック</li>
                  </ol>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    ※ 音声が英語になる場合は ⚙️設定 →「出力言語」→ 日本語 に。
                  </p>
                </div>
              )}
            </div>
          )}
          {printable && (
            <button
              onClick={() => window.open(NOTEBOOKLM_NOTEBOOK_URL, "_blank", "noopener,noreferrer")}
              className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-100 transition-colors shrink-0 print:hidden"
              title="NotebookLM（AIドリル）を新しいタブで開きます"
            >
              <Headphones className="h-3.5 w-3.5" />
              NotebookLM
            </button>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin" />
              <p className="text-sm">スクリーンショットを読み取り中...</p>
              <p className="text-xs">シリーズ名・レッスン名・解説を同時に生成しています</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <p className="text-sm font-medium text-destructive">解析に失敗しました</p>
              <p className="text-xs text-muted-foreground max-w-xs break-all">{error}</p>
            </div>
          ) : teacherView ? (
            renderContent(studyLog, teacherView, onSelectView, deletedGlossaryTerms, onDeleteGlossaryTerm, onRenameGlossaryTerm, glossaryFocusTerm, onFocusGlossaryTerm, glossaryHighlights, onAddGlossaryHighlight, onRemoveGlossaryHighlight, summaryHighlights, onAddSummaryHighlight, onRemoveSummaryHighlight, diagramLoadingKey, onGenerateDiagram, overviewLoadingKey, onRegenerateOverview, onAddManualGlossaryTerm, glossaryForDup, summaryInsights, onRemoveInsight)
          ) : (
            hasScreenshots ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
                <GraduationCap className="h-10 w-10 opacity-20" />
                <p className="text-sm">解析準備中...</p>
              </div>
            ) : (
              <StepGuide />
            )
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
