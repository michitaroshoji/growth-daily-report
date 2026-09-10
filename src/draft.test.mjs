// ============================================================
// 下書き（localStorage）の判定まわりのテスト
//
//   npm test
//
// localStorage には触らない、キーの組み立てと「実質空」の判定だけを確かめる。
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { draftKey, taskDraftKey, isDraftEmpty } from './draft.js';

test('タスクのキーは、日報本文の下書きとは別（日報を送信しても消えないように）', () => {
  assert.notEqual(taskDraftKey('u1'), draftKey('u1', null));
  assert.equal(taskDraftKey('u1'), 'gdr_tasks:u1');
  assert.notEqual(taskDraftKey('u1'), taskDraftKey('u2'));
});

test('タスクだけ入っている下書きは「空」ではない（捨てずに復元する）', () => {
  assert.equal(isDraftEmpty({ tasks: [{ id: 1, name: 'A社対応', children: [] }] }), false);
});

test('タスクも本文も無ければ空', () => {
  assert.equal(isDraftEmpty(null), true);
  assert.equal(isDraftEmpty({ fields: { fact: '' }, tasks: [] }), true);
});
