-- ============================================================
-- Growth Daily Report / RLS と管理者権限 (フェーズ6)
--
--   対象: public.daily_reports（＋整合のため子テーブルの判定関数も更新）
--
-- 【権限要件】
--   未ログイン(anon) … 一切禁止
--   一般ユーザー      … 閲覧は全員分／作成・更新・削除は自分の分のみ
--   管理者            … すべてのデータにCRUD可
--
-- 何度実行しても安全です。SQL Editor に貼り付けて Run してください。
-- ============================================================


-- ------------------------------------------------------------
-- 1. 管理者判定
--    フロント側 src/permissions.js の ADMIN_EMAILS と必ず同じ値にすること
-- ------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select coalesce(
    lower(auth.jwt() ->> 'email') = 'michitaro.shoji@teetime.co.jp',
    false
  );
$$;


-- ------------------------------------------------------------
-- 2. daily_reports の既存ポリシーを全て削除
--    名前を決め打ちせず、今ついているものを列挙して落とす
-- ------------------------------------------------------------
do $$
declare
  pol record;
begin
  for pol in
    select policyname
      from pg_policies
     where schemaname = 'public'
       and tablename  = 'daily_reports'
  loop
    execute format('drop policy if exists %I on public.daily_reports', pol.policyname);
  end loop;
end;
$$;


-- ------------------------------------------------------------
-- 3. daily_reports のポリシー
--    すべて to authenticated なので、未ログイン(anon)は自動的に全て拒否される
-- ------------------------------------------------------------
alter table public.daily_reports enable row level security;

-- 閲覧：ログイン済みなら全員分（管理者も同じくtrueなので条件は不要）
create policy "daily_reports_select" on public.daily_reports
  for select to authenticated
  using (true);

-- 作成：自分名義のみ。管理者は誰の名義でも作れる
create policy "daily_reports_insert" on public.daily_reports
  for insert to authenticated
  with check (user_id = auth.uid() or public.is_admin());

-- 更新：自分の分のみ。with check も付けて、他人へ付け替える操作も防ぐ
create policy "daily_reports_update" on public.daily_reports
  for update to authenticated
  using      (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

-- 削除：自分の分のみ。管理者は制限なし
create policy "daily_reports_delete" on public.daily_reports
  for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- 念のため、匿名ロールからはテーブル権限そのものを剥がしておく
-- （RLSだけでも拒否されるが、二重に塞ぐ）
revoke all on public.daily_reports from anon;


-- ------------------------------------------------------------
-- 4. 子テーブルの持ち主判定に管理者を追加
--
--    daily_metrics / commitment_reviews は owns_report() で判定している。
--    ここを直さないと、管理者が他人の日報を「更新」したときに
--    子テーブルの入れ替えだけ失敗して保存が中途半端になる。
-- ------------------------------------------------------------
create or replace function public.owns_report(target_report_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin() or exists (
    select 1
      from public.daily_reports r
     where r.id = target_report_id
       and r.user_id = auth.uid()
  );
$$;


-- ------------------------------------------------------------
-- 5. 確認：設定されたポリシー一覧（Runすると結果が表示されます）
-- ------------------------------------------------------------
select policyname, cmd, roles, qual, with_check
  from pg_policies
 where schemaname = 'public'
   and tablename  = 'daily_reports'
 order by cmd, policyname;
