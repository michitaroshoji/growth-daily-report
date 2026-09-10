// ============================================================
// 入力途中の自動保存（下書き）
//   送信前にタブを閉じたりリロードしても入力が消えないよう、
//   localStorage に持たせておく。送信が成功したら消す。
// ============================================================

// 下書きは「誰の」「どの日報か」で分ける。
// 新規作成と編集で混ざらないようにするため
export function draftKey(userId, editId) {
  return `gdr_draft:${userId}:${editId || 'new'}`;
}

// タスク管理は日報1件ではなく人に紐づく。日をまたいで持ち越すので、
// 日報本文の下書き（送信すると消える）とはキーを分ける
export function taskDraftKey(userId) {
  return `gdr_tasks:${userId}`;
}

export function loadDraft(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    localStorage.removeItem(key); // 壊れていたら捨てる
    return null;
  }
}

export function saveDraft(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ ...data, savedAt: new Date().toISOString() }));
  } catch {
    // 容量超過などは黙って諦める（入力を妨げない）
  }
}

export function clearDraft(key) {
  localStorage.removeItem(key);
}

// 下書きが「実質空」かどうか。空なら復元もお知らせもしない
export function isDraftEmpty(draft) {
  if (!draft) return true;

  const hasText = Object.values(draft.fields || {}).some((v) => String(v || '').trim() !== '');
  const hasMetric = Object.values(draft.metrics || {}).some((v) => String(v || '').trim() !== '');
  const hasPmv = Object.keys(draft.pmv || {}).length > 0;
  const hasReview = (draft.reviews || []).some((r) => r.achievement || (r.reason || '').trim());
  const hasTask = (draft.tasks || []).length > 0;

  return !hasText && !hasMetric && !hasPmv && !hasReview && !hasTask;
}

export function formatSavedAt(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
