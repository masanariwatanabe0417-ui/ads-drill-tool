# ads-drill-tool — 本気AIドリル

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
