// ============================================================
// マイ・ナレッジ（メモ）
//   「データ分析 / ナレッジ」画面の下部に置く、1ユーザー1枚のメモ帳。
//   扱うのは常にログイン中の本人のメモで、デモモードでも切り替わらない
//   （RLS も auth.uid() で縛っているので、他人の分は取得できない）。
// ============================================================
import { supabase, isConfigured } from './supabase.js';
import { showToast } from './util.js';
import { formatSavedAt } from './draft.js';

let started = false;

export async function setupKnowledge(user) {
  if (started) return; // タブを行き来しても初期化は1回だけ
  started = true;

  const textarea = document.getElementById('knowledge-memo');
  const button = document.getElementById('knowledge-save-btn');
  const status = document.getElementById('knowledge-status');
  if (!textarea || !button || !status) return;

  // 保存済みの内容。これと入力欄が一致していれば「保存するものは無い」
  let saved = '';

  function setStatus(text, type) {
    status.textContent = text || '';
    status.className = type ? `message message-${type}` : 'message';
  }

  function syncButton() {
    button.disabled = textarea.value === saved;
  }

  if (!isConfigured) {
    setStatus('.env の設定が未完了のため、メモを読み込めません。', 'error');
    return;
  }

  const { data, error } = await supabase
    .from('knowledge_memos')
    .select('body, updated_at')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    setStatus('メモの読み込みに失敗しました: ' + error.message, 'error');
    return;
  }

  saved = (data && data.body) || '';
  textarea.value = saved;
  // 高さを内容に合わせ直す（自動拡張は input で計算されるため）
  textarea.dispatchEvent(new Event('input', { bubbles: true }));

  setStatus(
    data && data.updated_at ? `最終保存: ${formatSavedAt(data.updated_at)}` : 'まだメモがありません。',
    null
  );

  textarea.addEventListener('input', syncButton);
  syncButton();

  button.addEventListener('click', async () => {
    const body = textarea.value;

    button.disabled = true;
    setStatus('保存中...', null);

    // 1人1行なので upsert。初回は挿入、2回目以降は更新になる
    const { error: saveError } = await supabase
      .from('knowledge_memos')
      .upsert({ user_id: user.id, body, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });

    if (saveError) {
      setStatus('保存に失敗しました: ' + saveError.message, 'error');
      syncButton();
      return;
    }

    saved = body;
    syncButton();
    setStatus(`最終保存: ${formatSavedAt(new Date().toISOString())}`, null);
    showToast('メモを保存しました');
  });
}
