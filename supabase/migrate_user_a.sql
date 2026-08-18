-- ============================================================
-- 旧「ユーザーA」のデータを、Googleログインした自分のアカウントへ移す
--
--   実行前に一度Googleでログインしておいてください
--   （auth.users に自分の行が出来ている必要があります）
--
-- 移すもの:
--   ・daily_reports          … 日報本体（子の数値実績・振り返りは日報にぶら下がるので自動的に付いてくる）
--   ・user_metrics_settings  … 数値評価項目の設定
-- ============================================================


-- ------------------------------------------------------------
-- STEP 1. 事前確認（まずこれだけ実行して、件数を見てください）
-- ------------------------------------------------------------
select
  (select id   from public.users where name = 'ユーザーA')                    as user_a_id,
  (select id   from auth.users  where lower(email) = 'michitaro.shoji@teetime.co.jp') as my_id,
  (select count(*) from public.daily_reports
     where user_id = (select id from public.users where name = 'ユーザーA'))  as 移す日報の件数,
  (select count(*) from public.user_metrics_settings
     where user_id = (select id from public.users where name = 'ユーザーA'))  as 移す数値項目の件数;


-- ------------------------------------------------------------
-- STEP 2. 移行を実行（STEP 1 の件数に納得したら、ここを実行）
--         DOブロック全体が1トランザクションなので、途中で失敗すれば全て巻き戻ります
-- ------------------------------------------------------------
do $$
declare
  old_id  uuid;
  new_id  uuid;
  n_reports int;
  n_metrics int;
  n_dropped int;
begin
  select id into old_id from public.users where name = 'ユーザーA';
  select id into new_id from auth.users where lower(email) = 'michitaro.shoji@teetime.co.jp';

  if old_id is null then
    raise exception '「ユーザーA」が見つかりません。すでに移行済みかもしれません。';
  end if;

  if new_id is null then
    raise exception 'Googleアカウントが auth.users にありません。先に一度ログインしてください。';
  end if;

  -- 日報の外部キーは public.users を指しているので、プロフィール行が無ければ先に作る
  insert into public.users (id, name, email)
  select
    au.id,
    coalesce(au.raw_user_meta_data ->> 'full_name', au.raw_user_meta_data ->> 'name',
             split_part(au.email, '@', 1)),
    au.email
    from auth.users au
   where au.id = new_id
  on conflict (id) do nothing;

  -- 数値項目の設定は (user_id, name) が一意。
  -- 同じ名前を自分のアカウントで既に登録している場合は、旧側を捨てて重複を避ける
  delete from public.user_metrics_settings s
   where s.user_id = old_id
     and exists (
       select 1 from public.user_metrics_settings t
        where t.user_id = new_id and t.name = s.name
     );
  get diagnostics n_dropped = row_count;

  update public.user_metrics_settings set user_id = new_id where user_id = old_id;
  get diagnostics n_metrics = row_count;

  update public.daily_reports set user_id = new_id where user_id = old_id;
  get diagnostics n_reports = row_count;

  raise notice '日報 % 件 / 数値項目 % 件を移しました（重複のため破棄した数値項目: % 件）',
    n_reports, n_metrics, n_dropped;
end;
$$;


-- ------------------------------------------------------------
-- STEP 3. 確認（自分の名義になっているか）
-- ------------------------------------------------------------
select u.name, u.email, count(r.id) as 日報件数
  from public.users u
  left join public.daily_reports r on r.user_id = u.id
 group by u.id, u.name, u.email
 order by 日報件数 desc;


-- ------------------------------------------------------------
-- STEP 4.【任意】空になった「ユーザーA」を削除する
--   ※ daily_reports は user_id に ON DELETE CASCADE が付いています。
--     万一まだ日報が残っている状態で消すと道連れになるため、
--     0件であることを確認してからしか消さないようにしています。
-- ------------------------------------------------------------
-- do $$
-- declare old_id uuid;
-- begin
--   select id into old_id from public.users where name = 'ユーザーA';
--   if old_id is null then
--     raise notice 'ユーザーA はすでにありません。';
--   elsif exists (select 1 from public.daily_reports where user_id = old_id) then
--     raise exception 'まだ日報が残っています。削除を中止しました。';
--   else
--     delete from public.users where id = old_id;
--     raise notice 'ユーザーA を削除しました。';
--   end if;
-- end;
-- $$;
