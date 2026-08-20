// ============================================================
// 「バージョンアップ共有」一覧の組み立て
//   DOM や Supabase に触らない文字列生成だけを置く（テストしやすいように）。
//   最新の1件は開いた状態、それより前は日付と見出しだけの畳んだ状態で出す。
// ============================================================
import { renderMarkdown } from './markdown.js';
import { escapeHtml, formatDateTime } from './util.js';

export function releaseItemHtml(note, { index, admin }) {
  const id = escapeHtml(note.id);
  const open = index === 0; // 先頭＝いちばん新しいお知らせ
  const bodyId = `release-body-${id}`;

  return `
    <article class="release-item" data-note="${id}">
      <p class="release-item-date">${escapeHtml(formatDateTime(note.created_at))}</p>
      <div class="release-item-head">
        <h4 class="release-item-title">
          <button type="button" class="release-item-toggle" data-action="toggle"
                  aria-expanded="${open}" aria-controls="${bodyId}">
            <span class="release-item-caret" aria-hidden="true">▶</span>
            <span>${escapeHtml(note.title)}</span>
          </button>
        </h4>
        ${
          admin
            ? `<div class="release-item-actions">
                 <button type="button" class="btn btn-mini" data-action="edit">編集</button>
                 <button type="button" class="btn btn-mini btn-danger" data-action="delete">削除</button>
               </div>`
            : ''
        }
      </div>
      <div class="release-item-body" id="${bodyId}"${open ? '' : ' hidden'}>${renderMarkdown(note.content)}</div>
    </article>`;
}

export function releaseListHtml(notes, { admin }) {
  return notes.map((note, index) => releaseItemHtml(note, { index, admin })).join('');
}
