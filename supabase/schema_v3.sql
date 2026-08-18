-- ============================================================
-- Growth Daily Report / スキーマ調整 (フェーズ3)
--   分析ダッシュボードを「日報の対象日(report_date)」基準にするための整備
--
-- 何度実行しても安全です。SQL Editor に貼り付けて Run してください。
-- ============================================================

-- ------------------------------------------------------------
-- 1. report_date の補完
--    schema.sql の時点で default current_date が付いているため通常はNULLゼロだが、
--    直接INSERTされた行などでNULLが混ざっていた場合に created_at から埋める。
--    ※タイムゾーンは日本時間で日付を切り出す（UTCのままだと9時間ぶんずれるため）
-- ------------------------------------------------------------
update public.daily_reports
   set report_date = (created_at at time zone 'Asia/Tokyo')::date
 where report_date is null;

-- 以後もNULLが入らないようにする（既にNOT NULLなら何も起きない）
alter table public.daily_reports
  alter column report_date set default current_date;

alter table public.daily_reports
  alter column report_date set not null;

-- ------------------------------------------------------------
-- 2. 対象日での絞り込み・並べ替えを速くするインデックス
-- ------------------------------------------------------------
create index if not exists daily_reports_user_report_date_idx
  on public.daily_reports (user_id, report_date desc, created_at desc);

-- ------------------------------------------------------------
-- 3. 確認用：日付ごとの件数（Runした結果として表示されます）
-- ------------------------------------------------------------
select report_date, count(*) as reports
  from public.daily_reports
 group by report_date
 order by report_date desc;
