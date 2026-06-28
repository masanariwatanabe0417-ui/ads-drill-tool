// あなたが手で押したボタンを“実機で記録”する観察ツール（非破壊・無課金）。
// 目的: コース一覧で「次コースへ進む実際のボタン（STARTテキストの少し上の矢印/再生マーク）」を
//   あなたがクリック → そのクリック対象の要素・祖先チェーン・属性を捕捉して、自動化で再現できる
//   セレクタを確定する。さらにクリック後の画面（コース紹介→Lesson1 Q1）も順に採取する。
//   /api へは一切POSTしない（AI再課金なし）。
//
// 使い方:
//   1) node scripts/drill-inspect-clickrec.mjs
//   2) 開いた Chromium で「Web開発実践」コース一覧（…APIとデータ通信…START…）まで進める。
//   3) “矢印/再生マーク”ボタンを押す → 私(アシスタント)がログでクリック対象を読む。
//      画面が進むたびに本文と tabindex ボタンも自動ダンプ。Lesson1 Q1（解答ボタン）まで観察。

import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { sleep } from "./drill-dom.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = path.join(__dirname, ".pw-profile");
const START_URL = "https://drill.ma-ji.ai/";

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: false, viewport: { width: 430, height: 900 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());

// クリック捕捉スクリプトを毎ナビゲーションで注入（capture段で対象とその祖先を記録してキューに積む）。
await page.addInitScript(() => {
  window.__clicks = [];
  const desc = (e) => {
    if (!e) return null;
    const cls = (typeof e.className === "string" ? e.className : "").trim().split(/\s+/).filter(Boolean);
    const r = e.getBoundingClientRect();
    return {
      tag: e.tagName.toLowerCase(),
      role: e.getAttribute && e.getAttribute("role"),
      tabindex: e.getAttribute && e.getAttribute("tabindex"),
      testid: e.getAttribute && e.getAttribute("data-testid"),
      aria: e.getAttribute && (e.getAttribute("aria-label") || e.getAttribute("aria-labelledby")),
      cls,
      text: (e.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40),
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    };
  };
  document.addEventListener("pointerdown", (ev) => {
    const chain = [];
    let cur = ev.target;
    for (let i = 0; i < 8 && cur; i++) { chain.push(desc(cur)); cur = cur.parentElement; }
    window.__clicks.push({ t: Date.now(), point: { x: Math.round(ev.clientX), y: Math.round(ev.clientY) }, chain });
  }, true);
});
await page.goto(START_URL, { waitUntil: "domcontentloaded" }).catch(() => {});

console.log("\n=== あなたのクリックを記録します（非破壊・無課金）===");
console.log("Chromium で『Web開発実践』コース一覧まで進め、次コースへ進む“矢印/再生マーク”を押してください。");
console.log("（押した要素・祖先チェーンをログに出します。Lesson1 Q1 まで観察。Ctrl+C で終了）\n");

const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
const bodyHead = async () => page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 220)).catch(() => "");
const tabs = async () => page.evaluate(() => {
  const n = (s) => (s || "").replace(/\s+/g, " ").trim();
  return [...new Set([...document.querySelectorAll('[tabindex="0"]')].map((e) => n(e.textContent)).filter((t) => t && t.length <= 60))];
}).catch(() => []);

let lastBody = "";
let snap = 0;
const deadline = Date.now() + 1800000; // 30分
while (Date.now() < deadline) {
  // 1) 記録されたクリックを吐き出す
  const clicks = await page.evaluate(() => { const c = window.__clicks || []; window.__clicks = []; return c; }).catch(() => []);
  for (const c of clicks) {
    console.log(`\n🖱  クリック記録 @${new Date(c.t).toLocaleTimeString()} point=${JSON.stringify(c.point)}`);
    c.chain.forEach((d, i) => {
      if (!d) return;
      const cls = (d.cls || []).slice(0, 4).join(".");
      console.log(`   [${i}] ${d.tag}[role=${d.role}][tabindex=${d.tabindex}]${d.testid ? `[testid=${d.testid}]` : ""}${d.aria ? `[aria=${d.aria}]` : ""} .${cls} rect=${JSON.stringify(d.rect)} text=${JSON.stringify(d.text)}`);
    });
  }
  // 2) 画面が変わったらダンプ
  const body = await bodyHead();
  if (body && body !== lastBody) {
    lastBody = body;
    const t = await tabs();
    try { fs.writeFileSync(path.join(__dirname, `drill-dump.clickrec-${snap}.html`), await page.content(), "utf-8"); } catch {}
    console.log(`\n----- 画面変化ダンプ [clickrec-${snap}] -----`);
    console.log(`  tabindex=0: ${JSON.stringify(t)}`);
    console.log(`  本文(先頭220字): ${body}`);
    // Q1（解答ボタン）に到達したら知らせる
    const atQ1 = await page.$('[data-testid^="quiz-answer-option-"]');
    if (atQ1) console.log("  ✅ 解答ボタンを検出＝Lesson1 Q1 に到達（次コースの入口）。");
    console.log(`  （DOM保存: scripts/drill-dump.clickrec-${snap}.html）`);
    snap += 1;
  }
  await sleep(700);
}
console.log("\n=== 観察タイムアウト（30分）。ブラウザは開いたまま。Ctrl+C で終了。===");
