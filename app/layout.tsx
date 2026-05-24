import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ADSドリル理解支援ツール",
  description: "AIがドリルの問題・解答を解説し、質問に答えてくれる学習支援ツール",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className="antialiased">{children}</body>
    </html>
  );
}
