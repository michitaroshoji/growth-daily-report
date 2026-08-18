-- ============================================================
-- Growth Daily Report / スキーマ拡張 (フェーズ2)
--   1. 前回宣言の「行ごと評価」＋行ごとの要因分析
--   2. ユーザーが自分で決めるカスタム数値評価枠
--   3. PMV（バリュー）自己評価
--
-- 既存データを壊さない追加のみ。schema.sql を実行済みのDBに
-- そのまま貼り付けて Run してください（何度実行してもOK）。
-- ============================================================

-- ------------------------------------------------------------
-- 1. PMV（バリュー）自己評価
--    6項目 × 5段階を1カラム(JSONB)にまとめて持つ。
--    例: {"常に越えようとする": 4, "圧倒的スピード": 5, ...}
--    項目が将来増減してもマイグレーション不要にするためJSONBを採用。
-- ------------------------------------------------------------
alter table public.daily_reports
  add column if not exists pmv_ratings jsonb;

-- ------------------------------------------------------------
-- 2. user_metrics_settings : カスタム数値評価枠の「設定」
--    ユーザーごとに「評価項目名」と「単位」を登録する
-- ------------------------------------------------------------
create table if not exists public.user_metrics_settings (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  name        text not null,                    -- 例: 新規架電数
  unit        text not null default '件',       -- 例: 件 / 時間 / 円
  sort_order  int  not null default 0,          -- 画面に出す順番
  created_at  timestamptz not null default now(),
  unique (user_id, name)                        -- 同じ名前の重複登録を防ぐ
);

create index if not exists user_metrics_settings_user_idx
  on public.user_metrics_settings (user_id, sort_order, created_at);

-- ------------------------------------------------------------
-- 3. daily_metrics : その日の数値実績（日報1件にぶら下がる）
--    name / unit は設定のコピーを持たせる。
--    設定を後から削除・改名しても、過去の日報がそのまま読めるようにするため。
-- ------------------------------------------------------------
create table if not exists public.daily_metrics (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references public.daily_reports(id) on delete cascade,
  metric_id   uuid references public.user_metrics_settings(id) on delete set null,
  name        text not null,      -- 記録時点の項目名（スナップショット）
  unit        text not null,      -- 記録時点の単位（スナップショット）
  value       numeric,            -- 入力された数値
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists daily_metrics_report_idx
  on public.daily_metrics (report_id, sort_order);

-- ------------------------------------------------------------
-- 4. commitment_reviews : 前回宣言の「行ごと」評価
--    前回の commitment を改行で分割した1行ごとに1レコード。
--    未達成・一部達成のときだけ reason（要因分析）が入る。
-- ------------------------------------------------------------
create table if not exists public.commitment_reviews (
  id             uuid primary key default gen_random_uuid(),
  report_id      uuid not null references public.daily_reports(id) on delete cascade, -- 今回書いた日報
  prev_report_id uuid references public.daily_reports(id) on delete set null,          -- 振り返りの対象になった日報
  line_no        int  not null,        -- 0始まりの行番号
  line_text      text not null,        -- 評価対象の宣言テキスト（スナップショット）
  achievement    text not null check (achievement in ('達成', '一部達成', '未達成')),
  reason         text,                 -- その行がなぜ未達だったのか
  created_at     timestamptz not null default now(),
  unique (report_id, line_no)
);

create index if not exists commitment_reviews_report_idx
  on public.commitment_reviews (report_id, line_no);

-- ------------------------------------------------------------
-- 5. RLS（MVPのため anon キーで全許可。schema.sql と同じ方針）
--    ※社外公開する場合は必ず Supabase Auth + 厳格なポリシーへ。
-- ------------------------------------------------------------
alter table public.user_metrics_settings enable row level security;
alter table public.daily_metrics         enable row level security;
alter table public.commitment_reviews    enable row level security;

drop policy if exists "mvp_metrics_settings_all" on public.user_metrics_settings;
create policy "mvp_metrics_settings_all" on public.user_metrics_settings
  for all to anon, authenticated using (true) with check (true);

drop policy if exists "mvp_daily_metrics_all" on public.daily_metrics;
create policy "mvp_daily_metrics_all" on public.daily_metrics
  for all to anon, authenticated using (true) with check (true);

drop policy if exists "mvp_commitment_reviews_all" on public.commitment_reviews;
create policy "mvp_commitment_reviews_all" on public.commitment_reviews
  for all to anon, authenticated using (true) with check (true);
