// ============================================================
// データ分析「表示項目」の選択肢
//   日報記入画面の「1.5 数値実績」に出ている項目とそろえる。
//   （項目設定から消した枠や、オフにした自動算出の行は出さない）
//   DOM や Supabase には触らない文字列生成だけを置く（テストしやすいように）。
// ============================================================
import { escapeHtml } from './util.js';

// 数値実績とは別枠で出す、振り返りから計算する系列
export const TASK_TOTAL = '__task_total__';
export const TASK_RATE = '__task_rate__';
export const TASK_TODAY = '__task_today__';

// 日報記入画面の自動算出行（report.html の #auto-metrics）と、分析側の系列の対応。
// 「引き継ぎタスク達成」の行から、総数と達成率の2系列を出している
const AUTO_SERIES = [
  { auto: 'carryover', value: TASK_TOTAL, label: '引き継ぎタスク総数' },
  { auto: 'carryover', value: TASK_RATE, label: '引き継ぎタスク達成率（%）' },
  { auto: 'today', value: TASK_TODAY, label: '今日のタスク総件数' },
];

// 表示項目の選択肢を組み立てる。
//   metricNames … 日報記入画面に入力欄が出ている数値実績（登録順）
//   autoMetrics … 数値実績の設定でのオン/オフ（settings.js の getAutoMetricSettings）
export function dashboardMetricOptions(metricNames, autoMetrics) {
  const settings = autoMetrics || {};
  return [
    ...(metricNames || [])
      .filter((name) => typeof name === 'string' && name !== '')
      .map((name) => ({ value: name, label: name, group: '数値実績' })),
    ...AUTO_SERIES.filter((series) => settings[series.auto] !== false).map((series) => ({
      value: series.value,
      label: series.label,
      group: 'タスク分析',
    })),
  ];
}

// 選択肢を optgroup ごとにまとめたHTML
export function metricOptionsHtml(options) {
  const groups = new Map(); // Map は挿入順を保つので、渡された並びのまま出せる
  (options || []).forEach((option) => {
    if (!groups.has(option.group)) groups.set(option.group, []);
    groups.get(option.group).push(option);
  });

  return [...groups]
    .map(
      ([label, items]) =>
        `<optgroup label="${escapeHtml(label)}">${items
          .map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`)
          .join('')}</optgroup>`
    )
    .join('');
}

// 前回選んだ項目を復元する。選択肢から消えていれば先頭に倒す
export function resolveMetricValue(saved, options) {
  const list = options || [];
  if (list.some((option) => option.value === saved)) return saved;
  return list.length > 0 ? list[0].value : '';
}
