-- ============================================================
-- Growth Daily Report / スキーマ拡張 (フェーズ4)
--   1. 7. 一言（フリーコメント）の追加
--   2. 自動算出するタスク実績の保存先
--
-- 何度実行しても安全です。SQL Editor に貼り付けて Run してください。
-- ============================================================

alter table public.daily_reports
  add column if not exists one_word text;   -- 7. 一言（フリーコメント）

-- ------------------------------------------------------------
-- 自動算出したタスク実績
--   carryover_* : 「0. 前回の振り返り」の評価から算出（引き継ぎタスク）
--   today_task_count : 「1. 業務実績」のテキストを解析した末端項目の数
--
-- ※ carryover_task_done は「一部達成=0.5」で数えるため numeric にする
-- ※ 引き継ぎタスクが無かった日報（初回など）は NULL のままにする
-- ------------------------------------------------------------
alter table public.daily_reports
  add column if not exists carryover_task_total int,      -- 引き継ぎタスク総数（分母）
  add column if not exists carryover_task_done  numeric,  -- 引き継ぎタスク達成数（分子）
  add column if not exists today_task_count     int;      -- 今日のタスク総件数
