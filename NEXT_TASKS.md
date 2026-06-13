★最新(2026-06-13 続き)の完了分: まとめの音声化（コミット93c6b3e・main・push済み）。レッスンまとめ・コースまとめのヘッダー（図解化ボタンの隣）に「音声で聞く」ボタンを追加。方式はブラウザ標準 Web Speech API（無料・APIキー不要・クライアント完結・オフライン可、ユーザーが方式Aを選択）。新規 components/AudioSummary.tsx＝ja-JP音声を自動選択（ユーザーMacでは Kyoko）、原稿は keyLearning を束ねたもの（レッスン=「ポイント1,2…」、コース=各レッスン名＋各要点）、Chromeの長文打ち切りバグ対策で文単位に分割して順次読み上げ、再生/一時停止/停止に対応、世代トークン(genRef)で停止・画面遷移時に古いonendコールバックを無効化。原稿は呼び出し側 components/panes/TeacherPane.tsx で組み立てて text prop で渡す。検証済: tsc通過・プレビュー実データ(DBコース12問)でKyokoがspeechSynthesis.speaking=trueで再生→停止→アイドル復帰、コンソールエラーなし。制約: この方式は再生のみ（mp3保存不可）・声はOS音声。もっと自然な声やmp3保存が欲しくなったら方式B=OpenAI TTSへ AudioSummary だけ差し替えれば移行できる構造（原稿生成側は不変）。
★図解化（現状=HTML版・コミット12eb10d）: 旧Mermaid方式から リッチHTML図解（visual-explainer方式）に進化済み。仕組み: 「図解化」ボタン→keyLearning一覧を app/api/diagram/route.ts（claude-sonnet-4-6・thinking無効・ストリーミング・SYSTEM_PROMPTでvisual-explainerの作法を指示）へ送り<main>内本文HTMLを生成→ app/api/diagram/template.ts の額縁(Tailwind CDN+Lucide+ADS配色)で包んだ自己完結HTMLを返す。保存は diagramHtml フィールド（lib/types.ts のLessonData/CourseData。旧Mermaid diagram? は後方互換で温存）。表示は components/HtmlDiagram.tsx＝iframe(srcDoc, sandbox)で安全表示・自動リサイズ・「別タブで開く/PDF」ボタン。TeacherPaneは diagramHtml優先・無ければ旧MermaidDiagramにフォールバック。コスト/速度実測: 1図解≈出力22KB・約47円・約93秒(Sonnet)。⚠️ 速度課題（ローカル運用前提のため対策不要と判断）: 93秒はVercel関数の60秒制限超→公開URLではタイムアウトする。公開したくなったら出力コンパクト化orクライアントまでストリーミング＋maxDuration見直し。モデル変更は route.ts の model 1行。🔖 安全地点: タグ pre-html-diagram → 66c48bd（HTML図解導入前）。
⚠️ ユーザー作業が1つ残り（前回から継続）: Vercelダッシュボード → ads-drill-tool → Settings → Environment Variables に APP_PASSCODE（好きなパスコード）を追加 → Redeploy。設定するまで公開URLのAI機能は503で安全停止（課金は発生しない＝保護は既に有効）。ローカルはAPP_PASSCODE未設定なら従来通り素通しで影響なし。
⚠️ 開発の注意: ユーザーのnpm run dev起動中にnpm run buildすると.nextが壊れる。検証はtsc --noEmit基本。プレビュー検証は.claude/launch.jsonのautoPort:trueで別ポート起動OK。
★前提（変わらず）: 公開URL https://ads-drill-tool.vercel.app はVercel Productionブランチ=school-deploy-experimentで稼働中。mainへのpushは公開URLに影響しない。ローカル=ファイル保存（.env.localのDATABASE_URLコメントアウト中、#を外せばDB復帰）。データは~/Desktop/AIドリル取込済み/studyLog.json。
残りの候補:
B. シリーズまとめビューの新設（＋シリーズ単位の図解化／音声化ボタン）
C. 解説のストリーミング対応（逐次表示）
D. リポジトリのprivate化
E. 図解の品質チューニング（実際に使って有用性確認・必要ならプロンプト/モデル調整）
F. 音声の声質向上（方式B=OpenAI TTSへ移行・mp3保存対応）
