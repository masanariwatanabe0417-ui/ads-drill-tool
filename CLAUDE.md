# ads-drill-tool — 本気AIドリル

## ⚡ 現在の状態（handoff.sh が自動更新）
<!-- STATE_START -->
- ブランチ: main / コミット: e1d8692 / 状態: ✅ クリーン
- 最終作業: NEXT_TASKS: ローカルをファイル保存に切替完了。DB版公開URLは維持
- 次候補: ★スクール課題①〜⑤すべて完了🎉 ⑤Vercelデプロイ完了（2026-06-13）: 公開URL https://ads-drill-tool.vercel.app ／Vercelプロジェクトads-drill-tool（チームmaru's projects・Hobby）／Productionブランチ=school-deploy-experiment／環境変数DATABASE_URL・ANTHROPIC_API_KEY設定済み／DBから6コース配信確認済み。デプロイ失敗の原因は2つ修正: (1)古いpnpm-lock.yamlでERR_PNPM_OUTDATED_LOCKFILE→pnpm関連ファイル削除しnpmに一本化 (2)watch-screenshots/study-logにforce-dynamic追加。今後はschool-deploy-experimentにpushすると自動で本番デプロイされる。★2026-06-13: school-deploy-experimentをmainにfast-forwardマージ済み。今後の開発はmainで（ローカル版ベースのレベルアップ）。mainへのpushは公開URLに影響しない（VercelのProductionブランチはschool-deploy-experimentのまま＝公開版は課題完成状態で凍結）。★保存方式は決定済み: ローカル=ファイル保存に切替完了（2026-06-13）。.env.localのDATABASE_URLをコメントアウト（#を外せばDB保存に即復帰可）。DBの最新データ(7コース)を~/Desktop/AIドリル取込済み/studyLog.jsonに書き出し済み。公開URLはVercel側の環境変数で動くため影響なし＝提出物はDB版のまま稼働中。次: ローカル版の機能強化（A〜D候補）。 ⚠️ 新規の注意: 公開URLは認証なしで誰でもアクセス可能＝先生ペインのAI解説を他人が使うとANTHROPIC_API_KEYの課金が発生しうる。対策候補: Vercel Deployment Protection / 簡易パスワード / D.リポジトリprivate化とあわせて検討 A. 先生ペインの図解化（Mermaid等・新エージェント追加） B. 単語帳の改良（コース別フィルタ・検索ボックス・暗記モード） C. ストリーミング対応（解説を逐次表示） D. リポジトリのprivate化 
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
