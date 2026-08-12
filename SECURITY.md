# Security Policy

## Supported version

原則として`main`ブランチの最新版を対象にセキュリティ修正を行います。

## Reporting a vulnerability

脆弱性、認証回避、データベースルールの問題、秘密情報の露出を見つけた場合は、公開Issueへ詳細を書かないでください。GitHubリポジトリのSecurityタブにあるPrivate vulnerability reportingを使用してください。

Private vulnerability reportingが利用できない場合は、再現手順や攻撃コードを公開せず、リポジトリ所有者へ非公開で連絡してください。

## Secrets

このリポジトリにFirebaseプロジェクトID、運営中サイトURL、Firebaseアプリ設定、サービスアカウント、デプロイトークンを含めない方針です。誤って秘密情報をコミットした場合は、履歴から消すだけでなく、該当する資格情報を直ちに失効・再発行してください。

Firebase Web APIキーは秘密鍵ではありませんが、API制限、Realtime Database Rules、App Checkを適切に設定してください。
