"use client";

import { Volume2, Pause, Play, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// ── まとめ音声化（ブラウザ標準 Web Speech API・無料/キー不要/クライアント完結）──
// Chrome は長文を1発で読むと途中で止まるバグがあるため、文単位に分割して順次読み上げる。

interface AudioSummaryProps {
  /** 読み上げる原稿（呼び出し側で keyLearning を束ねて渡す） */
  text: string;
}

function splitIntoChunks(text: string): string[] {
  const out: string[] = [];
  let buf = "";
  for (const ch of text) {
    buf += ch;
    if (ch === "。" || ch === "！" || ch === "？" || ch === "\n") {
      const t = buf.trim();
      if (t) out.push(t);
      buf = "";
    }
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
}

type Status = "idle" | "playing" | "paused";

export default function AudioSummary({ text }: AudioSummaryProps) {
  const [supported, setSupported] = useState(true);
  const [status, setStatus] = useState<Status>("idle");
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  // 再生世代トークン。stop/再生やり直しで ++ して古い onend コールバックを無効化する。
  const genRef = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setSupported(false);
      return;
    }
    const pickVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      voiceRef.current =
        voices.find((v) => v.lang === "ja-JP") ||
        voices.find((v) => v.lang.startsWith("ja")) ||
        null;
    };
    pickVoice();
    // 音声リストは非同期で届くことがある
    window.speechSynthesis.addEventListener("voiceschanged", pickVoice);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", pickVoice);
      genRef.current++;
      window.speechSynthesis.cancel(); // 画面遷移・アンマウントで停止
    };
  }, []);

  const start = () => {
    window.speechSynthesis.cancel();
    const gen = ++genRef.current;
    const chunks = splitIntoChunks(text);
    if (chunks.length === 0) return;
    setStatus("playing");

    const speak = (i: number) => {
      if (gen !== genRef.current) return; // 停止/やり直し済み
      if (i >= chunks.length) {
        setStatus("idle");
        return;
      }
      const u = new SpeechSynthesisUtterance(chunks[i]);
      u.lang = "ja-JP";
      if (voiceRef.current) u.voice = voiceRef.current;
      u.rate = 1.0;
      u.onend = () => {
        if (gen === genRef.current) speak(i + 1);
      };
      u.onerror = () => {
        if (gen === genRef.current) setStatus("idle");
      };
      window.speechSynthesis.speak(u);
    };
    speak(0);
  };

  const pause = () => {
    window.speechSynthesis.pause();
    setStatus("paused");
  };
  const resume = () => {
    window.speechSynthesis.resume();
    setStatus("playing");
  };
  const stop = () => {
    genRef.current++;
    window.speechSynthesis.cancel();
    setStatus("idle");
  };

  if (!supported) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full border border-muted bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground shrink-0 print:hidden"
        title="このブラウザは音声読み上げに対応していません"
      >
        <Volume2 className="h-3.5 w-3.5" />
        音声非対応
      </span>
    );
  }

  const pillBase =
    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors shrink-0 print:hidden";

  if (status === "idle") {
    return (
      <button
        onClick={start}
        className={`${pillBase} border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100`}
        title="まとめの要点を音声で読み上げます"
      >
        <Volume2 className="h-3.5 w-3.5" />
        音声で聞く
      </button>
    );
  }

  return (
    <div className="inline-flex items-center gap-1.5 shrink-0 print:hidden">
      {status === "playing" ? (
        <button
          onClick={pause}
          className={`${pillBase} border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100`}
          title="一時停止"
        >
          <Pause className="h-3.5 w-3.5" />
          一時停止
        </button>
      ) : (
        <button
          onClick={resume}
          className={`${pillBase} border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100`}
          title="再開"
        >
          <Play className="h-3.5 w-3.5" />
          再開
        </button>
      )}
      <button
        onClick={stop}
        className={`${pillBase} border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100`}
        title="停止"
      >
        <Square className="h-3.5 w-3.5" />
        停止
      </button>
    </div>
  );
}
