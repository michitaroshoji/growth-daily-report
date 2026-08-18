-- ============================================================
-- Growth Daily Report / 管理者によるデモ記入の許可 (フェーズ8)
--
--   デモモード中の管理者が「デモ太郎」名義で日報を書けるようにする。
--
--   daily_reports / daily_metrics / commitment_reviews は
--   schema_v6_admin.sql の時点で管理者を通すようになっているが、
--   user_metrics_settings だけ「自分の分のみ」に絞られていて、
--   デモ太郎の数値項目を読み書きできない。ここだけ広げる。
--
-- ※ public.is_admin() を使うので、先に schema_v6_admin.sql を実行してください。
-- 何度実行しても安全です。
-- ============================================================

drop policy if exists "metrics_settings_own" on public.user_metrics_settings;

-- 閲覧：自分の設定、または管理者なら全員分
drop policy if exists "metrics_settings_select" on public.user_metrics_settings;
create policy "metrics_settings_select" on public.user_metrics_settings
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- 作成：自分名義、または管理者なら誰の名義でも
drop policy if exists "metrics_settings_insert" on public.user_metrics_settings;
create policy "metrics_settings_insert" on public.user_metrics_settings
  for insert to authenticated
  with check (user_id = auth.uid() or public.is_admin());

-- 更新
drop policy if exists "metrics_settings_update" on public.user_metrics_settings;
create policy "metrics_settings_update" on public.user_metrics_settings
  for update to authenticated
  using      (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

-- 削除
drop policy if exists "metrics_settings_delete" on public.user_metrics_settings;
create policy "metrics_settings_delete" on public.user_metrics_settings
  for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

revoke all on public.user_metrics_settings from anon;

-- ------------------------------------------------------------
-- 確認
-- ------------------------------------------------------------
select policyname, cmd from pg_policies
 where schemaname = 'public' and tablename = 'user_metrics_settings'
 order by cmd;
