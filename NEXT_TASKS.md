★今日(2026-06-13 続き)の完了分: A. 先生ペインの図解化（mainのみ・02ff2a9）。app/api/teacher/route.tsにAgent④（図解）を追加し4エージェント並列に。structured outputsでJSON保証、図解に向かない問題はapplicable=falseでスキップ、flowchart宣言で始まらない出力は破棄。図は解説Markdown末尾の```mermaidブロックとして合成＝保存形式（studyLog.json）は不変・既存データ無影響。components/MermaidDiagram.tsx（新規）がクライアント描画、構文エラー時は折りたたみフォールバック。TeacherPane.tsxのmarkdownComponentsでlanguage-mermaidを検出。mermaid@11.15.0追加。検証: tsc --noEmit / プレビューで描画確認 / 実スクショで/api/teacher実打ちOK（HTTP 200・9.6s・有効なmermaid生成）。
⚠️ 図解化はmainのみ。公開URL（Productionブランチ=school-deploy-experiment）には未適用。適用したければcherry-pick 02ff2a9。
⚠️ ユーザー作業が1つ残り（前回から継続）: Vercelダッシュボード → ads-drill-tool → Settings → Environment Variables に APP_PASSCODE（好きなパスコード）を追加 → Redeploy。設定するまで公開URLのAI機能は503で安全停止（課金は発生しない＝保護は既に有効）。ローカルはAPP_PASSCODE未設定なら従来通り素通しで影響なし。
⚠️ 開発の注意: ユーザーのnpm run dev起動中にnpm run buildすると.nextが壊れる。検証はtsc --noEmit基本。プレビュー検証は.claude/launch.jsonのautoPort:trueで別ポート起動OK（今日3000と52979の並走で問題なし）。
メモ: 単語帳編集のマージは和集合なので「削除」は永続しない（削除UIは現状なし）。
★前提（変わらず）: 公開URL https://ads-drill-tool.vercel.app はVercel Productionブランチ=school-deploy-experimentで稼働中。mainへのpushは公開URLに影響しない。ローカル=ファイル保存（.env.localのDATABASE_URLコメントアウト中、#を外せばDB復帰）。データは~/Desktop/AIドリル取込済み/studyLog.json。
残りの候補:
C. ストリーミング対応（解説を逐次表示）
D. リポジトリのprivate化
E. 図解の品質チューニング（実際の問題で図の有用性を見て、プロンプト調整 or 図の種類拡張）
