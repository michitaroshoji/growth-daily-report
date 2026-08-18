// ============================================================
// 表示設定（自動算出タスク実績のオン/オフ）
//   日報作成画面・過去の日報・コピー用テキストで同じ設定を参照する。
//   端末ごとの見た目の好みなので localStorage に置く。
// ============================================================
const STORAGE_KEY = 'gdr_auto_metrics';

// 既定は両方オン
const DEFAULTS = { carryover: true, today: true };

export const AUTO_METRICS = [
  { key: 'carryover', label: '🏆 引き継ぎタスク達成率' },
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
