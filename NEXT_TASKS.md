★スクール課題①〜⑤すべて完了🎉 ⑤Vercelデプロイ完了（2026-06-13）: 公開URL https://ads-drill-tool.vercel.app ／Vercelプロジェクトads-drill-tool（チームmaru's projects・Hobby）／Productionブランチ=school-deploy-experiment／環境変数DATABASE_URL・ANTHROPIC_API_KEY設定済み／DBから6コース配信確認済み。デプロイ失敗の原因は2つ修正: (1)古いpnpm-lock.yamlでERR_PNPM_OUTDATED_LOCKFILE→pnpm関連ファイル削除しnpmに一本化 (2)watch-screenshots/study-logにforce-dynamic追加。今後はschool-deploy-experimentにpushすると自動で本番デプロイされる。★2026-06-13: school-deploy-experimentをmainにfast-forwardマージ済み。今後の開発はmainで（ローカル版ベースのレベルアップ）。mainへのpushは公開URLに影響しない（VercelのProductionブランチはschool-deploy-experimentのまま＝公開版は課題完成状態で凍結）。次: ローカル版の最適化・機能強化の設計（保存方式の再設計、A〜D候補）。
⚠️ 新規の注意: 公開URLは認証なしで誰でもアクセス可能＝先生ペインのAI解説を他人が使うとANTHROPIC_API_KEYの課金が発生しうる。対策候補: Vercel Deployment Protection / 簡易パスワード / D.リポジトリprivate化とあわせて検討
A. 先生ペインの図解化（Mermaid等・新エージェント追加）
B. 単語帳の改良（コース別フィルタ・検索ボックス・暗記モード）
C. ストリーミング対応（解説を逐次表示）
D. リポジトリのprivate化
