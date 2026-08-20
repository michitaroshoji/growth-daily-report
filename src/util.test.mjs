// ============================================================
// 画面共通ヘルパーのテスト
//
//   npm test
//
// DOM や Supabase には触らない、純粋な関数だけを確かめる。
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { departmentName } from './util.js';

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
