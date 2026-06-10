★最優先（スクール課題の続き）: ステップ②Neon（DB）準備 → DATABASE_URLを.env.localに設定 → ④リロードで消えない確認 → ⑤Vercelデプロイ。設計は決定済み(study_logテーブルにJSONB1行)。lib/db.tsとapp/api/study-log/route.ts実装済み（DATABASE_URL有無でDB/ファイル自動切替）。実験はschool-deploy-experimentブランチで進め、完成後mainで本当の最適化に戻る方針。
A. 先生ペインの図解化（Mermaid等・新エージェント追加）
B. 単語帳の改良（コース別フィルタ・検索ボックス・暗記モード）
C. ストリーミング対応（解説を逐次表示）
D. リポジトリのprivate化
