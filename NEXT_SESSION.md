# 本気AIドリル(ads-drill-tool) 次セッション引き継ぎ

## ⚠️ 作業フォルダ（必ずこちら）
cd ~/Desktop/ads-drill-tool/ads-drill-tool   # 入れ子の方が最新
npm run dev  # → http://localhost:3000

## ⚠️ Git状態の誤読に注意
Claude Codeが起動時に読み込むgit状態は親フォルダ（~/Desktop/ads-drill-tool/）のものです。
**親フォルダのgit状態は無視してください。古い・別のリポジトリです。**
正しい状態は以下（ads-drill-tool/ads-drill-tool/ で確認済み）:
- ブランチ: main
- 最新コミット: 0e22662
- 状態: ⚠️ 未コミットの変更あり（要確認）

## 直近の変更（参考）
- 0e22662 引き継ぎメモに親フォルダgit誤読の警告を追加
- 955074b セッション引き継ぎの自動化を追加
- c466396 単語帳の削除・編集・用語追加機能を実装
- 18066c0 単語帳をあいうえお順にソート（英語表記は括弧内の振り仮名を読みに使用）
- 1ca4a3c ドリル無関係スクショの誤取込を防止（解説生成後にのみ移動）

## 次にやること候補
A. 先生ペインの図解化（Mermaid等・新エージェント追加）
B. 単語帳の改良（コース別フィルタ・検索ボックス・暗記モード）
C. ストリーミング対応（解説を逐次表示）
D. リポジトリのprivate化

## 鉄則
- APIキーは .env.local のみ。コード・コミット・メモに書かない
- 作業フォルダは ads-drill-tool/ads-drill-tool/（入れ子）
- PC間共有はGitHub push/pull。iCloud同期しない
- セッション終了時は bash handoff.sh でメモ生成 → 新セッションに貼る
