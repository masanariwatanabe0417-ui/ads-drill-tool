// ドリル自動取り込みの第一歩：ログイン後の画面の HTML を定期的に書き出す「調査専用」スクリプト。
// データは一切変更しない。読み取り（ダンプ）だけ。
//
// 使い方:
//   node scripts/drill-inspect.mjs
//   → Chromium の窓が開くので drill.ma-ji.ai にログインし、
//     取り込みたいレッスンの「問題が表示された画面」まで進める。
//   → 3秒ごとに現在のページを scripts/drill-dump.html / drill-dump.png へ上書き保存する。
//   → さらに、画面（可視テキスト）が変わるたびに連番スナップショット
//     scripts/drill-dump.NN.html / .png を「消さずに」残す。
//     これで「問題画面」→（解答ボタンを押す）→「回答後の正解＋解説画面」の
//     両方が確実に別ファイルとして保存される。回答後の状態が上書きで消えない。
//   → 解答（○/✕やボタン）を押して正解＋解説が出たら数秒待つ。
//   → 終わったら Ctrl+C で終了。連番のうち末尾が回答後画面。
//
// ログインは永続プロフィール(scripts/.pw-profile)に保存されるので次回以降は不要。
// プロフィールもダンプも .gitignore 済み（コミットされない）。

import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = path.join(__dirname, ".pw-profile");
const HTML_OUT = path.join(__dirname, "drill-dump.html");
const PNG_OUT = path.join(__dirname, "drill-dump.png");
const START_URL = "https://drill.ma-ji.ai/";

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  viewport: { width: 430, height: 900 }, // ドリルはスマホ幅レイアウト
});

const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto(START_URL, { waitUntil: "domcontentloaded" }).catch(() => {});

console.log("\n==============================================");
console.log(" Chromium を開きました。");
console.log(" 1) drill.ma-ji.ai にログイン");
console.log(" 2) 取り込みたいレッスンの『問題が出ている画面』まで進める");
console.log(" 3) このまま放置（3秒ごとに HTML を書き出します）");
console.log(" 4) 回答してみて『正解＋解説』画面でも数秒待つ");
console.log(" 終了は Ctrl+C");
console.log("==============================================\n");

// 画面（可視テキスト）が変わったら連番スナップショットを残す。
// 3秒上書きだけだと「回答後の正解＋解説」画面が次のtickで消えてしまうため。
// 連番ファイルは drill-dump.NN.html 命名 → .gitignore の `drill-dump.*` で無視される。
function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

let n = 0;
let seq = 0;
let lastVis = null;
const timer = setInterval(async () => {
  try {
    const html = await page.content();
    fs.writeFileSync(HTML_OUT, html, "utf-8");
    await page.screenshot({ path: PNG_OUT }).catch(() => {});
    n += 1;
    const url = page.url();

    // 画面が前回と変わっていたら連番スナップショットを保存（履歴を消さない）
    const vis = visibleText(html);
    if (vis !== lastVis) {
      seq += 1;
      const tag = String(seq).padStart(2, "0");
      const snapHtml = path.join(__dirname, `drill-dump.${tag}.html`);
      const snapPng = path.join(__dirname, `drill-dump.${tag}.png`);
      fs.writeFileSync(snapHtml, html, "utf-8");
      await page.screenshot({ path: snapPng }).catch(() => {});
      lastVis = vis;
      const preview = vis.slice(-80).replace(/\s+/g, " ");
      console.log(`  ★ 画面変化 → drill-dump.${tag}.html 保存  …「${preview}」`);
    }

    console.log(`[dump #${n}] ${new Date().toLocaleTimeString()}  ${url}  (${(html.length / 1024).toFixed(0)} KB)`);
  } catch {
    // ページ遷移中などは無視
  }
}, 3000);

// Ctrl+C でクリーンに終了
process.on("SIGINT", async () => {
  clearInterval(timer);
  console.log("\n終了します。最後のダンプ: scripts/drill-dump.html / drill-dump.png");
  await ctx.close().catch(() => {});
  process.exit(0);
});
