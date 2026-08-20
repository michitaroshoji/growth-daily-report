-- ============================================================
-- Growth Daily Report / バージョンアップ共有（release_notes）(フェーズ13)
--
--   ヘッダーの「バージョンアップ共有」モーダルに出す更新履歴。
--
--   Read   … ログイン済みなら全員（admin / member / restricted）
--   Insert / Update / Delete … 管理者のみ
--
-- ※ 管理者判定は public.is_admin() を使います
--    （schema_v11_departments.sql で users.role 基準に置き換わったもの）。
--
-- 何度実行しても安全です。SQL Editor に貼り付けて Run してください。
-- ============================================================

-- ------------------------------------------------------------
-- 1. テーブル
--    1件＝1回のバージョンアップ告知。新しい順に並べて出す
-- ------------------------------------------------------------
create table if not exists public.release_notes (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,                          -- 例: v1.1.0 部署管理機能の追加
  content     text not null default '',               -- 変更点の詳細（Markdown）
  created_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- 一覧は created_at の降順しか引かないので、そこだけ張る
create index if not exists release_notes_created_at_idx
  on public.release_notes (created_at desc);

-- ------------------------------------------------------------
-- 2. RLS
-- ------------------------------------------------------------
alter table public.release_notes enable row level security;

-- 既存ポリシーは名前を決め打ちせずに落とす
do $$
declare
  pol record;
begin
  for pol in
    select policyname
      from pg_policies
     where schemaname = 'public'
       and tablename  = 'release_notes'
  loop
    execute format('drop policy if exists %I on public.release_notes', pol.policyname);
  end loop;
end;
$$;

-- 閲覧：ログイン済みなら全員
create policy "release_notes_select" on public.release_notes
  for select to authenticated
  using (true);

-- 作成：管理者のみ。名義のすり替えを防ぐため created_by は自分に固定する
create policy "release_notes_insert" on public.release_notes
  for insert to authenticated
  with check (public.is_admin() and created_by = auth.uid());

-- 更新：管理者のみ
create policy "release_notes_update" on public.release_notes
  for update to authenticated
  using      (public.is_admin())
  with check (public.is_admin());

-- 削除：管理者のみ
create policy "release_notes_delete" on public.release_notes
  for delete to authenticated
  using (public.is_admin());

-- 未ログインからはテーブル権限そのものを剥がす
revoke all on public.release_notes from anon;

-- ------------------------------------------------------------
-- 3. 確認
-- ------------------------------------------------------------
select policyname, cmd, roles from pg_policies
 where schemaname = 'public' and tablename = 'release_notes'
 order by cmd;
