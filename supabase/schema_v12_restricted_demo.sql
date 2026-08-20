-- ============================================================
-- Growth Daily Report / 制限付きユーザーのデモ閲覧 (フェーズ12)
--
--   restricted（制限付き）は他人の日報を読めないが、デモ用アカウント
--   「デモ太郎」だけは例外として読めるようにする。
--   デモ画面の閲覧は restricted でも使える機能なので、
--   schema_v11_departments.sql のままだとデモモードに切り替えても
--   一覧もデータ分析も中身が空になってしまう。
--
-- 既存のファイルは書き換えていません（このファイルを足すだけ）。
-- 何度実行しても安全です。SQL Editor に貼り付けて Run してください。
-- ============================================================


-- ------------------------------------------------------------
-- 1. デモ用アカウントの判定
--    名前で引く（src/demo.js の DEMO_USER_NAME と必ず揃えること）
-- ------------------------------------------------------------
create or replace function public.is_demo_user(target_user_id uuid)
returns boolean
language sql
stable
security definer                 -- users を RLS 抜きで引く
set search_path = public
as $$
  select exists (
    select 1
      from public.users u
     where u.id = target_user_id
       and u.name = 'デモ太郎'
  );
$$;


-- ------------------------------------------------------------
-- 2. 日報を読んでよいか
--    v11 の定義に「デモ太郎の日報」を足したもの。
--    子テーブル（daily_metrics / commitment_reviews）の判定に使われている
-- ------------------------------------------------------------
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
       and (r.user_id = auth.uid() or public.is_demo_user(r.user_id))
  );
$$;


-- ------------------------------------------------------------
-- 3. 日報本体のポリシーを貼り直す
--    v11 と同じ名前で作り直す（restrictive なので既存の select ポリシーとAND）
-- ------------------------------------------------------------
drop policy if exists "daily_reports_select_restricted" on public.daily_reports;
create policy "daily_reports_select_restricted" on public.daily_reports
  as restrictive for select to authenticated
  using (
    user_id = auth.uid()
    or not public.is_restricted()
    or public.is_demo_user(user_id)
  );
