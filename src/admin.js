// ============================================================
// 管理者画面（/admin）
//   ユーザー管理タブ … 名前・所属部署・権限・凍結・非表示・削除
//   部署管理タブ     … 部署の追加・改名・削除（在籍者がいる間は削除不可）
//
//   管理者以外がURLを直接開いても入れない（DB側も is_admin() で弾いている）。
// ============================================================
import { supabase, isConfigured } from './supabase.js';
import { requireUser, signOut } from './session.js';
import { setActiveNav } from './nav.js';
import { isAdmin, ROLES, roleLabel } from './permissions.js';
import { fetchDepartments } from './departments.js';
import { escapeHtml, showToast } from './util.js';

init();

async function init() {
  const user = await requireUser();
  if (!user) return;

  // 一般ユーザーが直接URLを叩いたときはトップ（日報作成）へ戻す
  if (!isAdmin(user)) {
    location.replace('report.html');
    return;
  }

  main(user);
}

function main(user) {
  // ---------- DOM ----------
  const messageEl = document.getElementById('admin-message');
  const userTbody = document.getElementById('user-tbody');
  const panels = {
    users: document.getElementById('panel-users'),
    departments: document.getElementById('panel-departments'),
  };

  const deptListEl = document.getElementById('dept-list');
  const deptNameEl = document.getElementById('dept-name');
  const deptAddBtn = document.getElementById('dept-add-btn');
  const deptMessageEl = document.getElementById('dept-message');

  // ---------- 状態 ----------
  let users = [];
  let departments = [];

  function setMessage(text, type) {
    messageEl.textContent = text || '';
    messageEl.className = type ? `message message-${type}` : 'message';
    messageEl.hidden = !text;
  }

  function setDeptMessage(text, type) {
    deptMessageEl.textContent = text || '';
    deptMessageEl.className = type ? `message message-${type}` : 'message';
    deptMessageEl.hidden = !text;
  }

  // その部署に何人いるか。削除可否の判定と一覧の表示で使う
  function memberCount(departmentId) {
    return users.filter((row) => row.department_id === departmentId).length;
  }

  // ============================================================
  // 1. 取得
  // ============================================================
  async function loadAll() {
    if (!isConfigured) {
      setMessage('.env に Supabase の URL とキーを設定してください。', 'error');
      return;
    }

    setMessage('読み込み中...', null);

    const [{ data, error }, departmentRows] = await Promise.all([
      supabase
        .from('users')
        .select('id, name, email, role, department_id, is_frozen, is_hidden')
        .order('name'),
      fetchDepartments(),
    ]);

    if (error) {
      setMessage('ユーザー一覧の取得に失敗しました: ' + error.message, 'error');
      return;
    }

    users = data || [];
    departments = departmentRows;

    renderUsers();
    renderDepartments();
    setMessage(`${users.length}名のユーザーが登録されています。`, null);
  }

  // ============================================================
  // 2. ユーザー管理タブ
  // ============================================================
  function departmentOptions(selectedId) {
    const options = [
      `<option value=""${selectedId ? '' : ' selected'}>未所属</option>`,
    ];
    departments.forEach((row) => {
      options.push(
        `<option value="${escapeHtml(row.id)}"${row.id === selectedId ? ' selected' : ''}>${escapeHtml(row.name)}</option>`
      );
    });
    return options.join('');
  }

  function roleOptions(role) {
    return ROLES.map(
      (item) =>
        `<option value="${item.value}"${item.value === role ? ' selected' : ''}>${escapeHtml(item.label)}</option>`
    ).join('');
  }

  function renderUsers() {
    if (users.length === 0) {
      userTbody.innerHTML =
        '<tr><td colspan="6" class="empty-note">ユーザーがまだ登録されていません。</td></tr>';
      return;
    }

    userTbody.innerHTML = users
      .map((row) => {
        const isSelf = row.id === user.id;
        return `
          <tr data-user="${escapeHtml(row.id)}">
            <td class="admin-name-cell">
              <button type="button" class="linklike" data-action="analyze"
                      title="個人データ分析画面を管理者閲覧モードで開く">${escapeHtml(row.name || '(名前未設定)')}</button>
              <button type="button" class="btn btn-mini" data-action="rename">名前を変更</button>
            </td>
            <td class="admin-email">${escapeHtml(row.email || '—')}</td>
            <td><select class="admin-select" data-action="department" aria-label="所属部署">${departmentOptions(row.department_id)}</select></td>
            <td><select class="admin-select" data-action="role" aria-label="権限">${roleOptions(row.role)}</select></td>
            <td class="admin-status-cell">
              <span class="tag ${row.is_frozen ? 'tag-bad' : 'tag-good'}">${row.is_frozen ? '凍結' : '通常'}</span>
              <select class="admin-select" data-action="visibility" aria-label="過去の日報での表示">
                <option value="visible"${row.is_hidden ? '' : ' selected'}>通常</option>
                <option value="hidden"${row.is_hidden ? ' selected' : ''}>非表示</option>
              </select>
            </td>
            <td class="admin-row-actions">
              <button type="button" class="btn btn-mini" data-action="freeze"${isSelf ? ' disabled' : ''}>
                ${row.is_frozen ? '凍結を解除' : '凍結する'}
              </button>
              <button type="button" class="btn btn-mini btn-danger" data-action="delete"${isSelf ? ' disabled' : ''}>削除</button>
            </td>
          </tr>`;
      })
      .join('');
  }

  // 1件だけ更新して、成功したら手元の配列にも反映する
  async function updateUser(id, patch) {
    const { error } = await supabase.from('users').update(patch).eq('id', id);
    if (error) {
      setMessage('更新に失敗しました: ' + error.message, 'error');
      return false;
    }
    const target = users.find((row) => row.id === id);
    if (target) Object.assign(target, patch);
    return true;
  }

  // 名前セルをその場で入力欄に差し替える
  function startRename(cell, row) {
    cell.innerHTML = `
      <input type="text" class="admin-name-input" value="${escapeHtml(row.name || '')}" maxlength="60" />
      <button type="button" class="btn btn-mini" data-action="rename-save">保存</button>
      <button type="button" class="btn btn-mini" data-action="rename-cancel">取消</button>`;
    const input = cell.querySelector('.admin-name-input');
    input.focus();
    input.select();
  }

  userTbody.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;

    const tr = button.closest('tr[data-user]');
    const id = tr.dataset.user;
    const row = users.find((item) => item.id === id);
    if (!row) return;

    const action = button.dataset.action;

    if (action === 'analyze') {
      // 管理者閲覧モード（読み取り専用）で個人の分析画面を開く
      location.href = `report.html?view=${encodeURIComponent(id)}#dashboard`;
      return;
    }

    if (action === 'rename') {
      startRename(tr.querySelector('.admin-name-cell'), row);
      return;
    }

    if (action === 'rename-cancel') {
      renderUsers();
      return;
    }

    if (action === 'rename-save') {
      const name = tr.querySelector('.admin-name-input').value.trim();
      if (!name) {
        setMessage('名前を入力してください。', 'error');
        return;
      }
      if (await updateUser(id, { name })) {
        renderUsers();
        setMessage('名前を変更しました。', 'success');
      }
      return;
    }

    if (action === 'freeze') {
      const next = !row.is_frozen;
      if (next && !window.confirm(`「${row.name}」を凍結しますか？ログインできなくなります。`)) return;
      if (await updateUser(id, { is_frozen: next })) {
        renderUsers();
        setMessage(next ? 'アカウントを凍結しました。' : '凍結を解除しました。', 'success');
      }
      return;
    }

    if (action === 'delete') {
      if (
        !window.confirm(
          `「${row.name}」のアカウントを削除します。\n` +
            'このユーザーの日報・数値項目・メモもすべて消え、元に戻せません。よろしいですか？'
        )
      ) {
        return;
      }

      // auth 側のログイン情報まで消す必要があるので、SQL側の関数を呼ぶ
      const { error } = await supabase.rpc('admin_delete_user', { target_id: id });
      if (error) {
        setMessage('削除に失敗しました: ' + error.message, 'error');
        return;
      }

      showToast('アカウントを削除しました');
      await loadAll();
    }
  });

  userTbody.addEventListener('change', async (event) => {
    const select = event.target.closest('select[data-action]');
    if (!select) return;

    const tr = select.closest('tr[data-user]');
    const id = tr.dataset.user;
    const row = users.find((item) => item.id === id);
    if (!row) return;

    if (select.dataset.action === 'department') {
      const next = select.value || null;
      if (await updateUser(id, { department_id: next })) {
        renderDepartments(); // 在籍者数の表示を更新する
        setMessage('所属部署を変更しました。', 'success');
      } else {
        select.value = row.department_id || '';
      }
      return;
    }

    // 過去の日報での表示。非表示にすると、対象ユーザーの選択肢からも
    // 「全社 / 全員」の一覧からも、その人の日報が出なくなる
    if (select.dataset.action === 'visibility') {
      const next = select.value === 'hidden';
      if (await updateUser(id, { is_hidden: next })) {
        setMessage(
          next
            ? `「${row.name}」を過去の日報に表示しないようにしました。`
            : `「${row.name}」を過去の日報に表示するようにしました。`,
          'success'
        );
      } else {
        select.value = row.is_hidden ? 'hidden' : 'visible';
      }
      return;
    }

    // 権限。自分を管理者から降ろすとこの画面に入れなくなるので、一度確認する
    const nextRole = select.value;
    if (
      id === user.id &&
      nextRole !== 'admin' &&
      !window.confirm('自分の権限を下げると管理者画面に入れなくなります。よろしいですか？')
    ) {
      select.value = row.role;
      return;
    }

    if (await updateUser(id, { role: nextRole })) {
      setMessage(`権限を「${roleLabel(nextRole)}」に変更しました。`, 'success');
    } else {
      select.value = row.role;
    }
  });

  // ============================================================
  // 3. 部署管理タブ
  // ============================================================
  function renderDepartments() {
    if (departments.length === 0) {
      deptListEl.innerHTML = '<li class="empty-note">部署がまだ登録されていません。</li>';
      return;
    }

    deptListEl.innerHTML = departments
      .map((row) => {
        const count = memberCount(row.id);
        return `
          <li class="dept-item" data-dept="${escapeHtml(row.id)}">
            <input type="text" class="dept-input" value="${escapeHtml(row.name)}" maxlength="40" aria-label="部署名" />
            <span class="dept-count">${count}名</span>
            <button type="button" class="btn btn-mini" data-action="save">保存</button>
            <button type="button" class="btn btn-mini btn-danger" data-action="delete">削除</button>
          </li>`;
      })
      .join('');
  }

  deptNameEl.addEventListener('input', () => {
    deptAddBtn.disabled = deptNameEl.value.trim() === '';
  });

  deptAddBtn.addEventListener('click', async () => {
    const name = deptNameEl.value.trim();
    if (!name) return;

    deptAddBtn.disabled = true;
    setDeptMessage('追加中...', null);

    const { error } = await supabase.from('departments').insert({ name });
    if (error) {
      // name は unique なので、同名の登録はここで弾かれる
      setDeptMessage(
        /duplicate key|unique/i.test(error.message)
          ? `「${name}」はすでに登録されています。`
          : '追加に失敗しました: ' + error.message,
        'error'
      );
      deptAddBtn.disabled = false;
      return;
    }

    deptNameEl.value = '';
    departments = await fetchDepartments();
    renderDepartments();
    setDeptMessage(`「${name}」を追加しました。`, 'success');
  });

  deptListEl.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;

    const li = button.closest('li[data-dept]');
    const id = li.dataset.dept;
    const row = departments.find((item) => item.id === id);
    if (!row) return;

    if (button.dataset.action === 'save') {
      const name = li.querySelector('.dept-input').value.trim();
      if (!name) {
        setDeptMessage('部署名を入力してください。', 'error');
        return;
      }
      if (name === row.name) {
        setDeptMessage('変更がありません。', null);
        return;
      }

      const { error } = await supabase.from('departments').update({ name }).eq('id', id);
      if (error) {
        setDeptMessage(
          /duplicate key|unique/i.test(error.message)
            ? `「${name}」はすでに登録されています。`
            : '変更に失敗しました: ' + error.message,
          'error'
        );
        return;
      }

      row.name = name;
      renderDepartments();
      renderUsers(); // ドロップダウンの表示名も追従させる
      setDeptMessage('部署名を変更しました。', 'success');
      return;
    }

    // 削除。在籍者がいる間はブロックする（DB側は on delete set null なので、
    // ここで止めないと黙って全員が未所属になってしまう）
    const count = memberCount(id);
    if (count > 0) {
      setDeptMessage(
        `${count}名のユーザーが所属中のため削除できません。先に所属を変更してください`,
        'error'
      );
      return;
    }

    if (!window.confirm(`「${row.name}」を削除しますか？`)) return;

    const { error } = await supabase.from('departments').delete().eq('id', id);
    if (error) {
      setDeptMessage('削除に失敗しました: ' + error.message, 'error');
      return;
    }

    departments = departments.filter((item) => item.id !== id);
    renderDepartments();
    renderUsers();
    setDeptMessage(`「${row.name}」を削除しました。`, 'success');
  });

  // ============================================================
  // 4. タブ切り替え
  // ============================================================
  document.querySelectorAll('.admin-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      document.querySelectorAll('.admin-tab').forEach((item) => {
        const active = item === tab;
        item.classList.toggle('is-active', active);
        item.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      Object.entries(panels).forEach(([key, panel]) => {
        panel.hidden = key !== target;
      });
    });
  });

  // ============================================================
  // 5. 初期化
  // ============================================================
  setActiveNav('admin');
  document.getElementById('user-name').textContent = user.name;
  document.getElementById('logout-btn').addEventListener('click', signOut);

  setDeptMessage('', null);
  loadAll();
}
