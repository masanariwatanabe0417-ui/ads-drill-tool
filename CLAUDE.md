# ads-drill-tool — 本気AIドリル

## ⚡ 現在の状態（handoff.sh が自動更新）
<!-- STATE_START -->
- ブランチ: main / コミット: 8c69f65 / 状態: ✅ クリーン
- 最終作業: feat: まとめのNotebookLM音声化ボタン（純コピー方式）を追加
- 次候補: ★最新(2026-06-14)の完了分: まとめのNotebookLM音声化（①純コピー方式・自動操作なし）。レッスン/コースまとめのヘッダーに紫の「音声化(NotebookLM)」ボタンを追加（新規 components/NotebookLmExport.tsx）。クリックで(1)構造化したまとめ文をクリップボードにコピー(2)https://notebooklm.google.com/ を新規タブで開く、だけ＝壊れない・ログイン/ToS非依存。あとはユーザーがNotebookLM上で 新規作成→「コピーしたテキスト」→⌘V→挿入→Studio「音声解説」で高品質ポッドキャストを生成し、スマホのNotebookLMアプリ(クラウド同期で自動で出る)で歩きながら聴く。押下後にヒント(手順＋おすすめノート名 例「AIドリル｜DBがないと壊れる世界（コース全体）」＋出力言語を日本語にする注意)を12秒表示。ソース文はkeyLearningを構造化（レッスン=【Q】要点羅列／コース=▼レッスンごと）。図解HTMLは音声に効かないので渡さない方針。TeacherPane.tsx両ヘッダーに 音声化(NotebookLM)／音声で聞く(Web Speech)／図解化 の3ボタン並びで配置。検証: tsc通過・プレビュー実データ(DBコース12問)でcopy内容/open先/ヒント/ノート名を確認。★この方式に至った判断: 音声品質の理想はNotebookLM(ユーザー手動検証済)。だがNotebookLM公式APIは法人専用、Gemini多話者TTS/ElevenLabs等は別物・課金、本物のブラウザ全自動は脆い+要ログイン+captcha不可(私はパスワード入力・captcha突破不可)。さらにNotebookLMの音声解説はノートブック単位で1本(全ソース混在・上書き)なので「1まとまり=1ノートブック」が正。②貼付直前まで自動 や ③全自動 は②③とも同じローカルPlaywright機構＝同じ脆さで、②は手作業も残り最悪の中間。→ 自動操作ゼロの①純コピーが最善と合意。将来クリックを減らしたくなったら③全自動(ローカルPlaywright+ユーザーのChromeプロファイル再利用)を足せる(スパイクで全UI手順を捕捉済み: 新規作成→コピーしたテキスト→貼付→挿入→⚙️設定→出力言語→日本語→Studio音声解説→生成数分→︙メニューからDL)。⚠️ ユーザーのNotebookLMアカウントにスパイクのテストノート「Git Merge: Principles of Automated Integration」が残存(リネーム/削除はユーザー操作)。 ★前回(2026-06-13)の完了分: まとめの音声化（コミット93c6b3e・main・push済み）。レッスンまとめ・コースまとめのヘッダー（図解化ボタンの隣）に「音声で聞く」ボタンを追加。方式はブラウザ標準 Web Speech API（無料・APIキー不要・クライアント完結・オフライン可、ユーザーが方式Aを選択）。新規 components/AudioSummary.tsx＝ja-JP音声を自動選択（ユーザーMacでは Kyoko）、原稿は keyLearning を束ねたもの（レッスン=「ポイント1,2…」、コース=各レッスン名＋各要点）、Chromeの長文打ち切りバグ対策で文単位に分割して順次読み上げ、再生/一時停止/停止に対応、世代トークン(genRef)で停止・画面遷移時に古いonendコールバックを無効化。原稿は呼び出し側 components/panes/TeacherPane.tsx で組み立てて text prop で渡す。検証済: tsc通過・プレビュー実データ(DBコース12問)でKyokoがspeechSynthesis.speaking=trueで再生→停止→アイドル復帰、コンソールエラーなし。制約: この方式は再生のみ（mp3保存不可）・声はOS音声。もっと自然な声やmp3保存が欲しくなったら方式B=OpenAI TTSへ AudioSummary だけ差し替えれば移行できる構造（原稿生成側は不変）。 ★図解化（現状=HTML版・コミット12eb10d）: 旧Mermaid方式から リッチHTML図解（visual-explainer方式）に進化済み。仕組み: 「図解化」ボタン→keyLearning一覧を app/api/diagram/route.ts（claude-sonnet-4-6・thinking無効・ストリーミング・SYSTEM_PROMPTでvisual-explainerの作法を指示）へ送り<main>内本文HTMLを生成→ app/api/diagram/template.ts の額縁(Tailwind CDN+Lucide+ADS配色)で包んだ自己完結HTMLを返す。保存は diagramHtml フィールド（lib/types.ts のLessonData/CourseData。旧Mermaid diagram? は後方互換で温存）。表示は components/HtmlDiagram.tsx＝iframe(srcDoc, sandbox)で安全表示・自動リサイズ・「別タブで開く/PDF」ボタン。TeacherPaneは diagramHtml優先・無ければ旧MermaidDiagramにフォールバック。コスト/速度実測: 1図解≈出力22KB・約47円・約93秒(Sonnet)。⚠️ 速度課題（ローカル運用前提のため対策不要と判断）: 93秒はVercel関数の60秒制限超→公開URLではタイムアウトする。公開したくなったら出力コンパクト化orクライアントまでストリーミング＋maxDuration見直し。モデル変更は route.ts の model 1行。🔖 安全地点: タグ pre-html-diagram → 66c48bd（HTML図解導入前）。 ⚠️ ユーザー作業が1つ残り（前回から継続）: Vercelダッシュボード → ads-drill-tool → Settings → Environment Variables に APP_PASSCODE（好きなパスコード）を追加 → Redeploy。設定するまで公開URLのAI機能は503で安全停止（課金は発生しない＝保護は既に有効）。ローカルはAPP_PASSCODE未設定なら従来通り素通しで影響なし。 ⚠️ 開発の注意: ユーザーのnpm run dev起動中にnpm run buildすると.nextが壊れる。検証はtsc --noEmit基本。プレビュー検証は.claude/launch.jsonのautoPort:trueで別ポート起動OK。 ★前提（変わらず）: 公開URL https://ads-drill-tool.vercel.app はVercel Productionブランチ=school-deploy-experimentで稼働中。mainへのpushは公開URLに影響しない。ローカル=ファイル保存（.env.localのDATABASE_URLコメントアウト中、#を外せばDB復帰）。データは~/Desktop/AIドリル取込済み/studyLog.json。 残りの候補: B. シリーズまとめビューの新設（＋シリーズ単位の図解化／音声化ボタン） C. 解説のストリーミング対応（逐次表示） D. リポジトリのprivate化 E. 図解の品質チューニング（実際に使って有用性確認・必要ならプロンプト/モデル調整） F. 音声の声質向上（方式B=OpenAI TTSへ移行・mp3保存対応） 
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
