// ============================================================
// データ分析「表示項目」の選択肢のテスト
//
//   npm test
//
// DOM や Supabase には触らない、組み立てた文字列と選択の復元だけを確かめる。
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  dashboardMetricOptions,
  metricOptionsHtml,
  resolveMetricValue,
  TASK_RATE,
  TASK_TODAY,
  TASK_TOTAL,
} from './dashboard-metrics.js';

const BOTH_ON = { carryover: true, today: true };

test('選択肢は日報記入画面の数値実績（登録順）＋自動算出のぶんだけ', () => {
  assert.deepEqual(
    dashboardMetricOptions(['商談数', '受注額'], BOTH_ON).map((o) => o.value),
    ['商談数', '受注額', TASK_TOTAL, TASK_RATE, TASK_TODAY]
  );
});

test('項目設定から消した項目は選択肢に出ない（渡された名前だけを並べる）', () => {
  const values = dashboardMetricOptions(['商談数'], BOTH_ON).map((o) => o.value);
  assert.ok(!values.includes('受注額'));
});

test('数値実績の設定でオフにした自動算出は選択肢からも外れる', () => {
  const offCarryover = dashboardMetricOptions([], { carryover: false, today: true });
  assert.deepEqual(offCarryover.map((o) => o.value), [TASK_TODAY]);

  const offToday = dashboardMetricOptions([], { carryover: true, today: false });
  assert.deepEqual(offToday.map((o) => o.value), [TASK_TOTAL, TASK_RATE]);

  assert.deepEqual(dashboardMetricOptions([], { carryover: false, today: false }), []);
});

test('設定が未保存でも、自動算出は既定どおり全部出る', () => {
  assert.deepEqual(
    dashboardMetricOptions(null, {}).map((o) => o.value),
    [TASK_TOTAL, TASK_RATE, TASK_TODAY]
  );
  assert.equal(dashboardMetricOptions(undefined, undefined).length, 3);
});

test('名前が空の枠は選択肢に出さない', () => {
  assert.deepEqual(
    dashboardMetricOptions(['商談数', '', null], BOTH_ON)
      .filter((o) => o.group === '数値実績')
      .map((o) => o.value),
    ['商談数']
  );
});

test('選択肢は数値実績とタスク分析の2グループに分かれて出る', () => {
  const html = metricOptionsHtml(dashboardMetricOptions(['商談数'], BOTH_ON));
  assert.match(html, /<optgroup label="数値実績"><option value="商談数">商談数<\/option><\/optgroup>/);
  assert.match(html, /<optgroup label="タスク分析">/);
  assert.equal(html.split('<optgroup').length - 1, 2);
});

test('数値実績が1つも無ければ、そのグループごと出ない', () => {
  const html = metricOptionsHtml(dashboardMetricOptions([], BOTH_ON));
  assert.doesNotMatch(html, /label="数値実績"/);
});

test('項目名にタグが混ざっても差し込まれない', () => {
  const html = metricOptionsHtml(dashboardMetricOptions(['<img src=x>'], BOTH_ON));
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});

// ---------- 前回選んだ項目の復元 ----------

test('前回選んだ項目が残っていれば、それを初期表示にする', () => {
  const options = dashboardMetricOptions(['商談数', '受注額'], BOTH_ON);
  assert.equal(resolveMetricValue('受注額', options), '受注額');
  assert.equal(resolveMetricValue(TASK_RATE, options), TASK_RATE);
});

test('前回の項目が選択肢から消えていたら先頭に倒す', () => {
  const options = dashboardMetricOptions(['商談数'], BOTH_ON);
  assert.equal(resolveMetricValue('受注額', options), '商談数');
  assert.equal(resolveMetricValue('', options), '商談数');
  assert.equal(resolveMetricValue(TASK_TOTAL, dashboardMetricOptions([], { carryover: false })), TASK_TODAY);
});

test('選択肢が空でも落ちない（未選択のまま）', () => {
  assert.equal(resolveMetricValue('商談数', []), '');
  assert.equal(resolveMetricValue('商談数', null), '');
});
