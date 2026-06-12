★今日(2026-06-13)の完了分: ①〜⑥（単語帳改良・自動取込ガード・用語名修正・保存マージ等） ⑦公開URLのAPIキー課金対策（middleware.tsでAIルート3つにパスコード保護。lib/passcode.tsのaiFetchが401時にprompt→localStorage保存→再試行。main/school-deploy-experiment両方適用済み） ⑧先生ペインの生JSON表示バグ修正（app/api/teacher/route.tsのAgent③をstructured outputs＝output_config.format+JSONスキーマ化でAPIレベル保証。保険のparseLooseJson/composeExplanation追加・Agent①にも適用。max_tokens 2048。壊れていたLesson2 Q2の保存データも修復済み・バックアップ/tmp/studyLog.backup.json。両ブランチ適用済み）。
⚠️ ユーザー作業が1つ残り: Vercelダッシュボード → ads-drill-tool → Settings → Environment Variables に APP_PASSCODE（好きなパスコード）を追加 → Redeploy。設定するまで公開URLのAI機能は503で安全停止（課金は発生しない＝保護は既に有効）。ローカルはAPP_PASSCODE未設定なら従来通り素通しで影響なし。
⚠️ 開発の注意: ユーザーのnpm run dev起動中にnpm run buildすると.nextが壊れる（今日発生→.next削除+dev再起動で復旧）。検証はtsc --noEmit基本。
メモ: 単語帳編集のマージは和集合なので「削除」は永続しない（削除UIは現状なし）。.claude/launch.jsonにautoPort:true追加済み。
★前提（変わらず）: 公開URL https://ads-drill-tool.vercel.app はVercel Productionブランチ=school-deploy-experimentで稼働中（パスコード保護＋生JSON修正をcherry-pickで適用。他の凍結内容は不変）。mainへのpushは公開URLに影響しない。ローカル=ファイル保存（.env.localのDATABASE_URLコメントアウト中、#を外せばDB復帰）。データは~/Desktop/AIドリル取込済み/studyLog.json。
残りの候補:
A. 先生ペインの図解化（Mermaid等・新エージェント追加）
C. ストリーミング対応（解説を逐次表示）
D. リポジトリのprivate化
