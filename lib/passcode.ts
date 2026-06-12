const STORAGE_KEY = "aiPasscode";

// プロンプトをキャンセルしたら、同一ページ内では再表示しない
// （単語カードごとの自動統合などで401が連発してもprompt地獄にならないように）
let promptDeclined = false;

// AIルート（/api/teacher 等）用のfetch。保存済みパスコードをヘッダーに付け、
// 401なら入力を求めて1回だけ再試行する。パスコード未設定の環境では素のfetchと同じ挙動。
export async function aiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) headers.set("x-app-passcode", saved);

  let res = await fetch(input, { ...init, headers });

  if (res.status === 401 && !promptDeclined) {
    const code = window.prompt("AI機能のパスコードを入力してください");
    if (!code) {
      promptDeclined = true;
    } else {
      headers.set("x-app-passcode", code);
      res = await fetch(input, { ...init, headers });
      if (res.status === 401) {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        localStorage.setItem(STORAGE_KEY, code);
      }
    }
  }

  return res;
}
