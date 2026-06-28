// visual-explainer の base.html 相当の「額縁」。
// AIが生成した本文HTML（content）を、Tailwind CDN・Lucide Icons・ADS配色を備えた
// 自己完結の1枚HTMLに包む。iframe(srcDoc) で表示し、PDF出力（window.print）も効く。
// 由来: ~/Desktop/src/creating-visual-explainers の references/base.html

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildDiagramHtml(opts: {
  title: string;
  description: string;
  content: string; // AIが生成した <main> 内の本文HTML
}): string {
  const title = escapeHtml(opts.title);
  // 注: description は呼び出し側が渡すが、現在この額縁では本文に差し込んでいない（未使用）。
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow, noarchive, nosnippet, noimageindex">
  <title>${title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700;900&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            ads: {
              bg: '#FFFFFF',
              surface: '#F8FAFC',
              hover: '#F1F5F9',
              border: '#E2E8F0',
              accent: '#3B82F6',
              'accent-light': '#2563EB',
              text: '#1E293B',
              muted: '#64748B',
              dim: '#94A3B8',
              positive: '#10B981',
              negative: '#EF4444',
              warning: '#F59E0B',
            }
          },
          fontFamily: {
            sans: ['"Noto Sans JP"', '"Hiragino Sans"', '"Hiragino Kaku Gothic ProN"', '"Yu Gothic UI"', '"Meiryo"', 'sans-serif'],
          }
        }
      }
    }
  </script>
  <style>
    @media print {
      .no-print { display: none !important; }
      body { border-top: none !important; }
      .rounded-xl { break-inside: avoid; }
      .md\\:flex-row { flex-direction: row !important; }
      .md\\:hidden { display: none !important; }
      .hidden.md\\:block { display: block !important; }
      .md\\:grid-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
      .sm\\:grid-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }
      .bg-clip-text.text-transparent {
        -webkit-background-clip: initial !important;
        background-clip: initial !important;
        color: #2563EB !important;
        -webkit-text-fill-color: #2563EB !important;
      }
    }
  </style>
</head>
<body class="bg-ads-bg text-slate-600 antialiased leading-relaxed border-t-4 border-ads-accent">
  <div class="no-print max-w-3xl mx-auto px-5 pt-2 flex justify-end">
    <button onclick="window.print()" class="flex items-center gap-1.5 text-xs text-ads-dim hover:text-ads-accent transition-colors cursor-pointer">
      <i data-lucide="download" class="w-3.5 h-3.5"></i>
      PDF
    </button>
  </div>
  <main class="max-w-3xl mx-auto px-5 py-10 md:py-16">
${opts.content}
  </main>
  <footer class="max-w-3xl mx-auto px-5 pb-10 pt-6 border-t border-ads-border/30">
    <p class="text-xs text-ads-dim text-center">本気AIドリルの図解ツールで作成</p>
  </footer>
  <script src="https://unpkg.com/lucide@latest"></script>
  <script>lucide.createIcons();</script>
  <script>
    // 親(iframe)に実コンテンツ高さを通知し、ぴったり表示させる。
    // Tailwind CDN は非同期で効くため、少し遅延しても再通知する。
    function adsReportHeight() {
      var h = document.documentElement.scrollHeight;
      parent.postMessage({ type: 'ads-diagram-height', height: h }, '*');
    }
    window.addEventListener('load', adsReportHeight);
    window.addEventListener('resize', adsReportHeight);
    setTimeout(adsReportHeight, 300);
    setTimeout(adsReportHeight, 1200);
    setTimeout(adsReportHeight, 3000);
  </script>
</body>
</html>`;
}
