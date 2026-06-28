#!/usr/bin/env bash
# 取り込み専用の「本番サーバー」を http://localhost:3000 で起動する。
#
# なぜ next dev でなく本番サーバーか（2026-06-28m）:
#   next dev はオンデマンド再コンパイル・ソースマップ・ファイル監視(HMR)を抱え、長時間・数百POSTの
#   取り込みでメモリが膨らみ続けて落ちる持病がある（16GB機 + Chromium + 取り込みnodeで圧迫）。
#   next start（本番）はコンパイル済み・監視なし・メモリ平坦で、大量リクエストを安定して捌く。
#   APIルートの挙動は同じなので取り込み結果は変わらない。
#
# 使い方:
#   BUILD=1 bash scripts/drill-serve-prod.sh   # 初回/コード変更後: ビルドし直してから起動
#   bash scripts/drill-serve-prod.sh           # 取り込み再開や再起動: 既存ビルドのまま即起動（速い）
#
# 注意: dev中の build は .next を壊す既知問題があるため、本スクリプトは起動前に :3000 の
#       既存プロセス（next dev 含む）を必ず止めてから動く。
set -euo pipefail
cd "$(dirname "$0")/.."

# :3000 を握っている既存プロセス（dev/旧start）を解放
pkill -f "next dev" 2>/dev/null || true
lsof -ti tcp:3000 2>/dev/null | xargs kill 2>/dev/null || true
sleep 1

# 本番ビルドが無ければ作る（BUILD=1 なら必ず作り直す）。BUILD_ID は next build 成功時のみ生成される。
if [ "${BUILD:-0}" = "1" ] || [ ! -f .next/BUILD_ID ]; then
  echo "▶ 本番ビルド中…（少々かかります）"
  npm run build
fi

echo "▶ 本番サーバー起動: http://localhost:3000  （停止は Ctrl+C）"
exec npm run start
