#!/bin/bash
# シリーズ一括取込のログ監視ウォッチャー（2026-07-03 DBシリーズで実運用・実証済み）
# 使い方: bash scripts/import-watcher.sh <取込ログ> <scripts/.import-goのパス> <状態ファイル> <シリーズ名>
# - コース頭の3行確認プロンプト: ヘッダー(シリーズ一致＋コース/レッスン/総問題数に不明なし)を検査してOKなら .import-go を自動touch
# - GATE_AFTER_COURSE の境界ゲート: Q1到達検出済みなので自動解放
# - 定型文の「不明〜」には反応しない（ヘッダー行だけをgrepする）
LOG="$1"; GO="$2"; STATE="$3"
SERIES_NAME="${4:?シリーズ名を第4引数で指定}"
echo "[watcher] start $(date '+%H:%M:%S') log=$LOG"
while true; do
  sleep 5
  [ -f "$LOG" ] || continue
  last=$(cat "$STATE" 2>/dev/null || echo 0)
  n_confirm=$(grep -n "開始するには Enter を押してください" "$LOG" | tail -1 | cut -d: -f1)
  n_gate=$(grep -n "画面が次コースの Q1 で正しければ合図で続行" "$LOG" | tail -1 | cut -d: -f1)
  target=""
  kind=""
  if [ -n "$n_confirm" ] && [ "$n_confirm" -gt "$last" ]; then
    start=$(( n_confirm > 12 ? n_confirm - 12 : 1 ))
    hdr=$(sed -n "${start},${n_confirm}p" "$LOG")
    if echo "$hdr" | grep -q "シリーズ: ${SERIES_NAME}" \
       && ! echo "$hdr" | grep -E "^ *(コース|レッスン) *:" | grep -q "不明" \
       && ! echo "$hdr" | grep -q "総問題数: 不明"; then
      target=$n_confirm; kind="confirm"
    else
      # ヘッダー不備 → 自動合図しない（人の判断待ち）。1回だけ通知ログを出す
      if [ "$(cat "$STATE.warn" 2>/dev/null || echo 0)" != "$n_confirm" ]; then
        echo "[watcher] ⚠ ヘッダー不備のため自動合図せず (line $n_confirm) $(date '+%H:%M:%S')"
        echo "$hdr"
        echo "$n_confirm" > "$STATE.warn"
      fi
    fi
  elif [ -n "$n_gate" ] && [ "$n_gate" -gt "$last" ]; then
    target=$n_gate; kind="gate"
  fi
  if [ -n "$target" ]; then
    total=$(wc -l < "$LOG" | tr -d ' ')
    # プロンプトがログ末尾付近＝いま待機中のときだけ合図（過去分への誤発火防止）
    if [ $(( total - target )) -le 3 ]; then
      touch "$GO"
      echo "$target" > "$STATE"
      echo "[watcher] ✅ auto-go ($kind) line $target $(date '+%H:%M:%S')"
    fi
  fi
done
