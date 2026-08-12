# GitHub公開時の管理者設定

このファイルの操作は、リポジトリをGitHubへ作成した後にWeb画面から行います。

## 推奨する初期設定

1. リポジトリをPublicで作成し、説明文とトピックを設定します。
2. `main`を既定ブランチにします。
3. Settings > Rules > Rulesetsで`main`を保護します。
   - Pull Requestを必須にする
   - 承認を1件以上必須にする
   - CIの`test-and-build`成功を必須にする
   - 未解決のレビュー会話を残したままマージできないようにする
   - force pushとブランチ削除を禁止する
4. Settings > SecurityでPrivate vulnerability reportingを有効にします。
5. ActionsのWorkflow permissionsは`Read repository contents`を基本にします。

## 本番環境との分離

- GitHub Actionsには本番Firebaseの資格情報を登録していません。
- 外部Pull Requestではテストとビルドだけを行い、デプロイしません。
- 本番デプロイは、レビュー済みの`main`をローカルへ取得した管理者が手動で行います。
- `.env.local`と`.firebaserc`はローカル専用で、Git管理対象外です。

将来自動デプロイを追加する場合は、外部Pull Requestから秘密情報へアクセスできないイベント設計にし、専用の最小権限アカウントを使用してください。
