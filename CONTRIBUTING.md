# Contributing to PIXEL 100 RALLY

コントリビューションを歓迎します。小さな修正でもIssueまたはPull Requestを送ってください。

## 開発の始め方

```powershell
Copy-Item .env.example .env.local
npm install
npm run emulators
```

別のターミナルで次を実行します。

```powershell
npm run dev
```

ローカル開発ではFirebase Emulator Suiteを使います。運営中のFirebaseプロジェクトへ接続する設定や資格情報をコミットしないでください。

## Pull Request

1. Issueがあれば紐づけます。
2. 変更の目的を一つに絞ります。
3. 必要なテストを追加または更新します。
4. `npm test`と`npm run build`を実行します。
5. UI変更ではPCとスマートフォンの両方を確認します。
6. 変更内容、確認方法、スクリーンショットをPull Requestへ記載します。

## 守ってほしいこと

- `.env.local`、`.firebaserc`、Firebaseトークン、サービスアカウントJSON、個人情報をコミットしないでください。
- 外部URL、画像、音声、フォントを追加する場合は、再配布可能なライセンスを明記してください。
- Realtime Database Rulesの変更には、権限が広がらないことを確認できるテストを付けてください。
- Pull Requestのコードから本番Firebaseへデプロイしないでください。
- 参加者を尊重し、建設的なコミュニケーションをお願いします。

Pull Requestを送ることで、提出した変更をこのプロジェクトのMIT Licenseで提供することに同意したものとします。
