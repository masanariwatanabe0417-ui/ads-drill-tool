# ads-drill-tool — 本気AIドリル

## セッション引き継ぎのルール（必ず守る）
- **作業フォルダ**: `~/Desktop/ads-drill-tool/ads-drill-tool/`（入れ子の方が最新。親フォルダは古い）
- **セッション開始時**: 必ず `git status` で未コミット確認・`git log --oneline -3` でコミット確認
- **セッション終了時**: ユーザーから「引き継ぎ」「次のセッション」「コミット＆プッシュ」を求められたら、コミット・プッシュ後に `bash handoff.sh` を実行してクリップボードに引き継ぎメモを生成すること
- **次にやること**: `NEXT_TASKS.md` を参照・更新する

## 概要
「本気AIドリル」の学習支援ツール。問題・解答のスクリーンショットを貼り付けると、Claude AI が自動解析して解説を生成する。コース/レッスン/問題の階層でまとめを管理できる。

## スタック
- **フレームワーク**: Next.js 14 (App Router) + TypeScript
- **UI**: Tailwind CSS + shadcn/ui (card, button, badge, textarea, scroll-area, separator)
- **AI**: Anthropic SDK (`@anthropic-ai/sdk`) — haiku (高速), opus (高品質解説)

## アーキテクチャ

### 4ペイン構成
```
NavigationPane (w-60) | ScreenshotPane (w-72) | TeacherPane (flex-1) | QuestionPane (w-80)
```

| ペイン | ファイル | 役割 |
|--------|----------|------|
| NavigationPane | `components/panes/NavigationPane.tsx` | コース/レッスン/問題の階層ツリー |
| ScreenshotPane | `components/panes/ScreenshotPane.tsx` | 問題・解答スクショ貼り付け |
| TeacherPane | `components/panes/TeacherPane.tsx` | AI解説表示 (question/lesson/course view) |
| QuestionPane | `components/panes/QuestionPane.tsx` | Q&Aチャット + 解説追記承認 |

### ルート状態管理
`components/DrillTool.tsx` が全状態を保持:
- `screenshots`: 問題・解答画像
- `studyLog`: コース/レッスン/問題の階層データ（セッション中のみ、永続化なし）
- `teacherView`: 現在表示中のビュー種別
- `qaEntries`: Q&Aエントリ一覧

### API ルート
| ルート | ファイル | 説明 |
|--------|----------|------|
| POST /api/teacher | `app/api/teacher/route.ts` | 3エージェント並列: extractLessonInfo(haiku) + generateGlossary(haiku) + generateExplanation(opus) |
| POST /api/question | `app/api/question/route.ts` | Q&A回答生成(haiku) + 解説への追加案生成 |

### 型定義
`lib/types.ts`: `DrillScreenshots`, `QAEntry`, `ExtractedLessonInfo`, `StudyLog`, `CourseData`, `LessonData`, `QuestionEntry`, `TeacherView`

## 開発コマンド
```bash
npm run dev    # 開発サーバー起動 (http://localhost:3000)
npm run build  # ビルド
npm run lint   # lint
```

## 環境変数
`.env.local.example` を参照:
```
ANTHROPIC_API_KEY=...
```

## 現状の制約
- `studyLog` はセッション中のみ（ページリロードでリセット）
- 画像は base64 でそのまま API に送信（大きいスクリーンショットは注意）

## ⚠️ セキュリティ・運用の鉄則（過去にトラブルあり。必ず守る）

### APIキーの扱い
- **APIキー等の秘密情報は `.env.local` だけに置く**（`.gitignore`済み。Next.jsで `.env` より優先）。
- **`.md`・コード・コミットメッセージ・引き継ぎメモにキーを絶対に書かない。**
  - 過去に `NEXT_SESSION.md` にキーを貼り、**public リポジトリへ漏洩**した（2026-06-08）。
  - 引き継ぎでは「キーは各自 console.anthropic.com で確認」と書くだけにする。
- gitリモートURLに PAT（`ghp_...`）を埋め込まない。`gh auth login` を使う。

### APIキーの差し替え（無停止手順・順番厳守）
ツールは `new Anthropic()` で `process.env.ANTHROPIC_API_KEY` を読む。Revokeを先にやると即停止する。
1. console.anthropic.com で**新キーを発行**（まだ旧キーをRevokeしない）。
2. `bash set-api-key.sh <新キー>` → キーを検証してから `.env.local` に書き込む（不正なら無変更）。
3. `npm run dev` を再起動して動作確認。
4. 確認できたら**最後に**旧キーをRevoke。

### フォルダ・git運用
- PC間共有は **GitHubのpull/push** が正道。**iCloudで `.git` を同期しない**（競合コピーで壊れる）。
- 作業フォルダの中で再 `git clone` しない（履歴の異なる重複リポジトリができる）。1台＝1作業フォルダ。
- 「最新か」はファイル同期でなく `git merge-base --is-ancestor HEAD origin/main` 等のgit履歴で判定する。
