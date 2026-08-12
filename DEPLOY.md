# 自分のFirebase Sparkプロジェクトへデプロイ

本番環境はCloud Functionsを使わず、Firebase Hosting、Anonymous Authentication、Realtime Databaseだけで動作します。

## 1. Firebaseプロジェクトを準備

- Firebase Consoleでプロジェクトを作成します。
- AuthenticationでAnonymousプロバイダーを有効化します。
- Realtime Databaseを作成します。利用者に近いリージョンを選んでください。
- Hostingを有効化します。
- 無料運用する場合はSparkプランのままにします。

## 2. ローカル環境変数を作成

`.env.example`を`.env.local`へコピーし、Firebase Consoleの「プロジェクトの設定 > マイアプリ」で表示されるWebアプリ設定を入力します。

```powershell
Copy-Item .env.example .env.local
```

本番接続時は`VITE_USE_FIREBASE_EMULATORS=false`へ変更してください。`.env.local`はGit管理対象外です。

## 3. Firebase CLIでプロジェクトを選択

Firebase CLIへログイン済みのPowerShellで実行します。

```powershell
npm install
npx firebase login
npx firebase use --add
```

選択結果は`.firebaserc`へ保存されます。このファイルもGit管理対象外です。

## 4. デプロイ

```powershell
npm run deploy:spark
```

`deploy:spark`は本番ビルド後、Realtime Database RulesとHostingを選択中のFirebaseプロジェクトへデプロイします。Anonymous Authenticationの有効化はFirebase Consoleで行います。Cloud Functionsは使用しません。

## ローカルエミュレーター

`.env.local`の`VITE_USE_FIREBASE_EMULATORS`を`true`へ変更してから実行します。

```powershell
npm run emulators
```

別のPowerShellで次を実行します。

```powershell
npm run dev
```

## 無料枠の主な上限

- Hosting: 保存10 GB、転送360 MB/日
- Realtime Database: 保存1 GB、ダウンロード10 GB/月、同時接続100
- Anonymous Authentication: 無料枠内で利用

終了ルームには終了時刻を保存し、誰でも即時削除できます。削除されずに残った場合も約5分後にクライアントがRealtime Databaseから削除します。また、対戦開始から2時間を超えた進行中・結果待ちルームも削除対象です。Sparkプランではサーバー側の定期処理を使わないため、誰も接続していない場合は次にルーム一覧が開かれた時点で削除されます。

上限到達時は該当サービスが停止し、自動で従量課金へ移行することはありません。課金アカウントをリンクしない限りSparkプランのままです。

## 公開リポジトリでの注意

- `.env.local`、`.firebaserc`、サービスアカウントJSON、CIのデプロイトークンをコミットしないでください。
- Firebase Web APIキーはクライアント識別子ですが、Realtime Database RulesとApp Checkが実際の防御になります。
- 外部Pull RequestではFirebase資格情報を使うデプロイ処理を実行しないでください。
- 本番デプロイは信頼できるブランチから、内容をレビューした後に行ってください。
