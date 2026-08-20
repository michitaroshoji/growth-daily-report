// ============================================================
// バージョンアップ共有の一覧HTMLのテスト
//
//   npm test
//
// DOM や Supabase には触らない、組み立てた文字列だけを確かめる。
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { releaseListHtml } from './release-notes-view.js';

const NOTES = [
  { id: 'n1', title: '最新のお知らせ', content: '本文A', created_at: '2026-08-20T01:00:00Z' },
  { id: 'n2', title: '過去のお知らせ', content: '本文B', created_at: '2026-08-10T01:00:00Z' },
];

function itemOf(html, id) {
  return html.split('<article class="release-item"').find((part) => part.includes(`data-note="${id}"`));
}

test('最新の1件は開いた状態で出る', () => {
  const first = itemOf(releaseListHtml(NOTES, { admin: false }), 'n1');
  assert.match(first, /aria-expanded="true"/);
  assert.match(first, /<div class="release-item-body" id="release-body-n1"><p>本文A<\/p>/);
});

test('2件目以降は畳んだ状態で、日付と見出しだけが出る', () => {
  const second = itemOf(releaseListHtml(NOTES, { admin: false }), 'n2');
  assert.match(second, /aria-expanded="false"/);
  assert.match(second, /<div class="release-item-body" id="release-body-n2" hidden>/);
  assert.match(second, /過去のお知らせ/);
  assert.match(second, /class="release-item-date">2026年/);
});

test('見出しは開閉ボタンになっていて、本文と紐づいている', () => {
  const first = itemOf(releaseListHtml(NOTES, { admin: false }), 'n1');
  assert.match(first, /data-action="toggle"/);
  assert.match(first, /aria-controls="release-body-n1"/);
});

test('編集・削除は管理者のときだけヘッダーに出る', () => {
  const forAdmin = releaseListHtml(NOTES, { admin: true });
  assert.match(forAdmin, /data-action="edit"/);
  assert.match(forAdmin, /data-action="delete"/);

  const forMember = releaseListHtml(NOTES, { admin: false });
  assert.doesNotMatch(forMember, /data-action="edit"/);
  assert.doesNotMatch(forMember, /data-action="delete"/);
});

test('タイトルにタグが混ざっても差し込まれない', () => {
  const html = releaseListHtml([{ ...NOTES[0], title: '<img src=x onerror=alert(1)>' }], {
    admin: false,
  });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});
