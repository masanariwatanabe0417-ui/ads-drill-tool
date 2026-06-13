# ads-drill-tool — 本気AIドリル

## ⚡ 現在の状態（handoff.sh が自動更新）
<!-- STATE_START -->
- ブランチ: main / コミット: 12eb10d / 状態: ✅ クリーン
- 最終作業: feat: 図解化をvisual-explainer方式のリッチHTML図解に進化
- 次候補: ★今日(2026-06-13 最新)の完了分: 図解化を Mermaid → リッチHTML図解（visual-explainer方式）に進化（コミット12eb10d・main・GitHubへpush済み）。由来は ~/Desktop/src/creating-visual-explainers のClaude Codeスキル(.claude/skills形式)を移植。仕組み: 「図解化」ボタン→keyLearning一覧を app/api/diagram/route.ts（claude-sonnet-4-6・thinking無効・ストリーミング・SYSTEM_PROMPTでvisual-explainerの作法を指示）へ送り、<main>内の本文HTMLのみ生成→ app/api/diagram/template.ts の額縁(Tailwind CDN+Lucide+ADS配色)で包んだ自己完結HTMLを返す。保存は新フィールド diagramHtml（lib/types.ts のLessonData/CourseData。旧Mermaid diagram? は後方互換で温存）。表示は components/HtmlDiagram.tsx＝iframe(srcDoc, sandbox=allow-scripts等)で安全表示・額縁内scriptがpostMessageで実高さ通知→自動リサイズ・「別タブで開く/PDF」ボタン。studyLog保存は全置換なので残る。TeacherPaneは diagramHtml優先・無ければ旧MermaidDiagramにフォールバック。検証済: 実データ(DBがないと壊れる世界コース12問)で生成→先生ペイン内にインライン表示→studyLog.jsonにdiagramHtml永続化、tsc通過。コスト/速度実測: 1図解=出力約22KB・約47円・約93秒(Sonnet)。 ⚠️ 速度課題（未対応・ユーザー指示でローカル運用前提のため対策不要と判断）: 約93秒はVercel関数の60秒制限を超える→公開URLではタイムアウトする。route.tsに maxDuration=60 を入れてあるが本質的には公開には不向き。公開したくなったら B案=出力をコンパクト化（プロンプトで要点を絞る＋max_tokens下げる/今32000）or C案=ストリーミングをクライアントまで流す＋プラン側のmaxDuration見直し。モデル変更は route.ts の model 1行（haiku=安/速・低品質、opus-4-8=高品質/高コスト遅）。 🔖 安全地点: タグ pre-html-diagram → 66c48bd（HTML図解導入前）。元に戻すなら git reset --hard pre-html-diagram（GitHubにもpush済み）。作業ブランチ feature/html-visual-explainer はローカルに残置（不要なら削除可）。 ⚠️ ユーザー作業が1つ残り（前回から継続）: Vercelダッシュボード → ads-drill-tool → Settings → Environment Variables に APP_PASSCODE を追加 → Redeploy。設定するまで公開URLのAI機能は503で安全停止（課金なし＝保護は有効）。ローカルはAPP_PASSCODE未設定で従来通り素通し。 ⚠️ 開発の注意: ユーザーのnpm run dev起動中にnpm run buildすると.nextが壊れる。検証はtsc --noEmit基本。プレビューは.claude/launch.jsonのautoPort:trueで別ポート起動OK。 ★前提（変わらず）: 公開URL https://ads-drill-tool.vercel.app はVercel Productionブランチ=school-deploy-experimentで稼働。mainへのpushは公開URLに影響しない。ローカル=ファイル保存（.env.localのDATABASE_URLコメントアウト中）。データは~/Desktop/AIドリル取込済み/studyLog.json。 残りの候補: 図解の品質チューニング（実際に使って有用性確認・必要ならプロンプト/モデル調整）、シリーズまとめビューの新設（＋シリーズ単位の図解化）、解説のストリーミング対応、リポジトリのprivate化。 
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
