# ads-drill-tool — 本気AIドリル

## ⚡ 現在の状態（handoff.sh が自動更新）
<!-- STATE_START -->
- ブランチ: main / コミット: 50a57e5 / 状態: ✅ クリーン
- 最終作業: docs: スクール講義統合MVP完了の引き継ぎ（次=ユーザー指摘の修正点ヒアリング）
- 次候補: ★最新(2026-07-06b)【スクール講義統合MVP完成🎉（第8回=9セクション取込・講義UI・取込スクリプト新設）…（詳細・残り候補は NEXT_TASKS.md）
<!-- STATE_END -->

## ⚠️ セッションのルール
- **位置づけ**: これは**個人用・ローカル主体**のツール（2026-06-28方針確定）。日常作業はローカルで完結。
- **ブランチ運用は軽量**: 基本 **main で直接作業**（feature/experimentブランチは原則作らない＝リスクの高い変更時のみ）。
- **デプロイは意図した時だけ手動**: 日常の main push で公開サイトへ自動反映**しない**運用。スクール生への共有など必要時に手動デプロイ。公開時は「ツール＋本人の学習データも見せる」想定（データ持ち出しの設計は公開時に検討）。公開用ブランチ `school-deploy-experiment` は当面放置（次回公開時に main から整理し直す）。
- **データ(studyLog)はローカルJSONが正**（`~/Desktop/AIドリル取込済み/studyLog.json`・revガード付き／2026-07-03確定）。Neon用 `DATABASE_URL` は `.env.local` でコメントアウト中＝公開時に再検討。
- **作業フォルダ**: `~/Desktop/ads-drill-tool/`（2026-06-10にフォルダを一本化。入れ子・重複repoは解消済み）
- **正本はGitHub**: `github.com/masanariwatanabe0417-ui/ads-drill-tool`。迷ったらGitHubが正。
- **作業履歴の正本は `NEXT_TASKS.md`**（SSoT）: 過去の完了分・残り候補はこのファイルに集約。CLAUDE.md は毎セッション読み込まれるため簡潔に保ち、履歴の全文は載せない（`handoff.sh` が先頭見出し＋参照だけを上の ⚡現在の状態 に注入する）。
- **終了時**: コミット・プッシュ後に `bash handoff.sh` を実行すると上記が自動更新される
- ~~旧: 親フォルダ/入れ子の二重構造~~ → 解消済み。旧フォルダは `~/Desktop/_ads-drill-tool_OLD` に退避（確認後削除可）

## 概要
問題・解答のスクリーンショットを貼り付けると Claude AI が解説を生成。コース/レッスン/問題の階層で管理。

**🎯 ゴール**: ドリルを「解いて終わり」にせず、AI解説と対話で疑問を残さず理解し、気になった言葉を単語帳に育てることで、**自分だけの教科書が積み上がっていく**学習ツール。
- 解説の合格基準は「読んだ後に自分の言葉で説明できるか」／機能追加の要否は「教科書の蓄積に効くか」で判断する

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
npm run dev                        # UI開発時（http://localhost:3000）
bash scripts/drill-serve-prod.sh   # 取込時はこちら＝本番サーバー:3000（BUILD=1で再ビルド。ソース変更は再ビルドまで反映されない）
```

## ドリル取込自動化（scripts/）
日常の主業務。詳細な運用知見はメモリ（series-batch-import-operations ほか）が正。
```bash
SERIES="<シリーズ名>" SKIP_IMPORTED=1 MAX_COURSES=99 GATE_AFTER_COURSE=1 node scripts/drill-import.mjs   # バックグラウンド起動
bash scripts/import-watcher.sh <取込ログ> scripts/.import-go <状態ファイル> "<シリーズ名>"                  # 自動合図ウォッチャー
```
- ユーザー操作は「対象レッスンのQ1表示」の1回だけ。以降は復習の自己訂正・コース間ナビ込みで全自動
- スクリプト(drill-*.mjs)修正後は必ずプロセス再起動（起動済みnodeは旧コードのまま）

## ⚠️ 鉄則
- APIキーは `.env.local` のみ。コード・コミット・mdに絶対書かない（過去に漏洩あり）
- PC間共有は GitHub push/pull。iCloud で .git を同期しない
