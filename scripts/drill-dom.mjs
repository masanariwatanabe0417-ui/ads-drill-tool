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
      if (/選んでください|選択肢から選|正しい順番に並べ|並べてね|タップして接続|正しいか間違いか|スライダーで調整/.test(t) && t.length <= 30) {
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
          // 長さ上限はゴミ除けの補助（主役はコンテナ限定）。40 だと実在の右ラベル
          // 「Tailwind CSS（スタイル）や shadcn/ui（UI 部品）と役割分担できる」(44字) を
          // 取り漏らし、機械接続が 2/3 ペアで止まって解答不能→シリーズ停止した（一気通貫の統合 L3 Q6）。
          if (!t || t.length > 100) continue;
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

    // adjust（スライダー調整）: 選択肢が1つも無く、指示「スライダーで調整してください」がある新形式
    // （2026-07-04 UIデザインの世界 L5「AIスロップの正体」で初遭遇）。スライダー本体は
    // Diagram WebView（srcdoc iframe）内の input[type=range] で、メインDOMには存在しない。
    const isAdjust = optEls.length === 0 && /スライダーで調整/.test(document.body.innerText || "");

    // Q番号・総数
    let qnum = null, total = null;
    for (const el of document.querySelectorAll("div")) {
      const t = norm(el.textContent);
      if (!qnum && /^Q\d+$/.test(t)) qnum = t;
      const m = t.match(/^\/\s*(\d+)\s*問$/);
      if (m) total = parseInt(m[1], 10);
      if (qnum && total) break;
    }

    // 問題文: 設問エリアの最長テキスト（選択肢・指示文・ナビ等を除外）。
    // ⚠ フィナーレ（最終レッスン）には固定バナー「…（The Finale）」が常駐し、これが本物の問題文より
    //   長いと「最長テキスト」ヒューリスティックで questionText に化けて lookup/sig が外れる
    //   （実ライブで ○✕↔4択 が同一 sig になり訂正が誤適用、復習で Q2/Q3 が一旦「未知」化した）。
    //   バナーは永続ナビ/ヘッダー側のサブツリーに在り、選択肢コンテナとは深い祖先でしか共通祖先を
    //   持たない。→ 走査の起点を「選択肢コンテナの祖先（＝設問本体スコープ）」に絞ってナビ/バナーを
    //   除外する。実測（drill-dump 多数）: 正規の問題文は選択肢コンテナの 5 段以内、バナー/ナビは
    //   10 段目で初めて同一サブツリーに入る。8 段上れば両側にマージンがあり、非フィナーレ問題（選択/
    //   並べ替え/線結び/穴埋め/○✕）の questionText は従来と完全一致する（37 ダンプで回帰なし確認）。
    const optionTexts = new Set(options);
    let qScope = optEls[0] || null;
    while (qScope && !optEls.every((o) => qScope.contains(o))) qScope = qScope.parentElement;
    if (qScope) for (let k = 0; k < 8 && qScope.parentElement; k++) qScope = qScope.parentElement;
    const qRoot = qScope || document; // 選択肢が無い画面（フィードバックのみ等）は従来どおり document 全体
    let questionText = "";
    for (const el of qRoot.querySelectorAll('div[dir="auto"]')) {
      // 子に dir=auto を含む（=コンテナ）は除外し、葉テキストだけ見る
      if (el.querySelector('div[dir="auto"]')) continue;
      const t = norm(el.textContent);
      if (t.length < 12) continue;
      if (optionTexts.has(t)) continue;
      // ⚠ 指示文除外は「短い汎用指示」だけに限定する（≤30字。instruction 取得[L50]と同じ閾値）。
      //   長さ無制限で除外すると、末尾が「…選んでください。」の本物の問題文（例 線結び
      //   「HTMLのタグは…それぞれのタグが示す意味を選んでください。」47字）まで丸ごと消え、
      //   questionText 空→保存API 400（必須項目欠落）→未保存→復習で「未知」化して停止する事故になる。
      if (t.length <= 30 && /選んでください|正しいか間違いか/.test(t)) continue;
      if (t.length <= 30 && /タップして|並べてね|^正しい順番に並べて|スライダーで調整/.test(t)) continue; // 並べ替え等の指示文
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

    return { options, correctAnswer, isOrdering, isMatching, isCloze, isAdjust, clozeBlanks, rightItems, instruction, qnum, total, questionText, answered, verdict, explanation, contextLabel, title, series };
  });
}

// --- シリーズのテーマ色を DOM から収集する（②色分け用・副作用なし）---
// ドリルの新UIはシリーズごとにテーマ色を持つ。特定セレクタに依存すると UI 変更で壊れるため、
// 「画面上で十分な面積を占める・彩度のある背景色」を面積加重で数え、最頻の色を代表色として返す。
// 白/黒/グレー（彩度が低い）と小さな要素は除外。見つからなければ null。返り値は "#rrggbb"。
export async function collectThemeColor(page) {
  return page
    .evaluate(() => {
      const counts = new Map();
      // 1色を面積加重で数える（透明・低彩度=白/黒/グレーは除外）
      const tally = (m, weight) => {
        if (!m) return;
        const [r, g, b] = [+m[1], +m[2], +m[3]];
        const a = m[4] === undefined ? 1 : +m[4];
        if (a < 0.5) return; // ほぼ透明
        if (Math.max(r, g, b) - Math.min(r, g, b) < 40) return; // 彩度が低い（白/黒/グレー）
        const key = `${r},${g},${b}`;
        counts.set(key, (counts.get(key) || 0) + weight);
      };
      const RGB = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/;
      for (const el of document.querySelectorAll("body *")) {
        const rect = el.getBoundingClientRect();
        if (rect.width < 40 || rect.height < 20) continue; // 小さすぎる要素はノイズ
        const area = rect.width * rect.height;
        const cs = getComputedStyle(el);
        tally((cs.backgroundColor || "").match(RGB), area);
        // グラデーション背景（background-image: linear-gradient(...) 等）の構成色も数える。
        // 実機（2026-07-02 Git開発フロー実践）で backgroundColor が全て白/グレーの画面があり、
        // テーマ色がグラデーションにしか現れなかった。面積は構成色で等分する。
        const grad = cs.backgroundImage || "";
        if (grad.includes("gradient")) {
          const stops = grad.match(new RegExp(RGB.source, "g")) || [];
          for (const s of stops) tally(s.match(RGB), area / stops.length);
        }
      }
      let best = null, bestWeight = 0;
      for (const [key, weight] of counts) {
        if (weight > bestWeight) { best = key; bestWeight = weight; }
      }
      if (!best) return null;
      const hex = best.split(",").map((n) => (+n).toString(16).padStart(2, "0")).join("");
      return `#${hex}`;
    })
    .catch(() => null);
}
