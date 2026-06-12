# ads-drill-tool — 本気AIドリル

## ⚡ 現在の状態（handoff.sh が自動更新）
<!-- STATE_START -->
- ブランチ: main / コミット: 284cf25 / 状態: ✅ クリーン
- 最終作業: fix: 単語帳の質問ボタンを吹き出しアイコンに変更
- 次候補: ★2026-06-13: 単語帳の用語名修正機能＋保存消失対策✅ (1)用語カードに鉛筆ボタン追加→インライン編集でリネーム（glossaryTermRenamesに保存・definitionのキーも引継ぎ）。API(アピアイ)→API(エーピーアイ)は修正適用済み。(2)保存消失の原因は複数タブの全置換保存の後勝ち→/api/study-logのPOSTでglossaryOverrides/ManualTerms/TermRenamesを既存データと和集合マージするよう修正＋アトミック書き込み化。古いタブの保存をシミュレートして編集が残ることを確認済み。注意: マージは和集合なので単語帳編集の「削除」は永続しない（削除UIは現状なし）。 ★2026-06-13: 自動取込の既存スクショ防止ガード追加✅（watch-screenshots/route.tsに監視開始時刻より古いファイルを無視するmtimeチェックを追加。chokidarのignoreInitial:trueと二重ガード）。訂正: 前メモの「既存スクショも拾う」は誤りだった。6/13朝に取り込まれたWebの世界一周ツアーQ1・Q2はbirthtime=06:38-40の新規撮影分で、デスクトップの6/10の古いスクショは取り込まれていない＝元々正常動作。なおQ1は2セッション並行監視（ユーザーの:3000とプレビューの:51014）で二重解析され、誤パース名のWeb_の世界一周ツアー_Q1_Q1_*.pngが取込済みフォルダに残っている（Q1の問題・解答スクショの実体はこの誤パース名の方）。 ★2026-06-13: 「次の問題へ」改良 完了✅（押すとドリルパネルが自動で開き自動取込もONになる。DrillTool.tsxのhandleNextQuestionに2行追加）。パネルだけ開いて自動取込はONにしたくない場合はsetIsAutoEnabled(true)の1行を削る。 ★2026-06-13: B.単語帳の改良 完了✅（コース別フィルタ＝チップ式・検索ボックス＝ひらがな/カタカナ同一視・暗記モード＝意味を隠してクリックでめくる）。実装はTeacherPane.tsxのGlossaryView/GlossaryCardとlib/glossary.tsのnormalizeForSearch。プレビューで62語・Gitコース29語絞り込み・ひらがな検索・めくり動作を確認済み。型チェックOK。 ★前提（変わらず）: 公開URL https://ads-drill-tool.vercel.app はVercel Productionブランチ=school-deploy-experimentで凍結稼働中。mainへのpushは公開URLに影響しない。ローカル=ファイル保存（.env.localのDATABASE_URLコメントアウト中、#を外せばDB復帰）。DBデータは~/Desktop/AIドリル取込済み/studyLog.jsonに書き出し済み。 ⚠️ 注意（未対応）: 公開URLは認証なしで誰でもアクセス可能＝先生ペインのAI解説を他人が使うとANTHROPIC_API_KEYの課金が発生しうる。対策候補: Vercel Deployment Protection / 簡易パスワード / D.リポジトリprivate化とあわせて検討 残りの候補: A. 先生ペインの図解化（Mermaid等・新エージェント追加） C. ストリーミング対応（解説を逐次表示） D. リポジトリのprivate化 
<!-- STATE_END -->

## ⚠️ セッションのルール
- **作業フォルダ**: `~/Desktop/ads-drill-tool/`（2026-06-10にフォルダを一本化。入れ子・重複repoは解消済み）
- **正本はGitHub**: `github.com/masanariwatanabe0417-ui/ads-drill-tool`。迷ったらGitHubが正。
- **終了時**: コミット・プッシュ後に `bash handoff.sh` を実行すると上記が自動更新される
- ~~旧: 親フォルダ/入れ子の二重構造~~ → 解消済み。旧フォルダは `~/Desktop/_ads-drill-tool_OLD` に退避（確認後削除可）

## 概要
問題・解答のスクリーンショットを貼り付けると Claude AI が解説を生成。コース/レッスン/問題の階層で管理。

## スタック
- Next.js 14 (App Router) + TypeScript
- Tailwind CSS + shadcn/ui
- Anthropic SDK — haiku（高速）/ opus（高品質解説）

## 4ペイン構成
```
NavigationPane (w-60) | ScreenshotPane (w-72) | TeacherPane (flex-1) | QuestionPane (w-80)
```
- NavigationPane: コース/レッスン/問題ツリー
- ScreenshotPane: スクショ貼り付け
- TeacherPane: AI解説・単語帳表示
- QuestionPane: Q&Aチャット・単語帳編集

## 主要ファイル
| ファイル | 役割 |
|----------|------|
| `components/DrillTool.tsx` | 全状態管理 |
| `components/panes/TeacherPane.tsx` | 先生ペイン・単語帳UI |
| `components/panes/QuestionPane.tsx` | 質問ペイン |
| `lib/glossary.ts` | 単語帳ビルド・ソート・重複統合 |
| `app/api/teacher/route.ts` | 解説生成（3エージェント並列） |
| `app/api/question/route.ts` | Q&A・単語帳定義改善 |
| `app/api/glossary-consolidate/route.ts` | 複数定義をAIで統合 |

## 開発コマンド
```bash
npm run dev   # http://localhost:3000
```

## ⚠️ 鉄則
- APIキーは `.env.local` のみ。コード・コミット・mdに絶対書かない（過去に漏洩あり）
- PC間共有は GitHub push/pull。iCloud で .git を同期しない
