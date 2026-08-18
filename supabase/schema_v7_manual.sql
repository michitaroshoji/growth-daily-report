-- ============================================================
-- Growth Daily Report / 「アプリの使い方」マニュアル (フェーズ7)
--
--   Read   … ログイン済みなら全員
--   Insert / Update / Delete … 管理者のみ
--
-- ※ 管理者判定は schema_v6_admin.sql で作った public.is_admin() を使います。
--    先に v6 を実行しておいてください。
--
-- 何度実行しても安全です。SQL Editor に貼り付けて Run してください。
-- ============================================================

-- ------------------------------------------------------------
-- 1. テーブル
--    slug で引く。今は 'how-to-use' の1行だけだが、
--    「よくある質問」などを足せるようにキーを持たせておく
-- ------------------------------------------------------------
create table if not exists public.manuals (
  slug        text primary key,
  title       text not null,
  body        text not null default '',   -- Markdown
  updated_by  uuid references public.users(id) on delete set null,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 2. 初期コンテンツ
--    すでに中身がある場合は上書きしない
-- ------------------------------------------------------------
insert into public.manuals (slug, title, body)
values (
  'how-to-use',
  'アプリの使い方',
  '# このアプリについて

日報を「報告」ではなく **内省（リフレクション）** の道具にするためのアプリです。
書くこと自体が目的ではなく、前回の宣言を振り返り、次の一歩を決めることが目的です。

## 1日の流れ

1. **0. 前回の振り返り** … 前回宣言したタスクを1つずつ評価します
2. **1. 業務実績** … 今日やったことを事実ベースで書きます
3. **2〜6** … 課題・要因分析・次回の宣言・準備・学びを書きます
4. **7. 一言** … 自由なコメントをどうぞ

## 書き方のコツ

- 宣言は **1行に1タスク** で書きます
- `Shift + Enter` で1段下げると子タスクになります
- 子を持つ行は「見出し」として扱われ、次回は **末端のタスクだけ** に評価ボタンが出ます
- 未達成・一部達成を選ぶと、その項目が「3. 要因分析」に自動で転記されます

## 数値の見方

- **引き継ぎタスク達成** … 前回の宣言のうち、どれだけ達成できたか（一部達成は0.5として計算）
- **今日のタスク総件数** … 業務実績に書いた末端項目の数
- データ分析タブで、これらの推移をグラフで確認できます

> 迷ったら、まず事実から書いてみてください。'
)
on conflict (slug) do nothing;

-- ------------------------------------------------------------
-- 3. RLS
-- ------------------------------------------------------------
alter table public.manuals enable row level security;

-- 既存ポリシーは名前を決め打ちせずに落とす
do $$
declare
  pol record;
begin
  for pol in
    select policyname
      from pg_policies
     where schemaname = 'public'
       and tablename  = 'manuals'
  loop
    execute format('drop policy if exists %I on public.manuals', pol.policyname);
  end loop;
end;
$$;

-- 閲覧：ログイン済みなら全員
create policy "manuals_select" on public.manuals
  for select to authenticated
  using (true);

-- 作成：管理者のみ
create policy "manuals_insert" on public.manuals
  for insert to authenticated
  with check (public.is_admin());

-- 更新：管理者のみ
create policy "manuals_update" on public.manuals
  for update to authenticated
  using      (public.is_admin())
  with check (public.is_admin());

-- 削除：管理者のみ
create policy "manuals_delete" on public.manuals
  for delete to authenticated
  using (public.is_admin());

-- 未ログインからはテーブル権限そのものを剥がす
revoke all on public.manuals from anon;

-- ------------------------------------------------------------
-- 4. 確認
-- ------------------------------------------------------------
select policyname, cmd, roles from pg_policies
 where schemaname = 'public' and tablename = 'manuals'
 order by cmd;
