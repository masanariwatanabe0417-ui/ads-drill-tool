# 引き継ぎ：本気AIドリル（ads-drill-tool）

## プロジェクト概要
「本気AIドリル」の学習支援ツール。問題・解答・コースマップのスクリーンショットを貼り付けると Claude AI が自動解析して解説を生成する。
- **GitHubリポジトリ**: https://github.com/masanariwatanabe0417-ui/ads-drill-tool
- **最新コミット**: 805642a「.envをgitignoreに追加」

## スタック
- Next.js 14 (App Router) + TypeScript
- Tailwind CSS + shadcn/ui
- Anthropic SDK（claude-haiku-4-5）
- 開発サーバー: `npm run dev` → http://localhost:3000

## 環境変数（新PCでは必須）
`.env` はgitignoreされているため、新規クローン後に手動作成が必要：
```
ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
```

## 4ペイン構成
NavigationPane(w-72) | ScreenshotPane(w-72) | TeacherPane(flex-1) | QuestionPane(w-80)

## 現在の動作（確認済み）
- コースマップ→問題→解答の順に自動取込（日本語ファイル名対応済み）
- Q1はコースマップ+問題+解答、Q2以降はコースマップ維持で問題+解答のみ
- 「次の問題へ」ボタンで問題・解答スロットをクリア（コースマップは維持）
- 解答スロットに画像がセットされると自動解析（「解析する」ボタンは廃止）
- 取込済みスクリーンショットは `~/Desktop/AIドリル取込済み/YYYY-MM-DD/` へ移動
- studyLogをJSONファイルに永続化（`~/Desktop/AIドリル取込済み/studyLog.json`）
- ドリル本来のQ番号（Q1/10のQ1）をAIが抽出し、同じQ番号は上書き（重複なし）
- レッスンはLesson番号順に自動ソート

## ファイル構成（主要）
- `components/DrillTool.tsx` — 全状態管理・JSON読み書き
- `components/DrillSidePanel.tsx` — iframeサイドパネル（drill.ma-ji.ai）
- `components/panes/ScreenshotPane.tsx` — スクリーンショット貼り付けUI
- `components/panes/TeacherPane.tsx` — AI解説表示
- `app/api/teacher/route.ts` — 3エージェント並列解析API
- `app/api/study-log/route.ts` — studyLog JSON永続化API（GET/POST）
- `app/api/screenshot-file/route.ts` — ファイル読み込み＋取込済みフォルダ移動
- `app/api/watch-screenshots/route.ts` — Desktop監視SSE
- `lib/hooks/useAutoScreenshot.ts` — Desktop監視hook
- `lib/types.ts` — 型定義

## 次にやること（候補）
1. 実験中のデータ（バラバラQ）をリセットして順番通りやり直す手段の検討
2. 先生ペインの解説文レイアウト確認（文章が見切れる場合）
3. ストリーミング対応（解説表示を逐次的に）
4. studyLogのエクスポート・バックアップ機能

## 新PCでの始め方
```bash
git clone https://github.com/masanariwatanabe0417-ui/ads-drill-tool.git
cd ads-drill-tool
npm install
# .env ファイルを作成して ANTHROPIC_API_KEY を設定
npm run dev
```
※ studyLog.json はローカルPC固有のため、各PCで独立して蓄積される
