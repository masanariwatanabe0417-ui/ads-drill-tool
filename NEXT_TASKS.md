★2026-06-13: 「次の問題へ」改良 完了✅（押すとドリルパネルが自動で開き自動取込もONになる。DrillTool.tsxのhandleNextQuestionに2行追加）。メモ: 自動取込はON時点でデスクトップに既にあるスクショも拾う（検証中にWebの世界一周ツアーQ1・Q2が取り込まれstudyLogに保存済み）。パネルだけ開いて自動取込はONにしたくない場合はsetIsAutoEnabled(true)の1行を削る。
★2026-06-13: B.単語帳の改良 完了✅（コース別フィルタ＝チップ式・検索ボックス＝ひらがな/カタカナ同一視・暗記モード＝意味を隠してクリックでめくる）。実装はTeacherPane.tsxのGlossaryView/GlossaryCardとlib/glossary.tsのnormalizeForSearch。プレビューで62語・Gitコース29語絞り込み・ひらがな検索・めくり動作を確認済み。型チェックOK。
★前提（変わらず）: 公開URL https://ads-drill-tool.vercel.app はVercel Productionブランチ=school-deploy-experimentで凍結稼働中。mainへのpushは公開URLに影響しない。ローカル=ファイル保存（.env.localのDATABASE_URLコメントアウト中、#を外せばDB復帰）。DBデータは~/Desktop/AIドリル取込済み/studyLog.jsonに書き出し済み。
⚠️ 注意（未対応）: 公開URLは認証なしで誰でもアクセス可能＝先生ペインのAI解説を他人が使うとANTHROPIC_API_KEYの課金が発生しうる。対策候補: Vercel Deployment Protection / 簡易パスワード / D.リポジトリprivate化とあわせて検討
残りの候補:
A. 先生ペインの図解化（Mermaid等・新エージェント追加）
C. ストリーミング対応（解説を逐次表示）
D. リポジトリのprivate化
