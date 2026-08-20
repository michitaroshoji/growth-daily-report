// ============================================================
// プロフィール / 設定モーダル
//   ヘッダー右上のユーザー名を押すと開く。
//   本人が変えられるのは「所属部署」だけ（権限・凍結は管理者画面から）。
// ============================================================
import { supabase } from './supabase.js';
import { roleLabel } from './permissions.js';
import { fetchDepartments, fillDepartmentSelect } from './departments.js';

export function setupProfile(user) {
  const openBtn = document.getElementById('user-name');
  const modal = document.getElementById('profile-modal');
  if (!openBtn || !modal) return;

  const nameEl = document.getElementById('profile-name');
  const emailEl = document.getElementById('profile-email');
  const roleEl = document.getElementById('profile-role');
  const deptSelect = document.getElementById('profile-department');
  const saveBtn = document.getElementById('profile-save-btn');
  const closeBtn = document.getElementById('profile-close-btn');
  const messageEl = document.getElementById('profile-message');

  let loaded = false;
  let savedDepartmentId = user.departmentId || '';

  function setMessage(text, type) {
    messageEl.textContent = text || '';
    messageEl.className = type ? `message message-${type}` : 'message';
  }

  function syncSaveButton() {
    saveBtn.disabled = deptSelect.value === savedDepartmentId;
  }

  async function load() {
    if (loaded) return;
    loaded = true;

    const departments = await fetchDepartments();
    fillDepartmentSelect(deptSelect, departments, savedDepartmentId);
    // 選択肢に無いIDだった場合は表示と実体がずれるので、選ばれた値に合わせ直す
    savedDepartmentId = deptSelect.value;
    syncSaveButton();

    if (departments.length === 0) {
      setMessage('部署がまだ登録されていません。管理者に追加を依頼してください。', null);
    }
  }

  function openModal() {
    modal.hidden = false;
    document.body.classList.add('modal-open');
    setMessage('', null);
    nameEl.textContent = user.name;
    emailEl.textContent = user.email || '—';
    roleEl.textContent = roleLabel(user.role);
    load();
  }

  function closeModal() {
    modal.hidden = true;
    document.body.classList.remove('modal-open');
  }

  openBtn.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.hidden) closeModal();
  });

  deptSelect.addEventListener('change', syncSaveButton);

  saveBtn.addEventListener('click', async () => {
    const next = deptSelect.value || null;

    saveBtn.disabled = true;
    setMessage('保存中...', null);

    const { error } = await supabase
      .from('users')
      .update({ department_id: next })
      .eq('id', user.id);

    if (error) {
      setMessage('保存に失敗しました: ' + error.message, 'error');
      syncSaveButton();
      return;
    }

    savedDepartmentId = deptSelect.value;
    user.departmentId = next; // 同じ画面内で開き直したときに戻らないようにする
    syncSaveButton();
    setMessage('所属部署を保存しました。', 'success');
  });
}
