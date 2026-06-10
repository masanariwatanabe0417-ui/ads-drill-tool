import { neon } from "@neondatabase/serverless";

/**
 * Neon(PostgreSQL) 接続ヘルパー
 *
 * DATABASE_URL が設定されていれば Neon を使う（Vercel本番 / ローカルで .env.local に設定したとき）。
 * 設定されていなければ null を返し、呼び出し側はローカルJSONファイルにフォールバックする。
 *
 * ※ DATABASE_URL の値は Vercel の Storage で Neon を追加すると自動で入る。
 *   ローカルで使いたいときは .env.local に同じ値をコピーする（コミット禁止）。
 */

const databaseUrl = process.env.DATABASE_URL;

export const hasDatabase = Boolean(databaseUrl);

export const sql = databaseUrl ? neon(databaseUrl) : null;

/** study_log テーブルが無ければ作る（id=1 の1行に studyLog 全体を JSON で保存する設計） */
export async function ensureStudyLogTable(): Promise<void> {
  if (!sql) return;
  await sql`
    CREATE TABLE IF NOT EXISTS study_log (
      id INTEGER PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
}
