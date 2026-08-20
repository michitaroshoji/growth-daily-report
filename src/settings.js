// ============================================================
// 表示設定（自動算出タスク実績のオン/オフ、データ分析の表示項目）
//   日報作成画面・過去の日報・コピー用テキストで同じ設定を参照する。
//   端末ごとの見た目の好みなので localStorage に置く。
// ============================================================
const STORAGE_KEY = 'gdr_auto_metrics';
const DASH_METRIC_KEY = 'gdr_dash_metric';

// 既定は両方オン
const DEFAULTS = { carryover: true, today: true };

export const AUTO_METRICS = [
  { key: 'carryover', label: '🏆 前日タスク達成率' },
  { key: 'today', label: '📝 今日のタスク総件数' },
];

export function getAutoMetricSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    // 保存済みの値だけ上書きする（項目が増えたときに既定値へ倒れるように）
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setAutoMetricSetting(key, enabled) {
  const next = { ...getAutoMetricSettings(), [key]: !!enabled };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 保存できなくても画面は動かす
  }
  return next;
}

export function isAutoMetricVisible(key) {
  return getAutoMetricSettings()[key] !== false;
}

// ============================================================
// データ分析の「表示項目」で最後に選んだもの
//   次に開いたときも同じ項目から見られるように覚えておく。
//   選択肢から消えた項目が入っていることもあるので、
//   復元する側（dashboard-metrics.js の resolveMetricValue）で必ず突き合わせる。
// ============================================================
export function getDashboardMetric() {
  try {
    return localStorage.getItem(DASH_METRIC_KEY) || '';
  } catch {
    return '';
  }
}

export function setDashboardMetric(value) {
  try {
    localStorage.setItem(DASH_METRIC_KEY, value || '');
  } catch {
    // 保存できなくても画面は動かす
  }
}
