// ドリル DOM 読み取りの共有ヘルパ（副作用なし＝import するだけではブラウザを起動しない）。
// drill-import.mjs（自動取り込み）と drill-review.mjs（復習の自動突破）の双方が使う。
// readState は drill-import.mjs から移設した同一実装（挙動を変えない）。

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- DOM から現在の問題＋（あれば）回答後フィードバックを読み取る ---
// page: Playwright の Page。クイズ画面に居る前提。
export async function readState(page) {
  return page.evaluate(() => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();

    // 選択肢: aria-label = 表示ラベル、回答後は正解に「正解」が付与される
    const optEls = [...document.querySelectorAll('[data-testid^="quiz-answer-option-"]')];
    const opts = optEls.map((el) => {
      const aria = norm(el.getAttribute("aria-label"));
      const text = norm(el.textContent);
      return { aria, text };
    });
    const options = opts.map((o) => o.text || o.aria);
    // 正解 = aria-label に「正解」が付与され、かつ「不正解」ではない選択肢。
    //   正答時:  aria「間違い、正解」     / text「間違い」     → これが正解
    //   誤答時:  選んだ側 aria「正しい、不正解」/ 正解側 aria「間違い、正解」
    // 注意: 「不正解」は文字列「正解」を含むため、単純な includes("正解") だと
    //       誤答時に自分が選んだ不正解の選択肢を正解と誤判定する（要除外）。
    let correctAnswer = null;
    for (const o of opts) {
      if (o.aria && o.aria.includes("正解") && !o.aria.includes("不正解") && o.aria !== o.text) {
        correctAnswer = o.text || o.aria.replace(/[、,]?\s*正解.*$/, "");
        break;
      }
    }
    // aria-label が無い選択問題（例「選択肢から選んでください」型）は aria から正解を読めない。
    // ただし回答後はドリルが枠色で正誤を示す＝正解は緑枠 rgb(22,163,74) / 誤答選択は赤枠
    // rgb(239,68,68)（実DOMで確認済み・dump: choice-debug-Q6）。回答前は両色とも付かないため
    // null のまま＝回答後の readState でのみ拾える（import は feedback 後に readState する）。
    if (!correctAnswer) {
      for (let i = 0; i < optEls.length; i++) {
        const bc = (getComputedStyle(optEls[i]).borderColor || "").replace(/\s+/g, "");
        if (/22,163,74/.test(bc)) { correctAnswer = opts[i].text || norm(optEls[i].textContent); break; }
      }
    }

    // 指示文（「選択肢から選んでください」「正しい順番に並べてね」「タップして接続」など）を拾う。
    // 形式判定（並べ替え/マッチング/選択式）に使う。
    let instruction = "";
    for (const el of document.querySelectorAll('div[dir="auto"]')) {
      if (el.querySelector('div[dir="auto"]')) continue;
      const t = norm(el.textContent);
      if (/選んでください|選択肢から選|正しい順番に並べ|並べてね|タップして接続|正しいか間違いか/.test(t) && t.length <= 30) {
        instruction = t;
        break;
      }
    }

    // マッチング（線結び）判定: 画面に「ペア完成」マーカーがある（マッチング画面のみに出る）。
    const isMatching = /ペア完成/.test(document.body.innerText || "");

    // マッチングの右項目: 全選択肢を含む最小の共通祖先（問題コンテナ）内の、
    // tabindex を持つが data-testid が無いタップ可能 div。左項目テキストは除外。
    // （SPA がホーム画面を DOM に残すため、document 全体から拾うとカードが混入する＝コンテナ限定が必須。）
    let rightItems = [];
    if (isMatching && optEls.length >= 2) {
      let container = optEls[0];
      while (container && !optEls.every((o) => container.contains(o))) container = container.parentElement;
      if (container) {
        const leftSet = new Set(options);
        for (const el of container.querySelectorAll("div[tabindex]:not([data-testid])")) {
          const t = norm(el.textContent);
          if (!t || t.length > 40) continue;
          if (leftSet.has(t)) continue;
          if (rightItems.includes(t)) continue;
          rightItems.push(t);
        }
      }
    }

    // 並べ替え問題の判定: 選択肢に aria-label が無い（通常の選択式は aria=ラベルが付く）。
    // ただしマッチングは別扱い、また「選んでください」系の指示は単一選択（aria無しでも選択式）。
    // 回答前のこの状態でしか選択肢が読めない（回答後は選択肢が消える）。
    const isSelectPrompt = /選んでください|選択肢から選/.test(instruction);
    const isOrdering =
      !isMatching && optEls.length >= 2 && opts.every((o) => !o.aria) && !isSelectPrompt;

    // cloze（複数空欄の穴埋め）: 「選択肢から選んでください」型 かつ 本文に空欄（全角＿の連続）がある。
    // 回答前は空欄が ＿＿＿ で表示され、選択肢語を“空欄の順に”タップして埋める→全部埋まると「回答する」
    // が出る（並べ替えに近い／単一選択ではない。実機観察済み）。空欄数＝タップする語数。
    const clozeBlanks = ((document.body.innerText || "").match(/[＿_]{2,}/g) || []).length;
    const isCloze =
      isSelectPrompt && optEls.length >= 2 && opts.every((o) => !o.aria) && clozeBlanks >= 1;

    // Q番号・総数
    let qnum = null, total = null;
    for (const el of document.querySelectorAll("div")) {
      const t = norm(el.textContent);
      if (!qnum && /^Q\d+$/.test(t)) qnum = t;
      const m = t.match(/^\/\s*(\d+)\s*問$/);
      if (m) total = parseInt(m[1], 10);
      if (qnum && total) break;
    }

    // 問題文: 設問エリアの最長テキスト（選択肢・指示文・ナビ等を除外）
    const optionTexts = new Set(options);
    let questionText = "";
    for (const el of document.querySelectorAll('div[dir="auto"]')) {
      // 子に dir=auto を含む（=コンテナ）は除外し、葉テキストだけ見る
      if (el.querySelector('div[dir="auto"]')) continue;
      const t = norm(el.textContent);
      if (t.length < 12) continue;
      if (optionTexts.has(t)) continue;
      if (/選んでください|正しいか間違いか/.test(t)) continue;
      if (/タップして|並べてね|^正しい順番に並べて/.test(t)) continue; // 並べ替えの指示文
      if (/^Lesson\s*\d+/i.test(t)) continue;
      if (t.length > questionText.length) questionText = t;
    }

    // 回答後フィードバック
    const fbEl = document.querySelector('[data-testid="quiz-feedback"]');
    let answered = false, verdict = null, explanation = "";
    if (fbEl) {
      answered = true;
      const leaves = [...fbEl.querySelectorAll('div[dir="auto"]')].filter(
        (el) => !el.querySelector('div[dir="auto"]')
      );
      const paras = [];
      for (const el of leaves) {
        const t = norm(el.textContent);
        if (!t) continue;
        if (/^(正解|不正解|正解！|残念)/.test(t) && t.length <= 6) { verdict = t; continue; }
        if (t === "マスターのワンポイント") continue;
        paras.push(t);
      }
      explanation = paras.join("\n\n");
      if (!verdict) verdict = /不正解|残念/.test(norm(fbEl.textContent).slice(0, 12)) ? "不正解" : "正解";
    }

    // ヘッダ: 進捗バー直前の2テキスト＝[コンテキストラベル, タイトル]
    let contextLabel = "", title = "";
    {
      const texts = [...document.querySelectorAll('div[dir="auto"]')]
        .filter((el) => !el.querySelector('div[dir="auto"]'))
        .map((el) => norm(el.textContent));
      const qIdx = texts.findIndex((t) => /^Q\d+$/.test(t));
      if (qIdx > 1) {
        const before = texts.slice(0, qIdx).filter((t) => t && t.length <= 30);
        title = before[before.length - 1] || "";
        contextLabel = before[before.length - 2] || "";
      }
    }
    // シリーズ名: 「学習中のシリーズ」の直後テキスト
    let series = "";
    {
      const texts = [...document.querySelectorAll('div[dir="auto"]')].map((el) => norm(el.textContent));
      const i = texts.findIndex((t) => t === "学習中のシリーズ");
      if (i !== -1 && texts[i + 1]) series = texts[i + 1];
    }

    return { options, correctAnswer, isOrdering, isMatching, isCloze, clozeBlanks, rightItems, instruction, qnum, total, questionText, answered, verdict, explanation, contextLabel, title, series };
  });
}
