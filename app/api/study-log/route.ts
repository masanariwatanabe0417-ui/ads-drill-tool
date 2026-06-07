import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

export const runtime = "nodejs";

const SAVE_PATH = path.join(os.homedir(), "Desktop", "AIドリル取込済み", "studyLog.json");

function ensureDir() {
  fs.mkdirSync(path.dirname(SAVE_PATH), { recursive: true });
}

export async function GET() {
  try {
    if (!fs.existsSync(SAVE_PATH)) {
      return NextResponse.json({ courses: [] });
    }
    const raw = fs.readFileSync(SAVE_PATH, "utf-8");
    return NextResponse.json(JSON.parse(raw));
  } catch {
    return NextResponse.json({ courses: [] });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    ensureDir();
    fs.writeFileSync(SAVE_PATH, JSON.stringify(body, null, 2), "utf-8");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
