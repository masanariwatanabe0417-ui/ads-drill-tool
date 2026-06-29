// drill-review-core の純関数テスト（実行: node scripts/drill-review-core.test.mjs）
// (b) 復習自己訂正の取り違え修正を実証する。実ライブ(2026-06-27f Lesson8 The Finale)で起きた
// 「○✕の訂正『間違い』が4択へ誤適用されてスタック」を、その場のDOM値で再現して検証する。
import assert from "node:assert/strict";
import { questionSig, correctionApplies, optionMatchesCorrect, findLoose, extractClozeSequence, orderedOptionsInText, extractOrderFromFeedbackText, bestOverlapIndex, resolveWithElimination, assignMatchingPairs } from "./drill-review-core.mjs";

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

// 実ライブ(ビルドとモダンCSS Lesson5 Q6 穴埋め×2)の保存解説。正解理由の積み上げ説明に誤答語「PC」が
// 先に登場し（「段階的にPC向けのスタイルを追加していく」）、裸の出現順走査だと [PC,スマホ] と誤導出して
// いた（6回失敗で復習が止まり L6 以降を取りこぼした真因）。結論文「つまり、スマホ用が基本で、md:やlg:で
// …が正解です」だけ見れば正解 [スマホ, md: や lg:] が引ける。
const clozeExplTailwind = `## 問題
Tailwind は ＿＿＿ 用のスタイルが基本で、 ＿＿＿ で大画面向けを追加する設計。

## 回答
選択問題です。正解は下の「解説」を参照してください。

選択肢:
- sm: や xs:
- スマホ
- PC
- md: や lg:

## 解説
### なぜこれが正解？
Tailwindの設計哲学は「小さい画面から始める」という考え方です。何もプレフィックス（接頭辞）をつけないクラス名は、スマートフォンのような小さい画面で最初に適用されます。その上で、画面が大きくなるにつれて「md:（768px以上）」や「lg:（1024px以上）」といったプレフィックス（接頭辞）をつけたクラスで、段階的にPC向けのスタイルを追加していく設計になっています。つまり、スマホ用が基本で、md:やlg:で大画面向けを追加するというのが正解です。

### 間違い選択肢のどこが違う？
**sm:やxs:**：これらは実は超小さい画面用です。
**スマホ：** 前半の空欄の答えとしては正しいです。
**PC：** スマホではなくPCが基本という逆の考え方でNGです。`;
const clozeOptsTailwind = ["sm: や xs:", "スマホ", "PC", "md: や lg:"];
t("Tailwind L5 Q6 の正解順=[スマホ, md: や lg:]を引く（積み上げ説明の誤答語『PC』に惑わされない）", () => {
  assert.deepEqual(extractClozeSequence(clozeExplTailwind, clozeOptsTailwind, 2), ["スマホ", "md: や lg:"]);
});

// readCorrectFromFeedback の自己訂正フォールバック相当: 実フィードバック本文（緑枠なし）から正解順を引く。
const tailwindFeedbackText =
  "不正解... マスターのワンポイント Tailwind は スマホ用が基本 で、 md: や lg: で大画面向けを追加 するモバイルファースト設計です。 プレフィックスなしのクラスがスマホに適用され、md: は768px以上、lg: は1024px以上で適用されます。 次の問題へ";
t("フィードバック本文（緑枠なし）から穴埋め正解順=[スマホ, md: や lg:]を読める", () => {
  assert.deepEqual(orderedOptionsInText(tailwindFeedbackText, clozeOptsTailwind), ["スマホ", "md: や lg:"]);
});

// === 並べ替え自己訂正（フィードバックの「A→B→C の順です」を読み、略語→フル選択肢に対応づける）===
// 実ライブ(2026-06-28m データベース連携 L7 Q7)の review-wrong-Q7.html フィードバック実テキストで検証。
console.log("\n並べ替え: フィードバックの正解順を読み、略語をフル選択肢にマッピングして自己訂正");

// ドリルが不正解後に出す実フィードバック（マスターのワンポイント … の順です）。
const orderingFeedback =
  "1 モデルのスキーマを変更する 2 マイグレーションコマンドを実行する 3 変更内容のSQLが自動で作られる " +
  "4 DBのテーブルに列が追加される 不正解... マスターのワンポイント スキーマ変更→コマンド実行→SQL生成→DB反映 の順です。 " +
  "リフォーム計画書（マイグレーションファイル）が自動生成されるので、既存データを壊さずに構造を変更できます。";

t("フィードバックから正解順（略語列）を抽出", () => {
  assert.deepEqual(extractOrderFromFeedbackText(orderingFeedback), [
    "スキーマ変更", "コマンド実行", "SQL生成", "DB反映",
  ]);
});
t("前置きが無い/矢印が無い場合は空（誤学習しない）", () => {
  assert.deepEqual(extractOrderFromFeedbackText("不正解...もう一度挑戦しましょう"), []);
  assert.deepEqual(extractOrderFromFeedbackText(""), []);
});

// 実際の並べ替え選択肢（フル文）。略語ヒントをこれらに対応づけられれば正しい順でタップできる。
const orderingOptions = [
  "モデルのスキーマを変更する",
  "マイグレーションコマンドを実行する",
  "変更内容のSQLが自動で作られる",
  "DBのテーブルに列が追加される",
];
t("略語『コマンド実行』→『マイグレーションコマンドを実行する』（findLooseでは取れない）", () => {
  assert.equal(findLoose(orderingOptions, "コマンド実行"), -1); // 包含一致では取れないことを明示
  assert.equal(bestOverlapIndex(orderingOptions, "コマンド実行"), 1);
});
t("4略語すべてが正しいフル選択肢に1対1で対応づく（=正解順でタップできる）", () => {
  const seq = ["スキーマ変更", "コマンド実行", "SQL生成", "DB反映"];
  const mapped = seq.map((lab) => bestOverlapIndex(orderingOptions, lab));
  assert.deepEqual(mapped, [0, 1, 2, 3]);
});
t("どの選択肢とも語が重ならない略語は -1（誤タップ防止）", () => {
  assert.equal(bestOverlapIndex(orderingOptions, "全く無関係なラベル"), -1);
});

// --- 線結び（マッチング）の照合フォールバック＋1対1消去法割当（品質とデプロイ L3 Q7 の自動突破） ---
// ★実データ: studyLog の保存「正しい対応」と実ライブ DOM（drill-dump.review-wrong-Q7.html）の実測値。
//   保存ペア左 = 「LCP（Largest Contentful Paint）」等＝略語(3字)＋丸括弧の正式名注記。
//   実ライブ左セル = ["LCP","FID","CLS"]（3字）。右はこのQでは保存=実セルが一致していた。
// ★真因: findLoose は 3字ラベルを <4字ガードと括弧除去後の長さ<4 で弾く→左が全滅(-1)→
//   plan=0/3→機械接続(位置)→不正解→6回停止していた。bestOverlapIndex（"lcp"トークン一致）で救う。
console.log("assignMatchingPairs: 線結びの略語(3字)＋括弧注記の左ラベルを正しいセルへ割当（実データ）");
const matchLeft = ["LCP", "FID", "CLS"];
const matchRightLive = ["操作への反応時間", "表示のガタつき", "最大要素の表示時間"]; // 実DOM並び
const matchPairs = [
  { left: "LCP（Largest Contentful Paint）", right: "最大要素の表示時間" },
  { left: "FID（First Input Delay）", right: "操作への反応時間" },
  { left: "CLS（Cumulative Layout Shift）", right: "表示のガタつき" },
];

t("旧 findLoose は略語(3字)＋括弧注記の左を全滅(-1)させる＝0/3で機械接続に退避していた", () => {
  assert.deepEqual(matchPairs.map((p) => findLoose(matchLeft, p.left)), [-1, -1, -1]);
});
t("bestOverlapIndex は『lcp』等のトークン一致で左略語を正しく取れる", () => {
  assert.equal(bestOverlapIndex(matchLeft, "LCP（Largest Contentful Paint）"), 0);
  assert.equal(bestOverlapIndex(matchLeft, "CLS（Cumulative Layout Shift）"), 2);
});
t("assignMatchingPairs: 実データで左全3項目を正しい右セルへ接続するプランを返す", () => {
  const plan = assignMatchingPairs(matchLeft, matchRightLive, matchPairs);
  assert.deepEqual(plan, [
    [0, "最大要素の表示時間"],
    [1, "操作への反応時間"],
    [2, "表示のガタつき"],
  ]);
});
t("右セルが略語ヒントで曖昧でも消去法（他が先に確定→残りが一意化）で1対1に解ける", () => {
  // 右3セルが全部『表示』を含む合成ケース。単発 bestOverlapIndex は同点タイで -1 になりうるが、
  // 確実に取れる方を先に確定→使用済みを除外→残りが一意化して全部解ける。
  const right = ["最大要素の表示時間", "表示のガタつき", "操作への反応時間"];
  const rights = resolveWithElimination(right, ["最大要素の表示", "ガタつき表示", "操作への反応"]);
  assert.deepEqual(rights, [0, 1, 2]);
});
t("ラベル完全一致の素直な線結びも従来どおり接続できる（回帰）", () => {
  const left = ["親要素", "子要素"];
  const right = ["上位の箱", "中の箱"];
  const plan = assignMatchingPairs(left, right, [
    { left: "親要素", right: "上位の箱" },
    { left: "子要素", right: "中の箱" },
  ]);
  assert.deepEqual(plan, [[0, "上位の箱"], [1, "中の箱"]]);
});
t("どの右セルにも語が重ならないペアがあれば null（誤接続せず機械接続へ退避）", () => {
  const plan = assignMatchingPairs(matchLeft, matchRightLive, [
    { left: "LCP（Largest Contentful Paint）", right: "全く無関係なラベルあ" },
    { left: "FID（First Input Delay）", right: "全く無関係なラベルい" },
    { left: "CLS（Cumulative Layout Shift）", right: "全く無関係なラベルう" },
  ]);
  assert.equal(plan, null);
});

console.log(`\n✅ 全 ${pass} 件パス`);
