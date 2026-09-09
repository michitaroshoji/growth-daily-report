-- ============================================================
-- Growth Daily Report / アカウント作成をドメインで絞る (フェーズ15)
--
--   このアプリは「ログインできれば全員分の日報が読める」設計で、
--   閲覧ポリシーは schema_v5_auth.sql / schema_v6_admin.sql とも using (true)。
--   新規権限は schema_v11_departments.sql の既定値 'member' なので、
--   実質の防壁は「このSupabaseプロジェクトでアカウントを取れるか」だけ。
--   ところが匿名キーは公開JSに必ず含まれるため誰でも入手でき、
--   サインアップAPIを直接叩けてしまう。そこをDB側で閉じる。
--
--   schema_v5_auth.sql の handle_new_user() を作り直し、
--   許可ドメイン以外のメールアドレスは raise exception で登録を拒否する。
--   トリガー（on_auth_user_created）はそのまま使い回せる。
--
-- 【フロント側にドメインチェックを足さないこと】
--   src/login.js で弾いてもAPIを直接叩けば迂回されるため、防御にならない。
--   拒否はこのトリガー（＝DB側）だけで行う。
--
-- 既存のファイルは書き換えていません（このファイルを足すだけ）。
-- 何度実行しても安全です。SQL Editor に貼り付けて Run してください。
-- ============================================================


-- ------------------------------------------------------------
-- 1. 許可するメールドメインの一覧
--    ★ ドメインを増やしたいときに直すのはここだけ。
--      既存ファイルは書き換えず、この関数を create or replace する
--      新しい .sql（schema_v16_....sql など）を足してください。
--    すべて小文字で書くこと（比較する側も小文字に揃えている）
-- ------------------------------------------------------------
create or replace function public.signup_allowed_domains()
returns text[]
language sql
immutable
as $$
  select array[
    'teetime.co.jp'
  ]::text[];
$$;

-- 一覧そのものを匿名キーから引ける必要はない。
-- handle_new_user() は security definer なので、剥がしても呼び出せる
revoke all on function public.signup_allowed_domains() from public, anon, authenticated;


-- ------------------------------------------------------------
-- 2. 新規アカウントの受け入れ判定
--    schema_v5_auth.sql の handle_new_user() に、拒否の条件を足したもの。
--    insert 部分（表示名の決め方）は元のまま。
--
--    通すのは次のどちらか:
--      a) メールアドレスが許可ドメイン（＝社内のGoogleアカウント）
--      b) public.users にすでに行がある（＝社外デモ用に手動発行したもの）
--
--    b) が無いと、既存の社外デモアカウントが締め出される。
--    ※ 社外デモ用に「新しい」アドレスを発行したいときは、
--      1 の一覧にそのドメインを足す .sql を先に流してください。
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer            -- RLSを迂回して users に書き込む必要がある
set search_path = public
as $$
declare
  signup_email  text := lower(coalesce(new.email, ''));
  signup_domain text := split_part(signup_email, '@', 2);
begin
  if signup_domain <> all (public.signup_allowed_domains())
     and not exists (
       select 1
         from public.users u
        where u.id = new.id
           or (signup_email <> '' and lower(u.email) = signup_email)
     )
  then
    raise exception
      '許可されていないドメインのため、アカウントを作成できません: @%', signup_domain
      using errcode = 'check_violation';
  end if;

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


-- ------------------------------------------------------------
-- 3. 確認
--    許可ドメイン外の既存アカウント＝手動発行のデモ用。
--    2 の b) で通るので、ここに出ていても締め出されない
-- ------------------------------------------------------------
select
  lower(split_part(coalesce(u.email, ''), '@', 2)) as domain,
  lower(split_part(coalesce(u.email, ''), '@', 2)) = any (public.signup_allowed_domains()) as allowed,
  count(*) as users
from public.users u
group by 1, 2
order by allowed desc, domain;
