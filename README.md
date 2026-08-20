# Growth Daily Report（MVP フェーズ1）

日報を通じて「内省（リフレクション）と個人の成長」を促進する社内Webアプリ。

## 画面構成

| ファイル | 画面 | 内容 |
| --- | --- | --- |
| `src/index.html` | ログイン | Googleログイン、またはメールアドレス＋パスワードでログイン |
| `src/report.html` | 日報作成 | 前回の宣言の振り返り + 本日分6項目 |
| `src/list.html` | 過去日報一覧 | 新しい順にカード表示（対象集団＝部署 → 対象ユーザー の2段階で絞り込み） |
| `src/admin.html` | 管理者画面 (`/admin`) | ユーザー管理（部署・権限・凍結・削除）と部署管理。管理者のみ。入口はプロフィール / 設定モーダルの「管理画面へ」 |

## セットアップ手順

### 1. Supabase プロジェクトを作る

1. https://supabase.com にログインし、New project を作成
2. 左メニュー **SQL Editor** を開く
3. `supabase/` の .sql を**次の順番で**貼り付けて **Run**（1ファイルずつ、上から順に）

   | 順 | ファイル | 内容 |
   | --- | --- | --- |
   | 1 | `schema.sql` | users / daily_reports とインデックス |
   | 2 | `schema_v2.sql` | PMV評価・カスタム数値評価・宣言の行ごと評価 |
   | 3 | `schema_v3.sql` | report_date の整備 |
   | 4 | `schema_v4.sql` | 7.一言 と自動算出タスク実績の列 |
   | 5 | `schema_v5_auth.sql` | **Supabase Auth 対応。全許可ポリシーを撤去して本番向けRLSに置き換える** |
   | 6 | `schema_v6_admin.sql` | 管理者判定 `is_admin()` と daily_reports のポリシー |
   | 7 | `schema_v7_manual.sql` | 「アプリの使い方」マニュアル（manuals） |
   | 8 | `schema_v8_demo_write.sql` | 管理者が他ユーザー名義の数値項目を扱えるようにする |
   | 9 | `schema_v9_cancelled.sql` | タスク評価に「中止」を追加 |
   | 10 | `schema_v10_knowledge.sql` | マイ・ナレッジ（knowledge_memos） |
   | 11 | `schema_v11_departments.sql` | **部署（departments）と権限3階層。管理者判定を `users.role` に移す** |
   | 12 | `schema_v12_restricted_demo.sql` | 制限付きユーザーでもデモ用アカウント「デモ太郎」の日報だけは読めるようにする |

   `schema.sql` だけでは認証まわりのポリシーが入りません（`schema.sql` と `schema_v2.sql` の
   RLSは anon 全許可のままです）。**必ず `schema_v5_auth.sql` 以降まで流してください。**
   各ファイルは**上から順に1回ずつ流す前提**です。`schema_v5_auth.sql` 以降を適用済みのDBに
   `schema.sql` / `schema_v2.sql` を流し直すと、`mvp_users_all` などの anon 全許可ポリシーが
   復活して `public.users` が匿名キーから読み書きできる状態に戻ります
   （`revoke all ... from anon` があるのは daily_reports / user_metrics_settings / manuals /
   knowledge_memos の4テーブルだけで、`public.users` にはありません）。
   さらに `schema.sql` 末尾の `on conflict (name) do nothing` は、`schema_v5_auth.sql` が
   `users_name_key` の一意制約を外しているためエラー（42P10）になります。
   流し直しが必要なときは `schema_v5_auth.sql` 以降を再度流してください。

   ※ `supabase/migrate_user_a.sql` はセットアップ用ではありません。旧「ユーザーA」名義の
   既存データを自分のアカウントへ移したいときだけ、中身を読んだうえで実行してください。

### 2. ログイン方法を有効にする

Supabase ダッシュボードの **Authentication** で、使うログイン方法を設定する。

- **Google ログイン** … Providers で Google を有効化し、URL Configuration の
  **Redirect URLs** にアプリの `report.html` の URL を登録する
  （認証後の戻り先。開発なら `http://localhost:1234/report.html`）
- **メール＋パスワード** … Email プロバイダを有効化し、ダッシュボードの Users から
  アカウントを作る（アプリ側に新規登録画面はありません）

### 3. .env に接続情報を書く

Supabase の **Project Settings > API** から2つの値をコピーし、`.env` に貼り付ける。

```
SUPABASE_URL=https://xxxxxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOi...
```

※ `.env` を編集したら開発サーバーを再起動すること（Parcel はビルド時に値を埋め込むため）。

### 4. 起動

```bash
npm install     # 初回のみ
npm run dev     # http://localhost:1234 が開発サーバー
```

うまく動かないときは `npm run clean` でキャッシュを消してから `npm run dev`。

## 本番用ビルド

```bash
npm run build   # dist/ に出力
```

公開先: https://growth-daily-report.vercel.app

## 認証と権限

- 認証は **Supabase Auth** を使う（`src/login.js`）。社内は Google ログイン、
  社外向けデモはメールアドレス＋パスワード。ログイン状態の判定は `src/session.js`。
- **未ログイン（anon）では日報を読むことも書くこともできません。**
  `schema_v5_auth.sql` で全許可ポリシーを削除し、以降のポリシーはすべて `to authenticated`。
  主要なテーブルは anon からテーブル権限自体も剥がしてある（`revoke all ... from anon`）。
- ログイン済みユーザーの権限
  - 日報の**閲覧**は全員分
  - **作成・更新・削除**は自分の日報のみ
  - 数値評価の設定・マイ・ナレッジ（メモ）は自分のものだけ
- 管理者は全員の日報を編集・削除でき、マニュアルも更新できる。

### 権限3階層（`public.users.role`）

`schema_v11_departments.sql` 以降、権限は**メールアドレスの決め打ちではなく `users.role`** で決まる。
値を変えるのは管理者画面（`/admin`）のユーザー管理タブ。

| role | できること |
| --- | --- |
| `admin` | 全データのCRUD、マニュアル更新、`/admin`（管理者画面） |
| `member` | 既定値。閲覧は全員分／作成・更新・削除は自分の分のみ |
| `restricted` | 閲覧も**自分の日報だけ**（デモ用アカウントは例外）。書き込みは `member` と同じ |

- `src/permissions.js` の `ADMIN_EMAILS` は、role の付け替えを間違えて管理者が
  1人も居なくなったときの逃げ道として残してある。DB側の `public.is_admin()`
  （`schema_v11_departments.sql`）と**同じ値**にしておくこと。
- `is_frozen = true`（凍結）のアカウントはログインできず、DB側でも書き込みが全て弾かれる。
- 所属部署は本人がヘッダー右上のユーザー名 →「プロフィール / 設定」から変更できる。
  部署そのものの追加・改名・削除は管理者画面の部署管理タブから行う。
- 管理者画面への入口は、同じモーダルの中の「⚙ 管理画面へ」だけ。
  ナビゲーションバーには並べない（管理者以外に存在を見せないため）。
- `restricted` は過去の日報の絞り込み（対象集団・対象ユーザー）が自分に固定され、
  非活性になる。取得クエリ側でも他人のIDは指定しない。
  デモモードだけは例外で、`schema_v12_restricted_demo.sql` を適用すると
  「デモ太郎」の日報が読める（未適用だとデモ画面が空になる）。
- 管理者画面でユーザー名を押すと `report.html?view=<ユーザーID>` が開く。
  これは**管理者閲覧モード（読み取り専用）**で、日報入力欄・メモ・設定は表示しない。
