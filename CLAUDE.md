# ads-drill-tool — 本気AIドリル

## ⚡ 現在の状態（handoff.sh が自動更新）
<!-- STATE_START -->
- ブランチ: main / コミット: 6b556d5 / 状態: ✅ クリーン
- 最終作業: NEXT_TASKS: 本日の完了分を整理（次セッション引き継ぎ用）
- 次候補: ★今日(2026-06-13)の完了分: ①B.単語帳の改良（コース別フィルタ・ひらがなOK検索・暗記モード） ②「次の問題へ」でドリルパネル自動オープン＋自動取込ON ③自動取込の既存スクショ防止ガード（watch-screenshotsにmtimeチェック追加。デスクトップの古いスクショは拾わない） ④単語帳の用語名修正機能（カードの鉛筆ボタン→インライン編集。API(アピアイ)→API(エーピーアイ)修正適用済み） ⑤手動登録の保存消失対策（/api/study-logでglossaryOverrides/ManualTerms/TermRenamesを既存と和集合マージ＋アトミック書き込み。複数タブの後勝ち上書きで単語が消えていた問題を解消） ⑥単語帳の質問ボタンを吹き出しアイコンに変更（鉛筆との区別）。 メモ: 単語帳編集のマージは和集合なので「削除」は永続しない（削除UIは現状なし）。.claude/launch.jsonにautoPort:true追加済み（ポート3000使用中でも検証サーバーを別ポートで起動できる）。 ★前提（変わらず）: 公開URL https://ads-drill-tool.vercel.app はVercel Productionブランチ=school-deploy-experimentで凍結稼働中。mainへのpushは公開URLに影響しない。ローカル=ファイル保存（.env.localのDATABASE_URLコメントアウト中、#を外せばDB復帰）。データは~/Desktop/AIドリル取込済み/studyLog.json。 ⚠️ 注意（未対応）: 公開URLは認証なしで誰でもアクセス可能＝先生ペインのAI解説を他人が使うとANTHROPIC_API_KEYの課金が発生しうる。対策候補: Vercel Deployment Protection / 簡易パスワード / D.リポジトリprivate化とあわせて検討 残りの候補: A. 先生ペインの図解化（Mermaid等・新エージェント追加） C. ストリーミング対応（解説を逐次表示） D. リポジトリのprivate化 
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
