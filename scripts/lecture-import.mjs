#!/usr/bin/env node
// スクール講義の文字起こしを「疑似コース」として取り込む（設計: NEXT_TASKS.md 2026-07-06a）。
// データ形: contentType:"lecture" のコース ＋ 1レッスン=1セクション=1エントリ(§n)。
// 講義の教訓どおり、生成は1セクションずつ（大量一括はアテンション分散で品質が落ちる）。
// AI出力は「浅いJSON（keyLearning/mainContent）＋中身はMarkdown」= teacher route と同じ型。
//
// 使い方（2段階。プランを人が確認してから本生成＝課金）:
//   node scripts/lecture-import.mjs plan    # 統合・省略プランを生成 → scripts/lecture-plan.json
//   node scripts/lecture-import.mjs apply   # プランに従い解説生成 → :3000 経由で studyLog に保存
// 環境変数（省略時は第8回のデフォルト）:
//   TRANSCRIPT=<文字起こし.mdのパス> LECTURE_TITLE="第8回 ..." PLAN_FILE=<プランjson>
// 前提: apply は本番サーバー(:3000)稼働が必要（保存はPOST /api/study-logの正規ルート＝revガードを通す）。

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Anthropic from "@anthropic-ai/sdk";

const MODE = process.argv[2];
if (MODE !== "plan" && MODE !== "apply") {
  console.error("使い方: node scripts/lecture-import.mjs <plan|apply>");
  process.exit(1);
}

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const TRANSCRIPT =
  process.env.TRANSCRIPT ??
  path.join(os.homedir(), "Desktop/AI議会関連/ADS関連/ポータルサイト/20260620第8回講義_文字起こし.md");
const LECTURE_TITLE = process.env.LECTURE_TITLE ?? "第8回 自分のツールに記憶を持たせる";
const SERIES_NAME = "スクール講義";
const PLAN_FILE = process.env.PLAN_FILE ?? path.join(ROOT, "scripts/lecture-plan.json");
const API_BASE = process.env.API_BASE ?? "http://localhost:3000";

// ── APIキー: .env.local のみ（鉄則: コードに書かない） ──────────────
function loadApiKey() {
  const envPath = path.join(ROOT, ".env.local");
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*ANTHROPIC_API_KEY\s*=\s*(.+?)\s*$/);
    if (m && !line.trim().startsWith("#")) return m[1].replace(/^["']|["']$/g, "");
  }
  throw new Error(".env.local に ANTHROPIC_API_KEY が見つかりません");
}
const client = new Anthropic({ apiKey: loadApiKey() });
const MODEL = "claude-haiku-4-5";

// ── 文字起こしを ## セクションに分割 ────────────────────────────────
function parseSections(mdText) {
  const lines = mdText.split("\n");
  const sections = [];
  let current = null;
  for (const line of lines) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      if (current) sections.push(current);
      current = { title: m[1], body: [] };
    } else if (current) {
      current.body.push(line);
    }
    // 先頭の「# タイトル」行と ## 前の前置きは捨てる（本文はすべて##配下にある前提）
  }
  if (current) sections.push(current);
  return sections.map((s, i) => ({ index: i, title: s.title, text: s.body.join("\n").trim() }));
}

// ── plan: 統合・省略プランを1回のAI呼び出しで作る ───────────────────
async function makePlan(sections) {
  const listing = sections
    .map((s) => `[${s.index}] ${s.title}（${s.text.length}字）: ${s.text.slice(0, 100).replace(/\n/g, " ")}`)
    .join("\n");
  const message = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 2048,
    output_config: {
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            entries: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string", description: "エントリの見出し（学びの中身が分かる短い日本語）" },
                  sectionIndexes: { type: "array", items: { type: "integer" }, description: "統合する元セクションのindex（昇順）" },
                  note: { type: "string", description: "統合・採用の理由ひと言" },
                },
                required: ["title", "sectionIndexes", "note"],
                additionalProperties: false,
              },
            },
            skipped: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  index: { type: "integer" },
                  reason: { type: "string" },
                },
                required: ["index", "reason"],
                additionalProperties: false,
              },
            },
          },
          required: ["entries", "skipped"],
          additionalProperties: false,
        },
      },
    },
    messages: [
      {
        role: "user",
        content: `以下はスクール講義「${LECTURE_TITLE}」の文字起こしのセクション一覧です（[index] 見出し（文字数）: 冒頭）。
学習ツールに取り込むための「エントリ分割プラン」を作ってください。

ルール：
- 学びの中身があるセクションをエントリにする。1エントリ=原則1セクション。
- アイスブレイク・休憩・挨拶だけのオープニング/クロージングなど学びが薄いセクションは省略(skipped)するか、内容が続いている隣接セクションに統合する。
- ワーク（演習）はそのワークが属する解説セクションと統合してよい。
- 「〜の作成①②」のような連番は、話題が同じでも別エントリのままでよい（1つが大きくなりすぎないように）。
- エントリは講義の進行順に並べる。sectionIndexesは昇順・重複割当なし。
- エントリ数の目安は6〜12。

${listing}`,
      },
    ],
  });
  const block = message.content.find((b) => b.type === "text");
  return JSON.parse(block.text);
}

// ── apply: 1セクション（プランの1エントリ）ずつ解説＋用語解説を生成 ──
async function generateEntry(entry, sections) {
  const source = entry.sectionIndexes
    .map((i) => `## ${sections[i].title}\n${sections[i].text}`)
    .join("\n\n");

  const explanationPromise = client.beta.messages.create({
    model: MODEL,
    max_tokens: 4096,
    output_config: {
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            keyLearning: {
              type: "string",
              description: "このセクションで学ぶ核心を1〜2文で（自分の言葉で、英語用語にはカタカナを括弧で補足）",
            },
            mainContent: {
              type: "string",
              description: "Markdown形式の解説本文。## このセクションの話 / ## 講義の中身 / ## 覚えるポイント の見出し構成",
            },
          },
          required: ["keyLearning", "mainContent"],
          additionalProperties: false,
        },
      },
    },
    messages: [
      {
        role: "user",
        content: `あなたは入社したての社員に教える親切な先輩社員です。
以下はスクール講義「${LECTURE_TITLE}」の文字起こしの一部（セクション「${entry.title}」）です。
読んだ後に自分の言葉で説明できるレベルの解説に書き直してください。

重要ルール：
- 文字起こしの原文をそのまま使わず、自分の言葉で噛み砕いて説明する
- 話し言葉の脱線・繰り返し・進行上のつなぎは省き、学びの中身だけを残す
- 講義で示された具体例・実演の流れは省きすぎず、エピソードとして残す（抽象論だけにしない）
- 英語・コード用語が出てきたら必ず直後にカタカナを括弧で補足する（例：branch(ブランチ)）

mainContent の見出し構成：
## このセクションの話
（何の話をしているパートか1〜3文）

## 講義の中身
（講義の流れに沿って学びを順に解説。必要なら ### 小見出しで区切る）

## 覚えるポイント
（持ち帰るべき核心を1〜3点）

--- 文字起こしここから ---
${source}`,
      },
    ],
  });

  const glossaryPromise = client.messages.create({
    model: MODEL,
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: `あなたは入社したての社員に教える親切な先輩社員です。
以下の講義文字起こしに登場する専門用語だけに絞って、中学生でもわかる言葉で説明してください。

以下の形式のMarkdownのみを返してください（他のテキストは含めない）：
## 用語解説
- 用語(読み): 説明
- 用語(読み): 説明

ルール（読みの付け方）：
- 英語・コード用語 → カタカナの読みを括弧で補足（例：branch(ブランチ)）
- 漢字を含む用語 → ひらがなの振り仮名を括弧で補足（例：変更履歴(へんこうりれき)）
- カタカナだけの用語 → 括弧は付けない（例：マージ）。ひらがな読みを付けるのは禁止
その他のルール：
- 3〜6個の用語を選んでください
- 説明は1文で簡潔に

--- 文字起こしここから ---
${source}`,
      },
    ],
  });

  const [expMsg, gloMsg] = await Promise.all([explanationPromise, glossaryPromise]);
  const expBlock = expMsg.content.find((b) => b.type === "text");
  const parsed = JSON.parse(expBlock.text);
  const gloBlock = gloMsg.content.find((b) => b.type === "text");
  const glossary = gloBlock ? gloBlock.text.trim() : "";
  // teacher route と同じ合成（用語解説 + 本文）→ 単語帳が既存機構で自動連動する
  const explanation = `${glossary}\n\n${parsed.mainContent ?? ""}`.trim();
  return { keyLearning: parsed.keyLearning ?? "", explanation };
}

async function saveCourse(course) {
  const getRes = await fetch(`${API_BASE}/api/study-log`);
  if (!getRes.ok) throw new Error(`GET /api/study-log 失敗: ${getRes.status}`);
  const log = await getRes.json();
  const rev = log._rev;
  delete log._rev;
  const idx = log.courses.findIndex((c) => c.courseKey === course.courseKey);
  if (idx >= 0) {
    console.log(`既存の講義コースを差し替えます: ${course.courseKey}`);
    log.courses[idx] = course;
  } else {
    log.courses.push(course);
  }
  const postRes = await fetch(`${API_BASE}/api/study-log`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...log, _rev: rev }),
  });
  const result = await postRes.json();
  if (!postRes.ok || !result.ok) throw new Error(`POST /api/study-log 失敗: ${JSON.stringify(result)}`);
  if (result.merged) {
    console.warn("⚠ rev不一致で救済マージに倒れました。アプリタブが開いていたら閉じて、結果を確認してください。");
  }
  return result;
}

// 取込後の検証: 講義を除いたドリルの合計が変わっていないこと（検証ルール: lectureは問題数勘定から除外）
async function verify(expectedSections) {
  const res = await fetch(`${API_BASE}/api/study-log`);
  const log = await res.json();
  const lectures = log.courses.filter((c) => c.contentType === "lecture");
  const drills = log.courses.filter((c) => c.contentType !== "lecture");
  const drillQ = drills.reduce((s, c) => s + c.lessons.reduce((a, l) => a + l.questions.length, 0), 0);
  const drillL = drills.reduce((s, c) => s + c.lessons.length, 0);
  const lecture = lectures.find((c) => c.courseName === LECTURE_TITLE);
  console.log("── 検証 ──");
  console.log(`ドリル: ${drills.length}コース / ${drillL}レッスン / ${drillQ}問（講義除外後。取込前と一致すること）`);
  console.log(`講義: ${lectures.length}本`);
  if (!lecture) throw new Error("保存したはずの講義コースが見つかりません");
  console.log(`「${LECTURE_TITLE}」: ${lecture.lessons.length}セクション（期待値 ${expectedSections}）`);
  if (lecture.lessons.length !== expectedSections) throw new Error("セクション数が期待値と一致しません");
}

// ── main ─────────────────────────────────────────────────────────────
const sections = parseSections(fs.readFileSync(TRANSCRIPT, "utf8"));
console.log(`文字起こし: ${TRANSCRIPT}`);
console.log(`セクション数: ${sections.length}`);

if (MODE === "plan") {
  const plan = await makePlan(sections);
  const out = { lectureTitle: LECTURE_TITLE, transcript: TRANSCRIPT, ...plan };
  fs.writeFileSync(PLAN_FILE, JSON.stringify(out, null, 2));
  console.log(`\nプランを保存: ${PLAN_FILE}\n`);
  for (const [i, e] of plan.entries.entries()) {
    const srcTitles = e.sectionIndexes.map((x) => sections[x]?.title ?? `?${x}`).join(" + ");
    console.log(`§${i + 1} ${e.title}  ←  ${srcTitles}\n     (${e.note})`);
  }
  console.log("\n省略:");
  for (const s of plan.skipped) {
    console.log(`  [${s.index}] ${sections[s.index]?.title}: ${s.reason}`);
  }
} else {
  const plan = JSON.parse(fs.readFileSync(PLAN_FILE, "utf8"));
  if (plan.lectureTitle !== LECTURE_TITLE) {
    throw new Error(`プランの講義タイトル不一致: ${plan.lectureTitle} ≠ ${LECTURE_TITLE}`);
  }
  const lessons = [];
  for (const [i, entry] of plan.entries.entries()) {
    console.log(`生成中 §${i + 1}/${plan.entries.length}: ${entry.title} ...`);
    const { keyLearning, explanation } = await generateEntry(entry, sections);
    lessons.push({
      lessonName: entry.title,
      questions: [
        { questionInfo: `§${i + 1}`, keyLearning, explanation, timestamp: Date.now() },
      ],
    });
  }
  const course = {
    courseKey: `${SERIES_NAME}__${LECTURE_TITLE}`,
    seriesName: SERIES_NAME,
    courseName: LECTURE_TITLE,
    contentType: "lecture",
    lessons,
  };
  await saveCourse(course);
  await verify(plan.entries.length);
  console.log("✅ 取込完了");
}
