# セットアップ手順（家庭ごと）

このアプリは家庭ごとに自分のFirebaseプロジェクト（無料）を使います。他の家庭でも使いたい場合は、このリポジトリを複製し、以下の手順で自分専用のデータベースを用意してください。

## 1. Firebaseプロジェクトを作る

1. https://console.firebase.google.com/ を開き、Googleアカウントでログイン
2. 「プロジェクトを追加」→ 好きな名前を入力 → Google Analyticsは無効でOK → 作成
3. 左メニュー「構築」→「Firestore Database」→「データベースの作成」→ ロケーションは `asia-northeast1` (東京) → 本番モードで開始
4. 左メニュー「構築」→「Authentication」→「Sign-in method」タブ →「匿名」を有効化
5. 歯車アイコン→「プロジェクトの設定」→「マイアプリ」→ `</>`（ウェブ）アイコン → ニックネームを入力（Hostingのチェックは不要）→ アプリを登録
6. 表示される `firebaseConfig = {...}` をコピー

## 2. セキュリティルールを設定する

Firestore Database →「ルール」タブで以下に置き換えて公開する。

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

## 3. アプリに設定を反映する

`js/firebase-config.js` の中身を、手順1でコピーした自分の値に書き換える（このリポジトリに入っている値は元の家庭のFirebaseプロジェクトのものなので、必ず自分の値に置き換えること。参考用のひな形は `js/firebase-config.example.js`）。

## 4. 公開する

静的ファイルなのでビルド不要。以下のいずれかで公開できる。

- **Netlify Drop**: https://app.netlify.com/drop にこのフォルダをドラッグ＆ドロップ
- **GitHub Pages**: このリポジトリをGitHubにpushし、リポジトリの Settings > Pages で公開
