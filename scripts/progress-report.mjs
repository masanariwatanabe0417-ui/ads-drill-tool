// 取込進捗のレポート（UIの進捗モニター用）。副作用は JSON ファイル書き込みのみ。
// スクリプト（drill-import.mjs 等）が節目ごとに reportProgress() を呼び、
// アプリ側は /api/import-progress がこのファイルを読んでペインに表示する。
// 書き込み失敗は握りつぶす＝進捗表示のために取り込み本体を絶対に止めない。

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// プロジェクト直下に置く（Next.js 側は process.cwd() 直下を読む）
export const PROGRESS_FILE = path.join(__dirname, "..", ".import-progress.json");

const MAX_LOGS = 8;
let state = { recentLogs: [] };

// patch を現在状態にマージして書き出す。
// 主なフィールド（すべて任意）:
//   phase:   "waiting-q1" | "importing" | "review" | "waiting-user" | "course-done" | "done" | "error"
//   waiting: true=🟢ユーザー操作待ち / false=⏳自動処理中
//   series / course / lesson / question / total
//   savedLesson / savedTotal（保存済み問数）
//   message（人間向けの1行）
export function reportProgress(patch) {
  try {
    state = { ...state, ...patch, updatedAt: new Date().toISOString(), pid: process.pid };
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(state, null, 2));
  } catch {}
}

// ログ1行を recentLogs（直近8件）へ積みつつ書き出す。clearReview の log オプションに
// そのまま渡せるよう、コンソール出力も行う。
export function progressLog(msg) {
  console.log(msg);
  try {
    const line = String(msg).trim();
    if (line) state.recentLogs = [...(state.recentLogs || []), line].slice(-MAX_LOGS);
    reportProgress({});
  } catch {}
}
