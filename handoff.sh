#!/bin/bash
# 次セッション引き継ぎメモを自動生成してクリップボードにコピーする

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_DIR"

BRANCH=$(git branch --show-current)
COMMIT=$(git rev-parse --short HEAD)
DIRTY=$(git status --porcelain)

if [ -n "$DIRTY" ]; then
  GIT_STATUS="⚠️ 未コミットの変更あり（要確認）"
else
  GIT_STATUS="✅ クリーン（未コミットなし）"
fi

RECENT_COMMITS=$(git log --oneline -5 | sed 's/^/- /')

NEXT_TASKS=""
if [ -f "$REPO_DIR/NEXT_TASKS.md" ]; then
  NEXT_TASKS=$(cat "$REPO_DIR/NEXT_TASKS.md")
else
  NEXT_TASKS="A. 先生ペインの図解化（Mermaid等）
B. 単語帳の改良（フィルタ・検索・暗記モード）
C. ストリーミング対応
D. リポジトリのprivate化"
fi

NOTE=$(cat <<EOF
# 本気AIドリル(ads-drill-tool) 次セッション引き継ぎ

## ⚠️ 作業フォルダ（必ずこちら）
cd ~/Desktop/ads-drill-tool/ads-drill-tool   # 入れ子の方が最新
npm run dev  # → http://localhost:3000

## ⚠️ Git状態の誤読に注意
Claude Codeが起動時に読み込むgit状態は親フォルダ（~/Desktop/ads-drill-tool/）のものです。
**親フォルダのgit状態は無視してください。古い・別のリポジトリです。**
正しい状態は以下（ads-drill-tool/ads-drill-tool/ で確認済み）:
- ブランチ: $BRANCH
- 最新コミット: $COMMIT
- 状態: $GIT_STATUS

## 直近の変更（参考）
$RECENT_COMMITS

## 次にやること候補
$NEXT_TASKS

## 鉄則
- APIキーは .env.local のみ。コード・コミット・メモに書かない
- 作業フォルダは ads-drill-tool/ads-drill-tool/（入れ子）
- PC間共有はGitHub push/pull。iCloud同期しない
- セッション終了時は bash handoff.sh でメモ生成 → 新セッションに貼る
EOF
)

echo "$NOTE" | pbcopy
echo "✅ クリップボードにコピーしました"
echo ""
echo "---"
echo "$NOTE"
