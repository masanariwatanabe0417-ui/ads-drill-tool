#!/bin/bash
# CLAUDE.md の現在の状態セクションを更新する

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_DIR"

BRANCH=$(git branch --show-current)
COMMIT=$(git rev-parse --short HEAD)
DIRTY=$(git status --porcelain)
LAST_MSG=$(git log --oneline -1 | sed 's/^[a-f0-9]* //')
NEXT_TASKS=$(cat "$REPO_DIR/NEXT_TASKS.md" 2>/dev/null | tr '\n' ' ' | sed 's/  */ /g')

if [ -n "$DIRTY" ]; then
  STATUS="⚠️ 未コミットあり"
else
  STATUS="✅ クリーン"
fi

# STATE_START〜STATE_END を3行で置換（改行なしのPythonで処理）
python3 - "$REPO_DIR/CLAUDE.md" "$BRANCH" "$COMMIT" "$STATUS" "$LAST_MSG" "$NEXT_TASKS" <<'PYEOF'
import sys, re
path, branch, commit, status, last_msg, next_tasks = sys.argv[1:]
new_block = (
    f"<!-- STATE_START -->\n"
    f"- ブランチ: {branch} / コミット: {commit} / 状態: {status}\n"
    f"- 最終作業: {last_msg}\n"
    f"- 次候補: {next_tasks}\n"
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
echo "次候補: $NEXT_TASKS"
