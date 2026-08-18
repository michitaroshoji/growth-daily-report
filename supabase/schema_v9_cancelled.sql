-- ============================================================
-- Growth Daily Report / タスク評価に「中止」を追加 (フェーズ9)
--
--   commitment_reviews.achievement は
--   schema_v2.sql の時点で ('達成','一部達成','未達成') のCHECK制約が付いている。
--   このままだと「中止」を選んだ日報の保存が
--   new row violates check constraint で失敗するため、制約を貼り替える。
--
--   ※「中止」は要因分析（reason）を書かない運用なので、reason は NULL のまま入る。
--     達成率の計算からも除外している（フロント側 src/util.js の summarizeTasks）。
--
-- 何度実行しても安全です。SQL Editor に貼り付けて Run してください。
-- ============================================================

alter table public.commitment_reviews
  drop constraint if exists commitment_reviews_achievement_check;

alter table public.commitment_reviews
  add constraint commitment_reviews_achievement_check
  check (achievement in ('達成', '一部達成', '未達成', '中止'));

-- ------------------------------------------------------------
-- 確認：制約の中身を表示（Runすると結果が出ます）
-- ------------------------------------------------------------
select conname, pg_get_constraintdef(oid) as definition
  from pg_constraint
 where conrelid = 'public.commitment_reviews'::regclass
   and contype  = 'c';
