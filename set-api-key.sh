#!/usr/bin/env bash
# APIキーを「検証してから」安全に差し替えるスクリプト。
# 不正なキーなら一切ファイルを書き換えないので、ツールが止まらない。
#
# 使い方:
#   bash set-api-key.sh sk-ant-api03-xxxxxxxx...
#
# 手順（推奨の順番）:
#   1. console.anthropic.com で新しいキーを発行（まだ旧キーはRevokeしない）
#   2. このスクリプトに新キーを渡す → 検証OKなら .env.local に書き込み
#   3. dev サーバーを再起動（npm run dev）して動作確認
#   4. 動いたら最後に console.anthropic.com で旧キー(...yKQAA)をRevoke
set -euo pipefail

KEY="${1:-}"
if [[ -z "$KEY" ]]; then
  echo "使い方: bash set-api-key.sh <新しいAPIキー>"
  exit 1
fi
if [[ "$KEY" != sk-ant-* ]]; then
  echo "❌ キーの形式が不正です（sk-ant- で始まる必要があります）。何も変更していません。"
  exit 1
fi

echo "🔎 Anthropic APIにキーが有効か問い合わせ中..."
CODE=$(curl -s -o /dev/null -w "%{http_code}" https://api.anthropic.com/v1/messages \
  -H "x-api-key: $KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-haiku-4-5-20251001","max_tokens":1,"messages":[{"role":"user","content":"hi"}]}')

if [[ "$CODE" != "200" ]]; then
  echo "❌ キーが無効です（HTTP $CODE）。.env.local は変更していません。ツールは旧キーのまま動き続けます。"
  echo "   401=キー間違い / 400=モデル名等 / その他=ネットワーク。キーを確認して再実行してください。"
  exit 1
fi
echo "✅ キー有効（HTTP 200）。.env.local に書き込みます。"

# このスクリプトがあるフォルダ＝最新コードのフォルダ
HERE="$(cd "$(dirname "$0")" && pwd)"
# 念のため親フォルダ（旧作業フォルダ）にも書く。どちらで npm run dev しても動くように。
TARGETS=("$HERE")
[[ -d "$HERE/.." && -f "$HERE/../package.json" ]] && TARGETS+=("$(cd "$HERE/.." && pwd)")

for d in "${TARGETS[@]}"; do
  printf 'ANTHROPIC_API_KEY=%s\n' "$KEY" > "$d/.env.local"
  echo "  → 書き込み: $d/.env.local"
done

echo ""
echo "🎉 完了。次の手順:"
echo "   1) 動いている dev サーバーを止めて  npm run dev  で再起動（.env系は再起動が必要）"
echo "   2) ブラウザでツールを操作し、解説が生成されればOK"
echo "   3) 確認できたら console.anthropic.com で旧キー(末尾 ...yKQAA)をRevoke"
