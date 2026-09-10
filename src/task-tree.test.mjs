// ============================================================
// タスク管理から日報テキストへ差し込む処理のテスト
//
//   npm test
//
// DOM や Supabase には触らない、組み立てた文字列だけを確かめる。
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  appendTaskLine,
  findTaskPath,
  majorHeadingLine,
  removeTask,
  taskChildLine,
} from './task-tree.js';

const TASK = { major: 'A社対応', middle: '見積', minor: '原価の確認' };

test('見出しと子行の形', () => {
  assert.equal(majorHeadingLine('A社対応'), '■ A社対応');
  assert.equal(taskChildLine('見積', '原価の確認'), '　・見積：原価の確認');
});

test('小タスクが無いときは中タスク名だけがぶら下がる', () => {
  assert.equal(taskChildLine('見積', ''), '　・見積');
  assert.equal(taskChildLine('見積', null), '　・見積');
});

test('空欄への差し込みは、見出しごと新しく足す', () => {
  assert.equal(appendTaskLine('', TASK), '■ A社対応\n　・見積：原価の確認');
});

test('同じ大タスクの見出しが既にあれば、その下に子行だけを足す', () => {
  const before = '■ A社対応\n　・見積：原価の確認';
  assert.equal(
    appendTaskLine(before, { major: 'A社対応', middle: '訪問', minor: '日程調整' }),
    '■ A社対応\n　・見積：原価の確認\n　・訪問：日程調整'
  );
});

test('別の大タスクは、見出しごと末尾に足す', () => {
  const before = '■ A社対応\n　・見積：原価の確認';
  assert.equal(
    appendTaskLine(before, { major: 'B社対応', middle: '請求', minor: '送付' }),
    '■ A社対応\n　・見積：原価の確認\n■ B社対応\n　・請求：送付'
  );
});

test('見出しが途中にあっても、その見出しの子行の末尾へ入る', () => {
  const before = ['■ A社対応', '　・見積：原価の確認', '■ B社対応', '　・請求：送付'].join('\n');
  assert.equal(
    appendTaskLine(before, { major: 'A社対応', middle: '訪問', minor: '日程調整' }),
    ['■ A社対応', '　・見積：原価の確認', '　・訪問：日程調整', '■ B社対応', '　・請求：送付'].join('\n')
  );
});

test('同じ行を二度押しても増えない', () => {
  const once = appendTaskLine('', TASK);
  assert.equal(appendTaskLine(once, TASK), once);
});

test('ユーザーが自分で書いた文は消さず、その手前に差し込む', () => {
  const before = ['■ A社対応', '　・見積：原価の確認', '所感：来週もう一度詰める'].join('\n');
  assert.equal(
    appendTaskLine(before, { major: 'A社対応', middle: '訪問', minor: '日程調整' }),
    ['■ A社対応', '　・見積：原価の確認', '　・訪問：日程調整', '所感：来週もう一度詰める'].join('\n')
  );
});

test('先に書かれていた文章は残したまま、末尾に見出しを足す', () => {
  assert.equal(appendTaskLine('朝礼に参加した', TASK), '朝礼に参加した\n■ A社対応\n　・見積：原価の確認');
});

test('末尾の空行や、中身のない「・」だけの行は詰めてから足す', () => {
  assert.equal(appendTaskLine('朝礼に参加した\n\n・', TASK), '朝礼に参加した\n■ A社対応\n　・見積：原価の確認');
  assert.equal(appendTaskLine('・', TASK), '■ A社対応\n　・見積：原価の確認');
});

// ---------- ツリーの操作 ----------

function sampleTree() {
  return [
    {
      id: 1,
      name: 'A社対応',
      children: [
        { id: 2, name: '見積', children: [{ id: 3, name: '原価の確認' }] },
        { id: 4, name: '訪問', children: [] },
      ],
    },
    { id: 5, name: 'B社対応', children: [] },
  ];
}

test('idの居場所が、深さぶんだけ埋まって返る', () => {
  const tree = sampleTree();
  assert.deepEqual(Object.keys(findTaskPath(tree, 1)), ['major']);
  assert.deepEqual(Object.keys(findTaskPath(tree, 2)), ['major', 'middle']);

  const leaf = findTaskPath(tree, 3);
  assert.equal(leaf.major.name, 'A社対応');
  assert.equal(leaf.middle.name, '見積');
  assert.equal(leaf.minor.name, '原価の確認');
});

test('見つからないidは null（消したあとのボタンを押しても落ちない）', () => {
  assert.equal(findTaskPath(sampleTree(), 99), null);
  assert.equal(removeTask(sampleTree(), 99), false);
});

test('小タスクを消しても、親の中タスクは残る', () => {
  const tree = sampleTree();
  assert.equal(removeTask(tree, 3), true);
  assert.deepEqual(tree[0].children[0].children, []);
  assert.equal(tree[0].children.length, 2);
});

test('中タスクを消すと、その下の小タスクごと消える', () => {
  const tree = sampleTree();
  removeTask(tree, 2);
  assert.deepEqual(
    tree[0].children.map((row) => row.name),
    ['訪問']
  );
  assert.equal(findTaskPath(tree, 3), null);
});

test('大タスクを消すと、そのグループだけが消える', () => {
  const tree = sampleTree();
  removeTask(tree, 1);
  assert.deepEqual(
    tree.map((row) => row.name),
    ['B社対応']
  );
});
