# ads-drill-tool — 本気AIドリル

## ⚡ 現在の状態（handoff.sh が自動更新）
<!-- STATE_START -->
- ブランチ: main / コミット: 8beb149 / 状態: ⚠️ 未コミットあり
- 最終作業: feat: まとめUIを整理（音声で聞く削除／PDF名フル化／NotebookLMボタン追加）
- 次候補: ★最新(2026-06-14)の完了分: まとめUI整理＝音声化の最終形をNotebookLM(PDF方式)に確定（コミット8beb149・main・push済み）。components/panes/TeacherPane.tsx の上部バー（先生ペインのヘッダー、レッスン/コースまとめ表示時）に「PDFで保存」「NotebookLM」を横並び配置。図解化ボタンはまとめ見出しの隣に維持（＝出力/外部=上部バー、生成=見出し隣、で分離）。●PDFで保存=window.print方式。保存PDFの既定ファイル名は シリーズ名｜コース名｜レッスン名 のフル表記（コースまとめは シリーズ｜コース）。ファイル名に使えない / は全角／へ置換。押下後にPDF→NotebookLM手順ヒントを12秒表示（①PDFに保存②隣のNotebookLMボタンでAIドリルを開く③保存PDFを『ソースを追加』へドロップ④Studio音声解説／出力言語を日本語に）。●NotebookLMボタン=固定ノート『AIドリル』(https://notebooklm.google.com/notebook/811e6107-7677-470a-8cb3-197d867f0fac) を window.open で新規タブで開くだけ。検証: tsc通過・プレビュー実データ(DBコース12問)でボタン名/PDF名(シリーズ｜コース｜レッスン)/開くURL/ヒントを確認・:3000健全。 ★削除(2026-06-14): ①「音声で聞く」(Web Speech・components/AudioSummary.tsx) ②NotebookLM純コピー方式(components/NotebookLmExport.tsx＝まとめ文クリップボードコピー＋NotebookLMホームを開く)。両機能・両ファイルとも削除。①は不要、②はPDF方式に置換。 ★ブラウザ制約で不可能と確定（蒸し返さない・詳細はメモリ audio-via-notebooklm-copy.md）: (1)NotebookLMをアプリ内パネル(iframe)で表示=x-frame-options:DENYで全iframe拒否（図解化の自前HTML iframeとは別物） (2)既存タブを再利用してタブを増やさない=NotebookLMのCOOP(cross-origin-opener-policy: same-origin-allow-popups)でタブのwindow.nameが消去され名前付きターゲット再利用が効かない＋他オリジンの既存タブを探して前面化するブラウザAPIが無い→NotebookLMボタンは押すたび新規タブで開く (3)背面タブで開きドリルを前面のまま=合成クリックはisTrusted=falseで⌘+クリックの背面化が効かず前面になる＋NotebookLMがPWAインストール済みだとアンカー⌘+クリックはPWA別ウィンドウを起動。⚠️ ユーザーのNotebookLMノートは『AIドリル』にリネーム済(旧名 Git Merge: Principles of Automated Integration)。 ★図解化（現状=HTML版・コミット12eb10d）: 旧Mermaid方式から リッチHTML図解（visual-explainer方式）に進化済み。仕組み: 「図解化」ボタン→keyLearning一覧を app/api/diagram/route.ts（claude-sonnet-4-6・thinking無効・ストリーミング・SYSTEM_PROMPTでvisual-explainerの作法を指示）へ送り<main>内本文HTMLを生成→ app/api/diagram/template.ts の額縁(Tailwind CDN+Lucide+ADS配色)で包んだ自己完結HTMLを返す。保存は diagramHtml フィールド（lib/types.ts のLessonData/CourseData。旧Mermaid diagram? は後方互換で温存）。表示は components/HtmlDiagram.tsx＝iframe(srcDoc, sandbox)で安全表示・自動リサイズ・「別タブで開く/PDF」ボタン。TeacherPaneは diagramHtml優先・無ければ旧MermaidDiagramにフォールバック。コスト/速度実測: 1図解≈出力22KB・約47円・約93秒(Sonnet)。⚠️ 速度課題（ローカル運用前提のため対策不要と判断）: 93秒はVercel関数の60秒制限超→公開URLではタイムアウトする。公開したくなったら出力コンパクト化orクライアントまでストリーミング＋maxDuration見直し。モデル変更は route.ts の model 1行。🔖 安全地点: タグ pre-html-diagram → 66c48bd（HTML図解導入前）。 ⚠️ ユーザー作業が1つ残り（前回から継続）: Vercelダッシュボード → ads-drill-tool → Settings → Environment Variables に APP_PASSCODE（好きなパスコード）を追加 → Redeploy。設定するまで公開URLのAI機能は503で安全停止（課金は発生しない＝保護は既に有効）。ローカルはAPP_PASSCODE未設定なら従来通り素通しで影響なし。 ⚠️ 開発の注意: ユーザーのnpm run dev起動中にnpm run buildすると.nextが壊れる。検証はtsc --noEmit基本。プレビュー検証は.claude/launch.jsonのautoPort:trueで別ポート起動OK（ただし同一.nextを2つのdevが奪い合うと404/破損→検証後はプレビュー停止し:3000を1本に戻す）。 ★前提（変わらず）: 公開URL https://ads-drill-tool.vercel.app はVercel Productionブランチ=school-deploy-experimentで稼働中。mainへのpushは公開URLに影響しない。ローカル=ファイル保存（.env.localのDATABASE_URLコメントアウト中、#を外せばDB復帰）。データは~/Desktop/AIドリル取込済み/studyLog.json。 残りの候補: B. シリーズまとめビューの新設（＋シリーズ単位の図解化／NotebookLM・PDFボタン） C. 解説のストリーミング対応（逐次表示） D. リポジトリのprivate化 E. 図解の品質チューニング（実際に使って有用性確認・必要ならプロンプト/モデル調整） F. 音声の声質向上（NotebookLMに頼らずサーバ生成したい場合=OpenAI TTS等でmp3生成・別系統） 
<!-- STATE_END -->

## ⚠️ セッションのルール
- **作業フォルダ**: `~/Desktop/ads-drill-tool/`（2026-06-10にフォルダを一本化。入れ子・重複repoは解消済み）
- **正本はGitHub**: `github.com/masanariwatanabe0417-ui/ads-drill-tool`。迷ったらGitHubが正。
- **終了時**: コミット・プッシュ後に `bash handoff.sh` を実行すると上記が自動更新される
- ~~旧: 親フォルダ/入れ子の二重構造~~ → 解消済み。旧フォルダは `~/Desktop/_ads-drill-tool_OLD` に退避（確認後削除可）

## 概要
問題・解答のスクリーンショットを貼り付けると Claude AI が解説を生成。コース/レッスン/問題の階層で管理。

## スタック
- Next.js 14 (App Router) + TypeScript
- Tailwind CSS + shadcn/ui
- Anthropic SDK — haiku（高速）/ opus（高品質解説）

## 4ペイン構成
```
NavigationPane (w-60) | ScreenshotPane (w-72) | TeacherPane (flex-1) | QuestionPane (w-80)
```
- NavigationPane: コース/レッスン/問題ツリー
- ScreenshotPane: スクショ貼り付け
- TeacherPane: AI解説・単語帳表示
- QuestionPane: Q&Aチャット・単語帳編集

## 主要ファイル
| ファイル | 役割 |
|----------|------|
| `components/DrillTool.tsx` | 全状態管理 |
| `components/panes/TeacherPane.tsx` | 先生ペイン・単語帳UI |
| `components/panes/QuestionPane.tsx` | 質問ペイン |
| `lib/glossary.ts` | 単語帳ビルド・ソート・重複統合 |
| `app/api/teacher/route.ts` | 解説生成（3エージェント並列） |
| `app/api/question/route.ts` | Q&A・単語帳定義改善 |
| `app/api/glossary-consolidate/route.ts` | 複数定義をAIで統合 |

## 開発コマンド
```bash
npm run dev   # http://localhost:3000
```

## ⚠️ 鉄則
- APIキーは `.env.local` のみ。コード・コミット・mdに絶対書かない（過去に漏洩あり）
- PC間共有は GitHub push/pull。iCloud で .git を同期しない
