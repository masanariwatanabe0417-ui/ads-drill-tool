# ads-drill-tool — 本気AIドリル

## ⚡ 現在の状態（handoff.sh が自動更新）
<!-- STATE_START -->
- ブランチ: main / コミット: 0fa18b4 / 状態: ✅ クリーン
- 最終作業: NEXT_TASKS: 図解化（タスクA）完了を記録
- 次候補: ★今日(2026-06-13 続き)の完了分: A. 先生ペインの図解化（mainのみ・02ff2a9）。app/api/teacher/route.tsにAgent④（図解）を追加し4エージェント並列に。structured outputsでJSON保証、図解に向かない問題はapplicable=falseでスキップ、flowchart宣言で始まらない出力は破棄。図は解説Markdown末尾の```mermaidブロックとして合成＝保存形式（studyLog.json）は不変・既存データ無影響。components/MermaidDiagram.tsx（新規）がクライアント描画、構文エラー時は折りたたみフォールバック。TeacherPane.tsxのmarkdownComponentsでlanguage-mermaidを検出。mermaid@11.15.0追加。検証: tsc --noEmit / プレビューで描画確認 / 実スクショで/api/teacher実打ちOK（HTTP 200・9.6s・有効なmermaid生成）。 ⚠️ 図解化はmainのみ。公開URL（Productionブランチ=school-deploy-experiment）には未適用。適用したければcherry-pick 02ff2a9。 ⚠️ ユーザー作業が1つ残り（前回から継続）: Vercelダッシュボード → ads-drill-tool → Settings → Environment Variables に APP_PASSCODE（好きなパスコード）を追加 → Redeploy。設定するまで公開URLのAI機能は503で安全停止（課金は発生しない＝保護は既に有効）。ローカルはAPP_PASSCODE未設定なら従来通り素通しで影響なし。 ⚠️ 開発の注意: ユーザーのnpm run dev起動中にnpm run buildすると.nextが壊れる。検証はtsc --noEmit基本。プレビュー検証は.claude/launch.jsonのautoPort:trueで別ポート起動OK（今日3000と52979の並走で問題なし）。 メモ: 単語帳編集のマージは和集合なので「削除」は永続しない（削除UIは現状なし）。 ★前提（変わらず）: 公開URL https://ads-drill-tool.vercel.app はVercel Productionブランチ=school-deploy-experimentで稼働中。mainへのpushは公開URLに影響しない。ローカル=ファイル保存（.env.localのDATABASE_URLコメントアウト中、#を外せばDB復帰）。データは~/Desktop/AIドリル取込済み/studyLog.json。 残りの候補: C. ストリーミング対応（解説を逐次表示） D. リポジトリのprivate化 E. 図解の品質チューニング（実際の問題で図の有用性を見て、プロンプト調整 or 図の種類拡張） 
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
