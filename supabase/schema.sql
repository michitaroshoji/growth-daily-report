-- ============================================================
-- Growth Daily Report / テーブル設計 (MVP フェーズ1)
-- Supabase ダッシュボード > SQL Editor に貼り付けて Run してください
-- ============================================================

-- ------------------------------------------------------------
-- 1. users : 簡易ログイン用のユーザーマスタ
-- ------------------------------------------------------------
create table if not exists public.users (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,          -- 例: ユーザーA
  created_at  timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 2. daily_reports : 日報本体
--    「前回の振り返り」＋「本日分6項目」を1レコードに保存する
-- ------------------------------------------------------------
create table if not exists public.daily_reports (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  report_date date not null default current_date,   -- 日報の対象日

  -- --- 前回の振り返り（PDCA強制エリア） ---
  prev_achievement text,   -- 達成できた / 一部できた / できなかった
  prev_reflection  text,   -- 振り返りコメント

  -- --- 本日分の日報6項目 ---
  fact        text not null,   -- 1. 業務実績 (Fact)
  problem     text,            -- 2. 未達成・課題 (Problem)
  why         text,            -- 3. 要因分析 (Why)
  commitment  text not null,   -- 4. 次回の宣言 (Commit)
  action      text,            -- 5. 改善の準備 (Action)
  insight     text,            -- 6. 学び・備考 (Insight)

  created_at  timestamptz not null default now()
);

-- 「そのユーザーの最新1件」を高速に引くためのインデックス
create index if not exists daily_reports_user_created_idx
  on public.daily_reports (user_id, created_at desc);

-- ------------------------------------------------------------
-- 3. RLS（行レベルセキュリティ）
--    ※MVPでは本格認証がないため、anonキーで読み書きを全許可します。
--    ※社外公開する場合は必ず Supabase Auth + 厳格なポリシーに置き換えてください。
-- ------------------------------------------------------------
alter table public.users         enable row level security;
alter table public.daily_reports enable row level security;

drop policy if exists "mvp_users_all" on public.users;
create policy "mvp_users_all" on public.users
  for all to anon, authenticated using (true) with check (true);

drop policy if exists "mvp_reports_all" on public.daily_reports;
create policy "mvp_reports_all" on public.daily_reports
  for all to anon, authenticated using (true) with check (true);

-- ------------------------------------------------------------
-- 4. 初期ユーザーの登録
-- ------------------------------------------------------------
insert into public.users (name) values
  ('ユーザーA'),
  ('ユーザーB'),
  ('ユーザーC')
on conflict (name) do nothing;
