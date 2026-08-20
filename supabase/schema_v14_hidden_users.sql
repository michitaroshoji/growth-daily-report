-- ============================================================
-- Growth Daily Report / ユーザーの非表示（is_hidden）(フェーズ14)
--
--   退職者などを「過去の日報」画面から外すためのフラグ。
--   凍結（is_frozen＝ログインさせない）とは別物で、
--   is_hidden は「他の人の画面に出さない」だけを意味する。
--
--   切り替えられるのは管理者だけ。
--   users_update_own があるため、そのままでは本人が自分で
--   非表示を解除できてしまうので、role / is_frozen と同じく
--   guard_user_role_columns() で元の値へ戻す。
--
-- 既存のファイルは書き換えていません（このファイルを足すだけ）。
-- 何度実行しても安全です。SQL Editor に貼り付けて Run してください。
-- ============================================================


-- ------------------------------------------------------------
-- 1. public.users に列を足す
--    既存行は is_hidden = false（今までどおり全員が表示される）
-- ------------------------------------------------------------
alter table public.users
  add column if not exists is_hidden boolean not null default false;


-- ------------------------------------------------------------
-- 2. 本人による書き換えを止める
--    schema_v11_departments.sql の関数に is_hidden を足したもの。
--    トリガー（users_guard_role）はそのまま使い回せる
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
  new.is_hidden := old.is_hidden;
  return new;
end;
$$;


-- ------------------------------------------------------------
-- 3. 確認
-- ------------------------------------------------------------
select is_hidden, count(*) as users from public.users group by is_hidden order by is_hidden;
