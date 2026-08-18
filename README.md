# Growth Daily Report（MVP フェーズ1）

日報を通じて「内省（リフレクション）と個人の成長」を促進する社内Webアプリ。

## 画面構成

| ファイル | 画面 | 内容 |
| --- | --- | --- |
| `src/index.html` | 簡易ログイン | ユーザーをプルダウンで選んでログイン |
| `src/report.html` | 日報作成 | 前回の宣言の振り返り + 本日分6項目 |
| `src/list.html` | 過去日報一覧 | 新しい順にカード表示（自分のみ／全員 切替） |

## セットアップ手順

### 1. Supabase プロジェクトを作る

1. https://supabase.com にログインし、New project を作成
2. 左メニュー **SQL Editor** を開く
3. `supabase/schema.sql` の中身を全部コピーして貼り付け、**Run**

### 2. .env に接続情報を書く

Supabase の **Project Settings > API** から2つの値をコピーし、`.env` に貼り付ける。

```
SUPABASE_URL=https://xxxxxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOi...
```

※ `.env` を編集したら開発サーバーを再起動すること（Parcel はビルド時に値を埋め込むため）。

### 3. 起動

```bash
npm install     # 初回のみ
npm run dev     # http://localhost:1234 が開発サーバー
```

うまく動かないときは `npm run clean` でキャッシュを消してから `npm run dev`。

## 本番用ビルド

```bash
npm run build   # dist/ に出力
```

## 注意（MVP時点の割り切り）

- 本格的な認証はなく、ユーザー選択のみ（`localStorage` に保持）。
- RLS は anon キーで全許可の設定。**社外に公開する用途では使わないこと。**
