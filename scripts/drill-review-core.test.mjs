// drill-review-core の純関数テスト（実行: node scripts/drill-review-core.test.mjs）
// (b) 復習自己訂正の取り違え修正を実証する。実ライブ(2026-06-27f Lesson8 The Finale)で起きた
// 「○✕の訂正『間違い』が4択へ誤適用されてスタック」を、その場のDOM値で再現して検証する。
import assert from "node:assert/strict";
import { questionSig, correctionApplies, optionMatchesCorrect, findLoose, extractClozeSequence } from "./drill-review-core.mjs";

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

console.log("findLoose: 並べ替え/線結びの照合が括弧注記差を吸収（最終レッスン復習の完走）");
// 実ライブ(Lesson8 並べ替え)の値。保存『正しい順序』に冗長注記、ドリル表示は短い注記。
const orderDisplayed = [
  "サーバーがレスポンス（データ）を返す",
  "ブラウザがデータを画面に組み立てる",
  "ブラウザがURLからサーバーの住所を特定する",
  "サーバーにリクエスト（注文）を送る",
];
t("保存『リクエスト（リクエスト＝注文）』が表示『リクエスト（注文）』に一致", () => {
  assert.equal(findLoose(orderDisplayed, "サーバーにリクエスト（リクエスト＝注文）を送る"), 3);
});
t("保存『レスポンス（レスポンス＝データ）』が表示『レスポンス（データ）』に一致", () => {
  assert.equal(findLoose(orderDisplayed, "サーバーがレスポンス（レスポンス＝データ）を返す"), 0);
});
t("注記の無い手順は従来どおり完全一致", () => {
  assert.equal(findLoose(orderDisplayed, "ブラウザがURLからサーバーの住所を特定する"), 2);
  assert.equal(findLoose(orderDisplayed, "ブラウザがデータを画面に組み立てる"), 1);
});
t("保存順序の4項目すべてが一意に解決（=並べ替え完走可能）", () => {
  const saved = [
    "ブラウザがURLからサーバーの住所を特定する",
    "サーバーにリクエスト（リクエスト＝注文）を送る",
    "サーバーがレスポンス（レスポンス＝データ）を返す",
    "ブラウザがデータを画面に組み立てる",
  ];
  const mapped = saved.map((x) => findLoose(orderDisplayed, x));
  assert.deepEqual(mapped, [2, 3, 0, 1]);
});
t("括弧を外すと同一になる紛らわしい候補は曖昧として-1（誤接続しない）", () => {
  // 「A（甲）」「A（乙）」は括弧除去で同一 → 一意に決まらず -1（安全側）。
  assert.equal(findLoose(["設定（甲）", "設定（乙）"], "設定（丙）"), -1);
});
t("無関係な語は-1のまま", () => {
  assert.equal(findLoose(orderDisplayed, "まったく別の文章です"), -1);
});

console.log("extractClozeSequence: 解説冒頭の『選択肢:』列挙に惑わされず正解順を引く");
// 実ライブ(Lesson8 Q10 穴埋め×2)の保存解説。冒頭の選択肢列挙は ブラウザ→インターネット→… の順で、
// 全文走査だと先頭2語=[ブラウザ,インターネット]を誤って拾う。正解は本文の出現順=[ブラウザ,サーバー]。
const clozeExpl = `## 問題
＿＿＿ がURL（住所）をもとに ＿＿＿ にリクエスト（注文）を送り、届いたデータを画面に組み立てる仕組み

## 回答
選択問題です。正解は下の「解説」を参照してください。

選択肢:
- ブラウザ
- インターネット
- クライアント
- サーバー

## 解説
### なぜこれが正解？
Webの仕組みをシンプルに考えると「ユーザーが見ている画面=ブラウザ」が主役です。ブラウザがアドレスバーのURLを読み込んで、その住所先にいるサーバーに「このデータをください」と頼みを出す—これがリクエストです。空欄には「ブラウザ」と「サーバー」が入ります。

### 間違い選択肢のどこが違う？
- **インターネット**：インターネットは「通信の道路」に過ぎず、リクエストを送る主体ではありません。
- **クライアント**：これはブラウザより範囲が広すぎるのでNG。`;
const clozeOpts = ["ブラウザ", "インターネット", "クライアント", "サーバー"];
t("Lesson8 Q10 の正解順=[ブラウザ,サーバー]を引く（列挙順[ブラウザ,インターネット]に惑わされない）", () => {
  assert.deepEqual(extractClozeSequence(clozeExpl, clozeOpts, 2), ["ブラウザ", "サーバー"]);
});
t("解説本文だけでは足りない時は選択肢列挙を除いた全文へフォールバック", () => {
  // 「## 解説」も「間違い選択肢」も無い素朴な解説でも、選択肢列挙は除いて本文順で引ける。
  const e = `## 問題\n＿ と ＿\n選択肢:\n- 甲\n- 乙\n本文では 乙 が先、その後 甲 が出ます。`;
  assert.deepEqual(extractClozeSequence(e, ["甲", "乙"], 2), ["乙", "甲"]);
});

// 実ライブ(CSSデザインマスター Lesson5 Q5 穴埋め×2)の保存解説。選択肢「要素」が地の文「インライン要素」に
// 部分一致して最速ヒットするため、裸の indexOf 全文走査だと [要素,中身] と誤導出していた（6回失敗で停止）。
// 答えの語は引用符で強調される（「中身の幅だけ取って横に並ぶ」「横」）→ 引用句優先で正解 [中身,横] を引く。
const clozeExplCss = `## 問題
ブロック要素が「大型家具」なら、インライン要素は「小物」です。インライン要素の特徴を完成させてください。

## 回答
選択問題です。正解は下の「解説」を参照してください。

選択肢:
- 縦
- 上
- 中身
- 横
- 要素
- 下

## 解説
### なぜこれが正解？

インライン要素は「中身の幅だけ取って横に並ぶ」という特徴があります。ブロック要素が家具のように独占的に場所を取るなら、インライン要素は小物のようにコンパクトで、左右に他の要素を置けるんです。だから正解は「横」。インライン要素同士は自然と横方向に並んでいきます。

### 間違い選択肢のどこが違う？

**「縦」：逆です。インライン要素は縦に積み重なりません。横に並ぶのが特徴です。**

**「上」「下」「中身」「要素」：これらは位置や内容を指していますが、配置方向の特徴を説明していません。**`;
const clozeOptsCss = ["縦", "上", "中身", "横", "要素", "下"];
t("CSS L5 Q5 の正解順=[中身,横]を引く（『要素』が『インライン要素』に部分一致する罠を回避）", () => {
  assert.deepEqual(extractClozeSequence(clozeExplCss, clozeOptsCss, 2), ["中身", "横"]);
});

// 引用が“構造的な列挙”のケース（実 CSS L4 Q5）。解説に「content→padding→border→margin」と全選択肢が
// 列挙引用されるが、これは答え順ではなく構造順。引用語数 > blankCount なら引用を捨て本文順へ戻す。
const clozeEnumExpl = `## 解説
### なぜこれが正解？
paddingが正解です。ボックスモデルは内側から「content(コンテンツ)→padding(パディング)→border(ボーダー)→margin(マージン)」という構造です。
### 間違い選択肢のどこが違う？
content：中身そのものなのでNG。`;
const enumOpts = ["content", "margin", "border", "padding"];
t("構造的な列挙引用に引きずられず本文順（padding先頭）を返す", () => {
  // bc=1: 引用は4語>1 → 捨てて本文「paddingが正解です」順 → [padding]（列挙の content ではない）。
  assert.deepEqual(extractClozeSequence(clozeEnumExpl, enumOpts, 1), ["padding"]);
});

console.log(`\n✅ 全 ${pass} 件パス`);
