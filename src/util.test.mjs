// ============================================================
// 画面共通ヘルパーのテスト
//
//   npm test
//
// DOM や Supabase には触らない、純粋な関数だけを確かめる。
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { departmentName, hiddenMemberIds, visibleMembers } from './util.js';

test('部署が埋め込まれていれば、その名前を返す', () => {
  assert.equal(departmentName({ name: '山田', departments: { name: '営業部' } }), '営業部');
});

test('未所属の人は空文字（一覧では名前だけになる）', () => {
  assert.equal(departmentName({ name: '山田', departments: null }), '');
});

test('部署を一緒に取っていない行でも落ちない', () => {
  assert.equal(departmentName({ name: '山田' }), '');
  assert.equal(departmentName(null), '');
  assert.equal(departmentName(undefined), '');
});

// ---------- 非表示ユーザー（管理画面のステータス） ----------

const MEMBERS = [
  { id: 'u1', name: '山田', is_hidden: false },
  { id: 'u2', name: '鈴木', is_hidden: true },
  { id: 'u3', name: '佐藤' }, // 列が追加される前のデータ（未設定）
  { id: 'u4', name: null }, // 名前がまだ入っていない人
];

test('非表示の人と名前未設定の人は、対象ユーザーの選択肢に出ない', () => {
  assert.deepEqual(
    visibleMembers(MEMBERS).map((row) => row.id),
    ['u1', 'u3']
  );
});

test('自分が非表示にされていても、自分だけは選べる（自分の日報は見られる）', () => {
  assert.deepEqual(
    visibleMembers(MEMBERS, 'u2').map((row) => row.id),
    ['u1', 'u2', 'u3']
  );
  assert.deepEqual(hiddenMemberIds(MEMBERS, 'u2'), []);
});

test('選択肢の組み立ては、ユーザーを取れていなくても落ちない', () => {
  assert.deepEqual(visibleMembers(null), []);
  assert.deepEqual(visibleMembers(undefined), []);
});

test('取得から外すIDは、非表示の人のぶんだけ返る', () => {
  assert.deepEqual(hiddenMemberIds(MEMBERS), ['u2']);
  assert.deepEqual(hiddenMemberIds([]), []);
  assert.deepEqual(hiddenMemberIds(null), []);
});
