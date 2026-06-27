// aria無し4択（「選択肢から選んでください」型）の『確定』操作を解明するための観察用スクリプト。
// ブラウザはあなたが操作。Q6のようなaria無し4択まで進めたら、ゆっくり手で回答してください。
// その間、選択肢の枠色/選択状態・確定系ボタンの出現・フィードバックの変化を時刻つきで記録します。
//
//   node scripts/drill-inspect-select.mjs
//   → 開いた Chromium で drill にログイン → Lesson4 等で Q6型(aria無し4択)を表示
//   → 検出したら「手で回答してOK」と出る → ゆっくり 1)選択肢タップ 2)（出れば）確定ボタン を操作
//   記録は標準出力へ。Ctrl+C で終了。

import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";
import { sleep } from "./drill-dom.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = path.join(__dirname, ".pw-profile");
const START_URL = "https://drill.ma-ji.ai/";

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  viewport: { width: 430, height: 900 },
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto(START_URL, { waitUntil: "domcontentloaded" }).catch(() => {});

console.log("\n=== aria無し4択『確定』観察 ===");
console.log("drill にログイン → aria無し4択（選択肢から選んでください型）を表示してください。");
console.log("検出したら手で回答開始の合図を出します。Ctrl+C で終了。\n");

const snap = () =>
  page.evaluate(() => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const strip = (s) => (s || "").replace(/[-]/g, "");
    const els = [...document.querySelectorAll('[data-testid^="quiz-answer-option-"]')];
    const opts = els.map((e) => {
      const cs = getComputedStyle(e);
      return {
        t: strip(norm(e.textContent)).slice(0, 20),
        border: cs.borderColor,
        bg: cs.backgroundColor,
        dis: e.getAttribute("aria-disabled") || "",
        aria: e.getAttribute("aria-label") || "",
      };
    });
    const btns = [
      ...new Set(
        [...document.querySelectorAll("div[tabindex], button")]
          .map((e) => norm(strip(e.textContent)))
          .filter((t) => t && t.length <= 10 && /確定|回答する|次へ|次の問題|結果|送信|決定|チェック|答え合わせ|つぎ|すすむ/.test(t))
      ),
    ];
    const fb = document.querySelector('[data-testid="quiz-feedback"]');
    const submit = document.querySelector('[data-testid="quiz-submit"]');
    const instr = [...document.querySelectorAll('div[dir="auto"]')]
      .map((e) => norm(e.textContent))
      .find((t) => /選んでください|選択肢から選/.test(t) && t.length <= 30) || "";
    // 穴埋め文（cloze）本文＝空欄が埋まると変化する。「上で動く/担当するのは/それ自体は」を含む葉の祖先のテキスト。
    let cloze = "";
    {
      const leaves = [...document.querySelectorAll("div, span")].filter((e) => !e.children.length);
      const anchor = leaves.find((e) => /上で動く|担当するのは|それ自体は/.test(e.textContent || ""));
      let box = anchor;
      for (let k = 0; k < 4 && box && box.parentElement; k++) box = box.parentElement;
      cloze = box ? strip(norm(box.innerText || box.textContent)).slice(0, 90) : "";
    }
    return { n: els.length, noAria: els.length >= 3 && opts.every((o) => !o.aria), instr, cloze, opts, btns, hasSubmit: !!submit, fb: fb ? strip(norm(fb.textContent)).slice(0, 14) : null };
  });

// 1) aria無し4択を検出するまで待つ
let detected = false;
const deadline = Date.now() + 600000;
while (Date.now() < deadline) {
  const s = await snap().catch(() => null);
  if (s && s.n >= 3 && s.noAria) { detected = true; console.log(`>>> aria無し選択を検出（${s.n}択 / 指示「${s.instr}」）。今からゆっくり手で回答してください。\n`); break; }
  await sleep(800);
}
if (!detected) { console.log("検出できませんでした。終了します。"); await ctx.close().catch(() => {}); process.exit(1); }

// 2) 変化を時刻つきで記録（同一スナップショットは出さない）
let prev = "";
const t0 = Date.now();
for (let i = 0; i < 600; i++) {
  const s = await snap().catch(() => null);
  if (s) {
    const cur = JSON.stringify(s);
    if (cur !== prev) {
      const sec = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`[t=${sec}s] btns=${JSON.stringify(s.btns)} hasSubmit=${s.hasSubmit} fb=${s.fb ?? "-"}`);
      console.log(`        cloze本文: ${s.cloze}`);
      for (const o of s.opts) console.log(`        "${o.t}" border=${o.border} bg=${o.bg} dis=${o.dis||"-"}`);
      prev = cur;
    }
    if (s.fb) { console.log("\n>>> フィードバック検出＝確定されました。観察終了まで5秒…"); await sleep(5000); break; }
  }
  await sleep(500);
}

console.log("\n観察終了。Ctrl+C で閉じてください（ブラウザは開いたまま）。");
