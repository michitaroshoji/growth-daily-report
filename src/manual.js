// ============================================================
// 「アプリの使い方」マニュアル
//   本文はハードコードせず Supabase の manuals テーブルから取得する。
//   管理者のときだけ、その場で書き換えて保存できる。
// ============================================================
import { supabase } from './supabase.js';
import { isAdmin } from './permissions.js';
import { renderMarkdown } from './markdown.js';
import { escapeHtml, formatDateTime } from './util.js';

const SLUG = 'how-to-use'; // 1画面ぶんなので固定キーで引く

export function setupManual(user) {
  const openBtn = document.getElementById('manual-btn');
  const modal = document.getElementById('manual-modal');
  if (!openBtn || !modal) return;

  const titleEl = document.getElementById('manual-title');
  const bodyEl = document.getElementById('manual-body');
  const metaEl = document.getElementById('manual-meta');
  const editor = document.getElementById('manual-editor');
  const editorInput = document.getElementById('manual-editor-input');
  const editBtn = document.getElementById('manual-edit-btn');
  const saveBtn = document.getElementById('manual-save-btn');
  const cancelBtn = document.getElementById('manual-cancel-btn');
  const messageEl = document.getElementById('manual-message');

  const admin = isAdmin(user);
  let manual = null;
  let loaded = false;

  function setMessage(text, type) {
    messageEl.textContent = text || '';
    messageEl.className = type ? `message message-${type}` : 'message';
  }

  function renderView() {
    titleEl.textContent = manual ? manual.title : 'アプリの使い方';
    bodyEl.innerHTML = manual
      ? renderMarkdown(manual.body)
      : '<p class="empty-note">まだ内容が登録されていません。</p>';

    metaEl.textContent = manual && manual.updated_at
      ? `最終更新: ${formatDateTime(manual.updated_at)}`
      : '';

    // 編集ボタンは管理者にだけ出す（DB側もRLSで書き込みを弾いている）
    editBtn.hidden = !admin;
  }

  function showEditor(on) {
    editor.hidden = !on;
    bodyEl.hidden = on;
    editBtn.hidden = on || !admin;
    metaEl.hidden = on;
  }

  async function load() {
    if (loaded) return;

    const { data, error } = await supabase
      .from('manuals')
      .select('slug, title, body, updated_at')
      .eq('slug', SLUG)
      .maybeSingle();

    if (error) {
      bodyEl.innerHTML = `<p class="empty-note">読み込みに失敗しました: ${escapeHtml(error.message)}</p>`;
      editBtn.hidden = !admin;
      return;
    }

    manual = data;
    loaded = true;
    renderView();
  }

  function openModal() {
    modal.hidden = false;
    // 開いている間は後ろのページを固定する。
    // そうしないと編集中にホイールを回したとき、モーダルではなく背景が動く
    document.body.classList.add('modal-open');
    setMessage('', null);
    showEditor(false);
    load();
  }

  function closeModal() {
    modal.hidden = true;
    document.body.classList.remove('modal-open');
  }

  openBtn.addEventListener('click', openModal);
  document.getElementById('manual-close-btn').addEventListener('click', closeModal);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.hidden) closeModal();
  });

  editBtn.addEventListener('click', () => {
    editorInput.value = manual ? manual.body : '';
    showEditor(true);
    setMessage('Markdownで書けます（# 見出し / - 箇条書き / **強調**）。', null);
    editorInput.focus();
    // 長い本文だと末尾にカーソルが飛ぶので、先頭から編集できるよう戻す
    editorInput.setSelectionRange(0, 0);
    editorInput.scrollTop = 0;
  });

  cancelBtn.addEventListener('click', () => {
    showEditor(false);
    setMessage('', null);
  });

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    setMessage('保存中...', null);

    // 行がまだ無い場合もあるので upsert にする
    const { data, error } = await supabase
      .from('manuals')
      .upsert(
        {
          slug: SLUG,
          title: manual ? manual.title : 'アプリの使い方',
          body: editorInput.value,
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'slug' }
      )
      .select('slug, title, body, updated_at')
      .single();

    saveBtn.disabled = false;

    if (error) {
      setMessage('保存に失敗しました: ' + error.message, 'error');
      return;
    }

    manual = data;
    renderView();
    showEditor(false);
    setMessage('保存しました。', 'success');
  });
}
