// drill-review-core の純関数テスト（実行: node scripts/drill-review-core.test.mjs）
// (b) 復習自己訂正の取り違え修正を実証する。実ライブ(2026-06-27f Lesson8 The Finale)で起きた
// 「○✕の訂正『間違い』が4択へ誤適用されてスタック」を、その場のDOM値で再現して検証する。
import assert from "node:assert/strict";
import { questionSig, correctionApplies, optionMatchesCorrect } from "./drill-review-core.mjs";

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log("  ✓", name); };

// --- 実ライブで衝突した値（Q3ダンプの最長葉テキスト＝フィナーレ・バナー）---
const banner = "Webの地図を完成させよう（The Finale）"; // readState がこれを questionText に化けさせた
const tfOpts = ["正しい", "間違い"];                      // Q1（○✕）の選択肢
const mcOpts = [                                          // Q3（4択）の選択肢
  "A完成した画面そのもの",
  "B画像ファイルだけ",
  "C暗号化されたデータ",
  "DWebページの材料データ",
];

console.log("questionSig: バナー衝突しても選択肢でsigが分かれる（取り違えの根治）");
t("○✕ と 4択 は同じ問題文でも別sig", () => {
  assert.notEqual(questionSig(banner, tfOpts), questionSig(banner, mcOpts));
});
t("選択肢シャッフルでも同一問題はsig不変", () => {
  assert.equal(questionSig(banner, tfOpts), questionSig(banner, [...tfOpts].reverse()));
  assert.equal(questionSig(banner, mcOpts), questionSig(banner, [...mcOpts].reverse()));
});
t("問題文・選択肢とも空なら空sig（呼び出し側がqnumへフォールバック）", () => {
  assert.equal(questionSig("", []), "");
});

console.log("correctionApplies: 別問題の正解を現在の選択肢へ force-apply しないガード");
t("○✕の訂正『間違い』は4択には適用不可（=スタックの直接原因を遮断）", () => {
  assert.equal(correctionApplies({ text: "間違い" }, mcOpts), false);
});
t("○✕の訂正『間違い』は○✕の選択肢には適用可", () => {
  assert.equal(correctionApplies({ text: "間違い" }, tfOpts), true);
});
t("4択の正解（接頭字あり選択肢）は接頭字なし正解テキストで適用可", () => {
  assert.equal(correctionApplies({ text: "Webページの材料データ" }, mcOpts), true);
});
t("cloze(seq)は全語が選択肢に在るときだけ適用可", () => {
  assert.equal(correctionApplies({ seq: ["正しい", "間違い"] }, tfOpts), true);
  assert.equal(correctionApplies({ seq: ["正しい", "存在しない語"] }, tfOpts), false);
});
t("空/不正な訂正は適用不可", () => {
  assert.equal(correctionApplies(null, tfOpts), false);
  assert.equal(correctionApplies({ text: "" }, tfOpts), false);
  assert.equal(correctionApplies({}, tfOpts), false);
});

console.log("optionMatchesCorrect: 既存仕様（接頭字1〜2字差を許容）の回帰");
t("接頭字ありの選択肢は接頭字なし正解に一致", () => {
  assert.equal(optionMatchesCorrect("DWebページの材料データ", "Webページの材料データ"), true);
  assert.equal(optionMatchesCorrect("間違い", "間違い"), true);
  assert.equal(optionMatchesCorrect("正しい", "間違い"), false);
});

console.log(`\n✅ 全 ${pass} 件パス`);
