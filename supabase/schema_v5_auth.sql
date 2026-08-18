-- ============================================================
-- Growth Daily Report / Googleログイン対応 (フェーズ5)
--
--   1. public.users を「auth.users のプロフィール表」として使う
--   2. MVP用の全許可ポリシーを撤去し、本番向けRLSに置き換える
--
-- ポリシーの方針:
--   ・閲覧  … ログイン済み(authenticated)なら全員の日報を読める
--   ・作成/更新/削除 … 自分のデータのみ
--   ・匿名(anon) からは一切読み書きできない
--
-- 何度実行しても安全です。SQL Editor に貼り付けて Run してください。
-- ※このSQLを実行すると、匿名キーでの書き込みは全て弾かれるようになります。
-- ============================================================


-- ============================================================
-- 1. public.users を auth.users と対応づける
-- ============================================================

-- Googleの表示名は重複しうるので、name の一意制約を外す
alter table public.users drop constraint if exists users_name_key;

alter table public.users add column if not exists email text;

-- Googleでサインインした瞬間に、プロフィール行を自動で作る。
-- これが無いと daily_reports.user_id の外部キー制約でINSERTが失敗する。
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer            -- RLSを迂回して users に書き込む必要がある
set search_path = public
as $$
begin
  insert into public.users (id, name, email)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(new.email, '@', 1)
    ),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- すでにサインイン済みのアカウントがある場合の取りこぼしを埋める
insert into public.users (id, name, email)
select
  au.id,
  coalesce(
    au.raw_user_meta_data ->> 'full_name',
    au.raw_user_meta_data ->> 'name',
    split_part(au.email, '@', 1)
  ),
  au.email
from auth.users au
on conflict (id) do nothing;

-- user_id を省略しても自分のIDが入るようにしておく（保険）
alter table public.daily_reports         alter column user_id set default auth.uid();
alter table public.user_metrics_settings alter column user_id set default auth.uid();


-- ============================================================
-- 2. MVP用の全許可ポリシーを撤去
-- ============================================================
drop policy if exists "mvp_users_all"              on public.users;
drop policy if exists "mvp_reports_all"            on public.daily_reports;
drop policy if exists "mvp_metrics_settings_all"   on public.user_metrics_settings;
drop policy if exists "mvp_daily_metrics_all"      on public.daily_metrics;
drop policy if exists "mvp_commitment_reviews_all" on public.commitment_reviews;

alter table public.users                 enable row level security;
alter table public.daily_reports         enable row level security;
alter table public.user_metrics_settings enable row level security;
alter table public.daily_metrics         enable row level security;
alter table public.commitment_reviews    enable row level security;


-- ============================================================
-- 3. users（プロフィール）
--    誰の日報か表示するため、ログイン済みなら全員分を読める。
--    書き込みは自分の行だけ（新規作成はトリガーが行う）。
-- ============================================================
drop policy if exists "users_select_authenticated" on public.users;
create policy "users_select_authenticated" on public.users
  for select to authenticated
  using (true);

drop policy if exists "users_update_own" on public.users;
create policy "users_update_own" on public.users
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());


-- ============================================================
-- 4. daily_reports（日報本体）
-- ============================================================
drop policy if exists "reports_select_authenticated" on public.daily_reports;
create policy "reports_select_authenticated" on public.daily_reports
  for select to authenticated
  using (true);

drop policy if exists "reports_insert_own" on public.daily_reports;
create policy "reports_insert_own" on public.daily_reports
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "reports_update_own" on public.daily_reports;
create policy "reports_update_own" on public.daily_reports
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());   -- 他人のIDに書き換えて逃がすのも防ぐ

drop policy if exists "reports_delete_own" on public.daily_reports;
create policy "reports_delete_own" on public.daily_reports
  for delete to authenticated
  using (user_id = auth.uid());


-- ============================================================
-- 5. daily_metrics / commitment_reviews
--    日報にぶら下がる表。持ち主の判定は親の日報をたどって行う。
-- ============================================================
create or replace function public.owns_report(target_report_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.daily_reports r
     where r.id = target_report_id
       and r.user_id = auth.uid()
  );
$$;

drop policy if exists "daily_metrics_select_authenticated" on public.daily_metrics;
create policy "daily_metrics_select_authenticated" on public.daily_metrics
  for select to authenticated
  using (true);

drop policy if exists "daily_metrics_write_own" on public.daily_metrics;
create policy "daily_metrics_write_own" on public.daily_metrics
  for all to authenticated
  using (public.owns_report(report_id))
  with check (public.owns_report(report_id));

drop policy if exists "commitment_reviews_select_authenticated" on public.commitment_reviews;
create policy "commitment_reviews_select_authenticated" on public.commitment_reviews
  for select to authenticated
  using (true);

drop policy if exists "commitment_reviews_write_own" on public.commitment_reviews;
create policy "commitment_reviews_write_own" on public.commitment_reviews
  for all to authenticated
  using (public.owns_report(report_id))
  with check (public.owns_report(report_id));


-- ============================================================
-- 6. user_metrics_settings（数値評価枠の設定）
--    個人の設定なので、閲覧も自分の分だけに絞る。
-- ============================================================
drop policy if exists "metrics_settings_own" on public.user_metrics_settings;
create policy "metrics_settings_own" on public.user_metrics_settings
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());


-- ============================================================
-- 7. 【任意】旧ログイン時代のデータを自分のアカウントに引き継ぐ
--
--    旧「ユーザーA」などの日報は、今のままだと誰の所有物でもないため
--    閲覧はできても編集できません。引き継ぎたい場合だけ、
--    一度Googleログインしたうえで下のコメントを外して実行してください。
-- ============================================================
-- update public.daily_reports
--    set user_id = (select id from auth.users where email = 'あなたの@メールアドレス')
--  where user_id = (select id from public.users where name = 'ユーザーA');
--
-- update public.user_metrics_settings
--    set user_id = (select id from auth.users where email = 'あなたの@メールアドレス')
--  where user_id = (select id from public.users where name = 'ユーザーA');
