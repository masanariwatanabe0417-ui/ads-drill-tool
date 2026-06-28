# ads-drill-tool — 本気AIドリル

## ⚡ 現在の状態（handoff.sh が自動更新）
<!-- STATE_START -->
- ブランチ: main / コミット: 9d941d7 / 状態: ✅ クリーン
- 最終作業: docs: 次セッション引き継ぎ＝コース一括の自動取り込み完成(cloze復習バグ修正)を主タスクに
- 次候補: ★最新(2026-06-28h)【次セッション主タスク】コース一括「自動」取り込みを完成させる＝復習自動突破のcloze…（詳細・残り候補は NEXT_TASKS.md）
<!-- STATE_END -->

## ⚠️ セッションのルール
- **位置づけ**: これは**個人用・ローカル主体**のツール（2026-06-28方針確定）。日常作業はローカルで完結。
- **ブランチ運用は軽量**: 基本 **main で直接作業**（feature/experimentブランチは原則作らない＝リスクの高い変更時のみ）。
- **デプロイは意図した時だけ手動**: 日常の main push で公開サイトへ自動反映**しない**運用。スクール課題提出など必要時に手動デプロイ。公開用は別系統ブランチ `school-deploy-experiment`（main と分岐・要整理／詳細はメモリ）。
- **データ(studyLog)は Neon(クラウドDB)** 継続（`.env.local` の `DATABASE_URL`／ローカルJSONフォールバックあり）。
- **作業フォルダ**: `~/Desktop/ads-drill-tool/`（2026-06-10にフォルダを一本化。入れ子・重複repoは解消済み）
- **正本はGitHub**: `github.com/masanariwatanabe0417-ui/ads-drill-tool`。迷ったらGitHubが正。
- **作業履歴の正本は `NEXT_TASKS.md`**（SSoT）: 過去の完了分・残り候補はこのファイルに集約。CLAUDE.md は毎セッション読み込まれるため簡潔に保ち、履歴の全文は載せない（`handoff.sh` が先頭見出し＋参照だけを上の ⚡現在の状態 に注入する）。
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
NavigationPane (w-72) | ScreenshotPane (w-72) | TeacherPane (flex-1) | QuestionPane (w-80)
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
