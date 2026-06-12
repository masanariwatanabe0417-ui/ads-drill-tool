★今日(2026-06-13)の完了分: ①B.単語帳の改良（コース別フィルタ・ひらがなOK検索・暗記モード） ②「次の問題へ」でドリルパネル自動オープン＋自動取込ON ③自動取込の既存スクショ防止ガード（watch-screenshotsにmtimeチェック追加。デスクトップの古いスクショは拾わない） ④単語帳の用語名修正機能（カードの鉛筆ボタン→インライン編集。API(アピアイ)→API(エーピーアイ)修正適用済み） ⑤手動登録の保存消失対策（/api/study-logでglossaryOverrides/ManualTerms/TermRenamesを既存と和集合マージ＋アトミック書き込み。複数タブの後勝ち上書きで単語が消えていた問題を解消） ⑥単語帳の質問ボタンを吹き出しアイコンに変更（鉛筆との区別）。
メモ: 単語帳編集のマージは和集合なので「削除」は永続しない（削除UIは現状なし）。.claude/launch.jsonにautoPort:true追加済み（ポート3000使用中でも検証サーバーを別ポートで起動できる）。
★前提（変わらず）: 公開URL https://ads-drill-tool.vercel.app はVercel Productionブランチ=school-deploy-experimentで凍結稼働中。mainへのpushは公開URLに影響しない。ローカル=ファイル保存（.env.localのDATABASE_URLコメントアウト中、#を外せばDB復帰）。データは~/Desktop/AIドリル取込済み/studyLog.json。
⚠️ 注意（未対応）: 公開URLは認証なしで誰でもアクセス可能＝先生ペインのAI解説を他人が使うとANTHROPIC_API_KEYの課金が発生しうる。対策候補: Vercel Deployment Protection / 簡易パスワード / D.リポジトリprivate化とあわせて検討
残りの候補:
A. 先生ペインの図解化（Mermaid等・新エージェント追加）
C. ストリーミング対応（解説を逐次表示）
D. リポジトリのprivate化
