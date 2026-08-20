-- ============================================================
-- Growth Daily Report / 部署・権限3階層・管理者画面 (フェーズ11)
--
--   1. departments（部署）テーブルを追加
--   2. public.users に department_id / role / is_frozen を追加
--   3. 管理者判定を「メールアドレス決め打ち」から users.role へ移す
--   4. 凍結アカウントの書き込み禁止・制限付きユーザーの閲覧範囲を
--      restrictive ポリシー（＝既存ポリシーとAND）で上から重ねる
--
-- 【権限3階層】
--   admin      … 全データのCRUD、/admin（管理者画面）が使える
--   member     … 既定。閲覧は全員分／作成・更新・削除は自分の分のみ
--   restricted … 閲覧も自分の日報だけ。書き込みは member と同じ
--
-- 既存のポリシーは書き換えていません（追加だけ）。
-- 何度実行しても安全です。SQL Editor に貼り付けて Run してください。
-- ============================================================


-- ------------------------------------------------------------
-- 1. departments（部署）
-- ------------------------------------------------------------
create table if not exists public.departments (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_at timestamptz not null default now()
);


-- ------------------------------------------------------------
-- 2. public.users に列を足す
--    既存行は department_id = null / role = 'member' / is_frozen = false
-- ------------------------------------------------------------
alter table public.users
  add column if not exists department_id uuid references public.departments(id) on delete set null;

alter table public.users
  add column if not exists role text not null default 'member';

alter table public.users
  add column if not exists is_frozen boolean not null default false;

-- 値の制約は付け直す（列だけ先に入っている環境でも揃うように）
alter table public.users drop constraint if exists users_role_check;
alter table public.users
  add constraint users_role_check check (role in ('admin', 'member', 'restricted'));

create index if not exists users_department_idx on public.users (department_id);

-- 既存の管理者（フェーズ6でメールアドレス決め打ちしていた人）に role を移す。
-- これを流さないと、SQL適用の瞬間に管理者が居なくなってしまう
update public.users
   set role = 'admin'
 where lower(email) = 'michitaro.shoji@teetime.co.jp'
   and role <> 'admin';


-- ------------------------------------------------------------
-- 3. 判定関数
--    フロント側 src/permissions.js と条件を必ず揃えること
-- ------------------------------------------------------------

-- 管理者。users.role が唯一の判定元だが、
-- 行が消えている等の事故で全員締め出されないよう、旧来のメールアドレスも残す
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer                 -- users を RLS 抜きで引く
set search_path = public
as $$
  select coalesce(
           (select u.role = 'admin' from public.users u where u.id = auth.uid()),
           false
         )
      or coalesce(lower(auth.jwt() ->> 'email') = 'michitaro.shoji@teetime.co.jp', false);
$$;

-- 凍結アカウント。書き込みを一切通さないために使う
create or replace function public.is_frozen_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select u.is_frozen from public.users u where u.id = auth.uid()), false);
$$;

-- 制限付きユーザー。自分の日報しか読めない
create or replace function public.is_restricted()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select u.role = 'restricted' from public.users u where u.id = auth.uid()),
    false
  );
$$;

-- 日報を読んでよいか。子テーブル（daily_metrics / commitment_reviews）の判定に使う
create or replace function public.can_read_report(target_report_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not public.is_restricted() or exists (
    select 1
      from public.daily_reports r
     where r.id = target_report_id
       and r.user_id = auth.uid()
  );
$$;


-- ------------------------------------------------------------
-- 4. departments のポリシー
--    閲覧はログイン済みなら全員（プロフィールの部署選択で使う）。
--    追加・変更・削除は管理者だけ。
-- ------------------------------------------------------------
alter table public.departments enable row level security;

drop policy if exists "departments_select" on public.departments;
create policy "departments_select" on public.departments
  for select to authenticated
  using (true);

drop policy if exists "departments_write_admin" on public.departments;
create policy "departments_write_admin" on public.departments
  for all to authenticated
  using      (public.is_admin())
  with check (public.is_admin());

grant select, insert, update, delete on public.departments to authenticated;
revoke all on public.departments from anon;


-- ------------------------------------------------------------
-- 5. users のポリシーを管理者向けに広げる
--    既存の users_update_own（自分の行だけ）はそのまま残し、追加でORする。
-- ------------------------------------------------------------
drop policy if exists "users_update_admin" on public.users;
create policy "users_update_admin" on public.users
  for update to authenticated
  using      (public.is_admin())
  with check (public.is_admin());

drop policy if exists "users_delete_admin" on public.users;
create policy "users_delete_admin" on public.users
  for delete to authenticated
  using (public.is_admin());


-- ------------------------------------------------------------
-- 6. 自分で自分を管理者にできないようにする
--
--    users_update_own があるので、一般ユーザーも自分の行を更新できる。
--    そのままだと role = 'admin' / is_frozen = false に書き換えて
--    権限昇格・凍結解除ができてしまう。RLS の with check では
--    「変更前の値」を見られないため、トリガーで元の値へ戻す。
-- ------------------------------------------------------------
create or replace function public.guard_user_role_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- SQL Editor / service_role（auth.uid() が無い）と管理者はそのまま通す
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  new.role := old.role;
  new.is_frozen := old.is_frozen;
  return new;
end;
$$;

drop trigger if exists users_guard_role on public.users;
create trigger users_guard_role
  before update on public.users
  for each row execute function public.guard_user_role_columns();


-- ------------------------------------------------------------
-- 7. 凍結アカウントの書き込みを止める
--
--    restrictive ポリシーは既存の許可ポリシーと AND される。
--    既存ポリシーを書き換えずに「上から塞ぐ」ことができる。
--    閲覧(select)は塞がない：凍結されても他人からは日報が見える必要がある。
-- ------------------------------------------------------------
do $$
declare
  target text;
  policy_name text;
begin
  foreach target in array array[
    'users', 'departments', 'daily_reports', 'daily_metrics',
    'commitment_reviews', 'user_metrics_settings', 'knowledge_memos', 'manuals'
  ]
  loop
    -- まだ作っていないテーブル（マニュアル等）があっても止まらないようにする
    continue when to_regclass('public.' || target) is null;

    policy_name := target || '_not_frozen_insert';
    execute format('drop policy if exists %I on public.%I', policy_name, target);
    execute format(
      'create policy %I on public.%I as restrictive for insert to authenticated '
      'with check (not public.is_frozen_user())', policy_name, target);

    policy_name := target || '_not_frozen_update';
    execute format('drop policy if exists %I on public.%I', policy_name, target);
    execute format(
      'create policy %I on public.%I as restrictive for update to authenticated '
      'using (not public.is_frozen_user()) with check (not public.is_frozen_user())',
      policy_name, target);

    policy_name := target || '_not_frozen_delete';
    execute format('drop policy if exists %I on public.%I', policy_name, target);
    execute format(
      'create policy %I on public.%I as restrictive for delete to authenticated '
      'using (not public.is_frozen_user())', policy_name, target);
  end loop;
end;
$$;


-- ------------------------------------------------------------
-- 8. 制限付き(restricted)ユーザーの閲覧範囲を自分の分だけに絞る
--    こちらも restrictive で上から重ねる（既存の select ポリシーは触らない）
-- ------------------------------------------------------------
drop policy if exists "daily_reports_select_restricted" on public.daily_reports;
create policy "daily_reports_select_restricted" on public.daily_reports
  as restrictive for select to authenticated
  using (user_id = auth.uid() or not public.is_restricted());

drop policy if exists "daily_metrics_select_restricted" on public.daily_metrics;
create policy "daily_metrics_select_restricted" on public.daily_metrics
  as restrictive for select to authenticated
  using (public.can_read_report(report_id));

drop policy if exists "commitment_reviews_select_restricted" on public.commitment_reviews;
create policy "commitment_reviews_select_restricted" on public.commitment_reviews
  as restrictive for select to authenticated
  using (public.can_read_report(report_id));


-- ------------------------------------------------------------
-- 9. 管理者によるアカウント削除
--
--    public.users を消すだけでは auth.users にログイン情報が残り、
--    次のログインでプロフィール行が作り直されてしまう（handle_new_user）。
--    auth スキーマは anon/authenticated から直接触れないので、
--    security definer の関数越しに消す。
-- ------------------------------------------------------------
create or replace function public.admin_delete_user(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception '管理者のみ実行できます';
  end if;
  if target_id = auth.uid() then
    raise exception '自分自身のアカウントは削除できません';
  end if;

  -- 日報・数値項目・メモは public.users への外部キーが on delete cascade
  delete from public.users where id = target_id;
  delete from auth.users  where id = target_id;
end;
$$;

revoke all on function public.admin_delete_user(uuid) from public, anon;
grant execute on function public.admin_delete_user(uuid) to authenticated;


-- ------------------------------------------------------------
-- 10. 確認（Runすると結果が表示されます）
-- ------------------------------------------------------------
select role, count(*) as users from public.users group by role order by role;
