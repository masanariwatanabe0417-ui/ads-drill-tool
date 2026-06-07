# 引き継ぎ：本気AIドリル（ads-drill-tool）セッション名：ドリル理解ツール7L

## プロジェクト概要
「本気AIドリル」の学習支援ツール。問題・解答・コースマップのスクリーンショットを貼り付けると Claude AI が自動解析して解説を生成する。
作業ディレクトリ: /Users/a142270/Desktop/ads-drill-tool
GitHubリポジトリ: https://github.com/masanariwatanabe0417-ui/ads-drill-tool
最新コミット: 8cf08b6「iframeサイドパネル追加・エラーUI改善・自動取込連動」

## スタック
- Next.js 14 (App Router) + TypeScript
- Tailwind CSS + shadcn/ui
- Anthropic SDK（claude-haiku-4-5）
- 開発サーバー: npm run dev → http://localhost:3000

## 4ペイン構成
NavigationPane(w-72) | ScreenshotPane(w-72) | TeacherPane(flex-1) | QuestionPane(w-80)

## 現在の動作（確認済み）
- スロット1（問題）・スロット2（解答）・スロット3（コースマップ）の3枚貼り付けで自動解析
- 3エージェント並列（すべてhaiku）で高速処理
- 「ドリルを開く」ボタンを押すとサイドパネルが開き、drill.ma-ji.ai をiframe表示
- サイドパネルを開くと同時に「自動取込」が自動でONになる
- 自動取込：Desktopに保存されたスクリーンショットをSSEで検出し、コースマップ→問題→解答の順に自動取り込み
- 解析エラー時は先生ペインにエラーメッセージを表示

## 直近の未解決問題
**自動取込が動かなかった原因（未修正）**
ユーザーのMacでスクリーンショットがDesktopに保存されず、クリップボードにしか入っていなかった。
→ まず macOS の設定を確認・修正してから動作テストをする

**確認・修正手順：**
1. ⌘+Shift+5 を押す
2. 「オプション」→「保存先」が「デスクトップ」になっているか確認
3. なっていなければ「デスクトップ」に変更
4. ⌘+Shift+4 でスクリーンショットを撮り、自動取込されるかテスト

## ファイル構成（主要）
- components/DrillTool.tsx — 全状態管理（isAutoEnabled を含む）
- components/DrillSidePanel.tsx — iframeサイドパネル
- components/panes/ScreenshotPane.tsx — スクリーンショット貼り付けUI
- components/panes/TeacherPane.tsx — AI解説表示（error propsあり）
- app/api/watch-screenshots/route.ts — Desktop監視SSE（ファイル名正規表現修正済み）
- app/api/teacher/route.ts — 3エージェント並列解析API
- lib/hooks/useAutoScreenshot.ts — Desktop監視hook

## 次にやること（優先順）
1. ⌘+Shift+5でMac保存先をDesktopに直し、自動取込の動作確認
2. 先生ペインの文章が入りきっていない可能性あり → レイアウト確認・修正
3. （任意）ストリーミング対応で解説表示をさらに速く
