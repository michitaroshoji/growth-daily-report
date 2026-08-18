-- ============================================================
-- Growth Daily Report / マイ・ナレッジ（メモ）(フェーズ10)
--
--   データ分析 / ナレッジ 画面の下部にある、1ユーザー1枚のメモ帳。
--   日報とは無関係の個人メモなので、本人以外は管理者でも読めないようにする。
--
-- 何度実行しても安全です。SQL Editor に貼り付けて Run してください。
-- ============================================================

-- ------------------------------------------------------------
-- 1. テーブル
--    user_id を主キーにして「1人1行」を構造で保証する。
--    保存は upsert なので、行が無ければ作られる。
-- ------------------------------------------------------------
create table if not exists public.knowledge_memos (
  user_id    uuid primary key references public.users(id) on delete cascade,
  body       text not null default '',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 2. RLS
--    自分の行だけ。ここは管理者にも開けない（個人のメモ帳のため、
--    daily_reports のように is_admin() を通さない）
-- ------------------------------------------------------------
alter table public.knowledge_memos enable row level security;

do $$
declare
  pol record;
begin
  for pol in
    select policyname
      from pg_policies
     where schemaname = 'public'
       and tablename  = 'knowledge_memos'
  loop
    execute format('drop policy if exists %I on public.knowledge_memos', pol.policyname);
  end loop;
end;
$$;

create policy "knowledge_memos_own" on public.knowledge_memos
  for all to authenticated
  using      (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 未ログインからはテーブル権限そのものを剥がす
revoke all on public.knowledge_memos from anon;

-- ------------------------------------------------------------
-- 3. 確認
-- ------------------------------------------------------------
select policyname, cmd, roles from pg_policies
 where schemaname = 'public' and tablename = 'knowledge_memos';
