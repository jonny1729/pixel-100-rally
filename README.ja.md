# PIXEL 100 RALLY

[English](README.md) | **日本語**

1〜8人で遊べる、Firebaseベースのオープンソース・リアルタイム100マス計算レースです。入力・正解判定・マス移動・タイマーは各ブラウザで処理し、Firebaseには参加状態、正解済み問題数、ゴール状態、最終タイムだけを同期します。

このリポジトリには運営中サイトのURL、FirebaseプロジェクトID、Firebaseアプリ設定、デプロイ資格情報は含まれません。自分のFirebaseプロジェクトまたはローカルEmulator Suiteで動かしてください。

## MVPの内容

- 匿名認証とプレイヤー名
- 公開ルーム一覧、任意の合言葉、1〜8人のルーム作成
- 1人用タイムアタックと複数人READY対戦
- 難易度別の掛け算100マス
- カウントダウン・正解・不正解・ゴールの効果音
- スマホ走行中の選択セル中央表示と、現在の行・列の固定ガイド
- 試合中の退出（走行中はDNF）
- 終了したルームは誰でも即時削除でき、残っていても約5分後に削除
- 対戦開始から2時間を超えた進行中・結果待ちルームは自動削除（Spark版では接続中または次回アクセス時のクライアントが削除）
- PCキーボード、画面テンキー、Clear、Backspace、PASS
- 正解数だけで動くドットレース表示（数値スコア・暫定順位は非表示）
- 3・2・1・GO、スマホ盤面ズーム、終盤表示、ライブリザルト
- 30秒の再接続猶予、DNF、ホスト自動移譲

## 技術構成

- React 19 / TypeScript / Vite
- Firebase Anonymous Authentication
- Firebase Realtime Database
- Firebase Hosting
- Vitest / Testing Library

入力、正解判定、マス移動、タイマーはクライアント内で完結します。Realtime Databaseへ同期するのは、参加状態、正解済み問題数、終了状態、最終タイムなど対戦に必要な最小限の状態です。

## ローカル起動

Node.js 22とJava 21を用意してください。現在のFirebase Emulator SuiteではJava 8は使用しません。Firebase CLIはプロジェクト内にインストールされるため、グローバルインストールは不要です。

```powershell
Copy-Item .env.example .env.local
npm install
npm run emulators
```

`npm run emulators`はJava 21を自動検出し、Auth・Realtime Database・Hostingを起動します。

別のターミナルでフロントエンドを起動します。

```powershell
npm run dev
```

- Webアプリ: http://127.0.0.1:5173
- Emulator UI: http://127.0.0.1:4000

複数人動作は、通常ウィンドウとプライベートウィンドウなど、匿名認証セッションが異なるブラウザコンテキストで確認できます。

## 検証

```powershell
npm test
npm run build
```

Firebase込みのSpark版スモークテストは、`npm run emulators`を起動した状態で別のPowerShellから実行します。

```powershell
node scripts/emulator-spark-smoke.mjs
```

## 本番デプロイ

無料Sparkプラン向けに、Cloud Functionsを使わずAnonymous Authentication、Realtime Database、Hostingで動作します。運営者固有のFirebase情報をコードに入れないため、先に自分のプロジェクト設定を`.env.local`と`.firebaserc`へ設定してください。

```powershell
npm run deploy:spark
```

- 詳細手順: [DEPLOY.md](DEPLOY.md)

合言葉はSHA-256の照合値として読み取り禁止の`roomSecrets`へ保存します。入力・判定・タイマーはブラウザ内、参加状態と正解数だけをRealtime Databaseへ同期します。

## コントリビューション

バグ報告、改善提案、翻訳、アクセシビリティ改善、ゲームモード追加を歓迎します。作業前に[CONTRIBUTING.md](CONTRIBUTING.md)と[SECURITY.md](SECURITY.md)を確認してください。

## ライセンス

[MIT License](LICENSE)で公開しています。利用、改変、再配布、商用利用が可能です。著作権表示とライセンス文を残してください。
