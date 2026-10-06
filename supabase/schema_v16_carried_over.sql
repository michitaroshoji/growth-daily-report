-- ============================================================
-- Growth Daily Report / タスク評価に「次回」を追加 (フェーズ16)
--
--   commitment_reviews.achievement の CHECK 制約は
--   schema_v9_cancelled.sql の時点で ('達成','一部達成','未達成','中止') になっている。
--   このままだと「次回」を選んだ日報の保存が
--   new row violates check constraint で失敗するため、制約を貼り替える。
--
--   ※「次回」は次回の宣言へ持ち越したタスク。中止と同じく要因分析（reason）を
--     書かない運用なので、reason は NULL のまま入る。
--     達成率の計算からも除外している（フロント側 src/util.js の summarizeTasks）。
--
-- 何度実行しても安全です。SQL Editor に貼り付けて Run してください。
-- ============================================================

alter table public.commitment_reviews
  drop constraint if exists commitment_reviews_achievement_check;

alter table public.commitment_reviews
  add constraint commitment_reviews_achievement_check
  check (achievement in ('達成', '一部達成', '未達成', '中止', '次回'));

-- ------------------------------------------------------------
-- 確認：制約の中身を表示（Runすると結果が出ます）
-- ------------------------------------------------------------
select conname, pg_get_constraintdef(oid) as definition
  from pg_constraint
 where conrelid = 'public.commitment_reviews'::regclass
   and contype  = 'c';
