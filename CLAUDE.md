# ads-drill-tool — 本気AIドリル

## ⚡ 現在の状態（handoff.sh が自動更新）
<!-- STATE_START -->
- ブランチ: main / コミット: 7250727 / 状態: ✅ クリーン
- 最終作業: NEXT_TASKS: 図解表示トラブルの解決とdevサーバー再起動を記録
- 次候補: ★今日(2026-06-13 続き)の完了分: A. 図解化（mainのみ・9ed4929で方針転換済み）。問題ごとの図解（Agent④）はQ単位だと有用な図にならず撤去→レッスンまとめ・コースまとめのヘッダーに「図解化」ボタンを配置する方式に変更。クリックでkeyLearning一覧をapp/api/diagram/route.ts（haiku・structured outputs・flowchart宣言検証）に送り、生成したMermaid図をLessonData/CourseDataのdiagram?フィールドに永続化（studyLog保存は全置換なのでそのまま残る）。生成済みなら図を表示＋「図解を再生成」ボタン。描画はcomponents/MermaidDiagram.tsx（構文エラー時は折りたたみフォールバック）。/api/diagramはmiddlewareのパスコード保護対象に追加済み。保存データに残っていた問題ごとの図解1件（Webの世界 L1 Q1）は除去済み（バックアップ/tmp/studyLog.before-diagram-strip.json）。検証: tsc / プレビューでコース図解の生成→SVG描画→リロード後も表示→studyLog.json永続化を確認。 ★追記（同日終盤）: ユーザー環境で「図を表示できませんでした」が出た件は解決済み。原因はmermaidインストール前から起動していた古いdevサーバー＋ブラウザの未リロード。devサーバーはClaude側で再起動済み（nohupでターミナル非依存・ログ/tmp/ads-drill-dev.log）。ユーザーのChromeで図解表示を実機確認済み。再発時はフォールバック表示をクリックするとエラー内容が見える（60c01ecで堅牢化: エラー表示・console.error・renderId採番でStrictMode二重実行にも安全）。 メモ: 「シリーズまとめ」というビューは現状存在しない（ナビはコース→レッスン→Qの3階層。シリーズ名はコースの表示ラベルのみ）。シリーズ単位の図解が欲しければシリーズまとめビューの新設が必要＝次の候補。 ⚠️ ユーザー作業が1つ残り（前回から継続）: Vercelダッシュボード → ads-drill-tool → Settings → Environment Variables に APP_PASSCODE（好きなパスコード）を追加 → Redeploy。設定するまで公開URLのAI機能は503で安全停止（課金は発生しない＝保護は既に有効）。ローカルはAPP_PASSCODE未設定なら従来通り素通しで影響なし。 ⚠️ 開発の注意: ユーザーのnpm run dev起動中にnpm run buildすると.nextが壊れる。検証はtsc --noEmit基本。プレビュー検証は.claude/launch.jsonのautoPort:trueで別ポート起動OK。 ★前提（変わらず）: 公開URL https://ads-drill-tool.vercel.app はVercel Productionブランチ=school-deploy-experimentで稼働中。mainへのpushは公開URLに影響しない。ローカル=ファイル保存（.env.localのDATABASE_URLコメントアウト中、#を外せばDB復帰）。データは~/Desktop/AIドリル取込済み/studyLog.json。 残りの候補: B. シリーズまとめビューの新設（＋シリーズ単位の図解化ボタン） C. ストリーミング対応（解説を逐次表示） D. リポジトリのprivate化 E. 図解の品質チューニング（実際に使ってみて図の有用性を確認、必要ならプロンプト調整・モデル変更） 
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
