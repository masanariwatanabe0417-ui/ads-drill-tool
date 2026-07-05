// ドリルの閲覧専用ビューア。取り込みはしない（SERIES確定前の下見用）。
// 取込と同じ永続プロファイルでブラウザを開くだけ。終了は Ctrl+C / pkill。
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = path.join(__dirname, ".pw-profile");
const START_URL = "https://drill.ma-ji.ai/";

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  viewport: { width: 430, height: 900 },
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto(START_URL, { waitUntil: "domcontentloaded" }).catch(() => {});
console.log("閲覧用ブラウザを開きました（取り込みは行いません）。終了は Ctrl+C");
// ブラウザが閉じられるまで待つ
await new Promise((resolve) => ctx.on("close", resolve));
