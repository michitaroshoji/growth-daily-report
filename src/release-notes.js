// ============================================================
// 「バージョンアップ共有」モーダル
//   release_notes テーブルの更新履歴を新しい順に並べる。
//   閲覧は全員（admin / member / restricted）。
//   追加・編集・削除は管理者だけ（DB側もRLSで書き込みを弾いている）。
// ============================================================
import { supabase } from './supabase.js';
import { isAdmin } from './permissions.js';
import { releaseListHtml } from './release-notes-view.js';
import { escapeHtml } from './util.js';

export function setupReleaseNotes(user) {
  const openBtn = document.getElementById('release-btn');
  const modal = document.getElementById('release-modal');
  if (!openBtn || !modal) return;

  const listEl = document.getElementById('release-list');
  const addBtn = document.getElementById('release-add-btn');
  const editor = document.getElementById('release-editor');
  const editorTitle = document.getElementById('release-editor-title');
  const titleInput = document.getElementById('release-title-input');
  const contentInput = document.getElementById('release-content-input');
  const saveBtn = document.getElementById('release-save-btn');
  const cancelBtn = document.getElementById('release-cancel-btn');
  const messageEl = document.getElementById('release-message');

  const admin = isAdmin(user);
  let notes = [];
  let loaded = false;
  let editingId = null; // null = 新規

  function setMessage(text, type) {
    messageEl.textContent = text || '';
    messageEl.className = type ? `message message-${type}` : 'message';
  }

  function renderList() {
    if (notes.length === 0) {
      listEl.innerHTML = '<p class="empty-note">まだお知らせがありません。</p>';
      return;
    }

    listEl.innerHTML = releaseListHtml(notes, { admin });
  }

  // 見出しクリックで本文を開閉する（閲覧者全員が使うので管理者判定より手前に置く）
  function toggleItem(button) {
    const article = button.closest('.release-item');
    const body = article.querySelector('.release-item-body');
    const open = button.getAttribute('aria-expanded') === 'true';

    button.setAttribute('aria-expanded', String(!open));
    body.hidden = open;
  }

  // 一覧と編集欄は入れ替えで出す。両方出すとモーダルが縦に伸びすぎる
  function showEditor(on) {
    editor.hidden = !on;
    listEl.hidden = on;
    addBtn.hidden = on || !admin;
  }

  async function load() {
    if (loaded) return;

    const { data, error } = await supabase
      .from('release_notes')
      .select('id, title, content, created_at')
      .order('created_at', { ascending: false });

    if (error) {
      listEl.innerHTML = `<p class="empty-note">読み込みに失敗しました: ${escapeHtml(error.message)}</p>`;
      return;
    }

    notes = data || [];
    loaded = true;
    renderList();
  }

  function openModal() {
    modal.hidden = false;
    // 開いている間は後ろのページを固定する（マニュアルモーダルと同じ理由）
    document.body.classList.add('modal-open');
    setMessage('', null);
    // 追加ボタンは管理者にだけ出す
    addBtn.hidden = !admin;
    showEditor(false);
    load();
  }

  function closeModal() {
    modal.hidden = true;
    document.body.classList.remove('modal-open');
  }

  openBtn.addEventListener('click', openModal);
  document.getElementById('release-close-btn').addEventListener('click', closeModal);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.hidden) closeModal();
  });

  function openEditor(note) {
    editingId = note ? note.id : null;
    editorTitle.textContent = note ? 'お知らせを編集' : '新規お知らせ追加';
    titleInput.value = note ? note.title : '';
    contentInput.value = note ? note.content : '';
    showEditor(true);
    setMessage('本文はMarkdownで書けます（# 見出し / - 箇条書き / **強調**）。', null);
    titleInput.focus();
  }

  addBtn.addEventListener('click', () => openEditor(null));

  cancelBtn.addEventListener('click', () => {
    editingId = null;
    showEditor(false);
    setMessage('', null);
  });

  // 行ごとにボタンを張り直さずに済むよう、一覧側でまとめて拾う
  listEl.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;

    if (button.dataset.action === 'toggle') {
      toggleItem(button);
      return;
    }

    if (!admin) return;

    const id = button.closest('.release-item').dataset.note;
    const note = notes.find((item) => item.id === id);
    if (!note) return;

    if (button.dataset.action === 'edit') {
      openEditor(note);
      return;
    }

    if (!window.confirm(`「${note.title}」を削除しますか？`)) return;

    setMessage('削除中...', null);
    const { error } = await supabase.from('release_notes').delete().eq('id', id);

    if (error) {
      setMessage('削除に失敗しました: ' + error.message, 'error');
      return;
    }

    notes = notes.filter((item) => item.id !== id);
    renderList();
    setMessage('削除しました。', 'success');
  });

  saveBtn.addEventListener('click', async () => {
    const title = titleInput.value.trim();
    const content = contentInput.value.trim();

    if (!title || !content) {
      setMessage('タイトルと本文の両方を入力してください。', 'error');
      return;
    }

    saveBtn.disabled = true;
    setMessage('保存中...', null);

    const query = editingId
      ? supabase.from('release_notes').update({ title, content }).eq('id', editingId)
      : supabase.from('release_notes').insert({ title, content, created_by: user.id });

    const { data, error } = await query.select('id, title, content, created_at').single();

    saveBtn.disabled = false;

    if (error) {
      setMessage('保存に失敗しました: ' + error.message, 'error');
      return;
    }

    if (editingId) {
      notes = notes.map((item) => (item.id === data.id ? data : item));
    } else {
      notes = [data, ...notes]; // 新しい順に並べているので先頭へ
    }

    editingId = null;
    renderList();
    showEditor(false);
    setMessage('保存しました。', 'success');
  });
}
