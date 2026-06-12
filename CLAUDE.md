# ads-drill-tool — 本気AIドリル

## ⚡ 現在の状態（handoff.sh が自動更新）
<!-- STATE_START -->
- ブランチ: main / コミット: 4d58643 / 状態: ✅ クリーン
- 最終作業: NEXT_TASKS: 本日の完了分⑦⑧と注意事項を次セッション向けに整理
- 次候補: ★今日(2026-06-13)の完了分: ①〜⑥（単語帳改良・自動取込ガード・用語名修正・保存マージ等） ⑦公開URLのAPIキー課金対策（middleware.tsでAIルート3つにパスコード保護。lib/passcode.tsのaiFetchが401時にprompt→localStorage保存→再試行。main/school-deploy-experiment両方適用済み） ⑧先生ペインの生JSON表示バグ修正（app/api/teacher/route.tsのAgent③をstructured outputs＝output_config.format+JSONスキーマ化でAPIレベル保証。保険のparseLooseJson/composeExplanation追加・Agent①にも適用。max_tokens 2048。壊れていたLesson2 Q2の保存データも修復済み・バックアップ/tmp/studyLog.backup.json。両ブランチ適用済み）。 ⚠️ ユーザー作業が1つ残り: Vercelダッシュボード → ads-drill-tool → Settings → Environment Variables に APP_PASSCODE（好きなパスコード）を追加 → Redeploy。設定するまで公開URLのAI機能は503で安全停止（課金は発生しない＝保護は既に有効）。ローカルはAPP_PASSCODE未設定なら従来通り素通しで影響なし。 ⚠️ 開発の注意: ユーザーのnpm run dev起動中にnpm run buildすると.nextが壊れる（今日発生→.next削除+dev再起動で復旧）。検証はtsc --noEmit基本。 メモ: 単語帳編集のマージは和集合なので「削除」は永続しない（削除UIは現状なし）。.claude/launch.jsonにautoPort:true追加済み。 ★前提（変わらず）: 公開URL https://ads-drill-tool.vercel.app はVercel Productionブランチ=school-deploy-experimentで稼働中（パスコード保護＋生JSON修正をcherry-pickで適用。他の凍結内容は不変）。mainへのpushは公開URLに影響しない。ローカル=ファイル保存（.env.localのDATABASE_URLコメントアウト中、#を外せばDB復帰）。データは~/Desktop/AIドリル取込済み/studyLog.json。 残りの候補: A. 先生ペインの図解化（Mermaid等・新エージェント追加） C. ストリーミング対応（解説を逐次表示） D. リポジトリのprivate化 
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
