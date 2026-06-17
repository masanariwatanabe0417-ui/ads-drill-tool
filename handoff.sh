#!/bin/bash
# CLAUDE.md の現在の状態セクションを更新する
#
# 方針（SSoT・第2回 Rule6「AIが見る情報を整えろ」/ 第6・7回「ルールは簡潔に」）:
#   作業履歴の正本は NEXT_TASKS.md。CLAUDE.md は毎セッション読み込まれるため、
#   履歴の全文は載せず「先頭の見出し＋NEXT_TASKS.md への参照」だけを注入する。

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_DIR"

BRANCH=$(git branch --show-current)
COMMIT=$(git rev-parse --short HEAD)
DIRTY=$(git status --porcelain -- ':!CLAUDE.md')
LAST_MSG=$(git log --oneline -1 | sed 's/^[a-f0-9]* //')
# 次候補は全文ではなく NEXT_TASKS.md の先頭1行だけ（python側で短縮する）
NEXT_HEAD=$(head -n 1 "$REPO_DIR/NEXT_TASKS.md" 2>/dev/null)

if [ -n "$DIRTY" ]; then
  STATUS="⚠️ 未コミットあり"
else
  STATUS="✅ クリーン"
fi

# STATE_START〜STATE_END を置換（改行なしのPythonで処理）
python3 - "$REPO_DIR/CLAUDE.md" "$BRANCH" "$COMMIT" "$STATUS" "$LAST_MSG" "$NEXT_HEAD" <<'PYEOF'
import sys, re
path, branch, commit, status, last_msg, next_head = sys.argv[1:]
# 先頭見出しを短く切り詰める（CLAUDE.md を肥大化させない）
head = next_head.strip()
if len(head) > 60:
    head = head[:60] + "…"
next_line = f"{head}（詳細・残り候補は NEXT_TASKS.md）" if head else "NEXT_TASKS.md を参照"
new_block = (
    f"<!-- STATE_START -->\n"
    f"- ブランチ: {branch} / コミット: {commit} / 状態: {status}\n"
    f"- 最終作業: {last_msg}\n"
    f"- 次候補: {next_line}\n"
    f"<!-- STATE_END -->"
)
content = open(path).read()
content = re.sub(r'<!-- STATE_START -->.*?<!-- STATE_END -->', new_block, content, flags=re.DOTALL)
open(path, 'w').write(content)
PYEOF

echo "✅ CLAUDE.md を更新しました（次セッションが自動で読み込みます）"
echo ""
echo "--- 更新内容 ---"
echo "ブランチ: $BRANCH / コミット: $COMMIT / 状態: $STATUS"
echo "最終作業: $LAST_MSG"
echo "次候補: （NEXT_TASKS.md の先頭見出し＋参照を注入）"
