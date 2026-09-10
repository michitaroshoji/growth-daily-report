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
  canAddChild,
  findTaskPath,
  openAddIdFor,
  removeTask,
  taskLine,
} from './task-tree.js';

const TASK = { major: 'A社対応', middle: '見積', minor: '原価の確認' };
const TASK_LINES = ['・A社対応', '　・見積', '　　・原価の確認'];

test('深さぶんだけ字下げした箇条書きになる', () => {
  assert.equal(taskLine(0, 'A社対応'), '・A社対応');
  assert.equal(taskLine(1, '見積'), '　・見積');
  assert.equal(taskLine(2, '原価の確認'), '　　・原価の確認');
});

test('空欄への差し込みは、大タスクから3階層ぶんを足す', () => {
  assert.equal(appendTaskLine('', TASK), TASK_LINES.join('\n'));
});

test('大タスクだけのときは1行、大＋中のときは2行', () => {
  assert.equal(appendTaskLine('', { major: 'A社対応' }), '・A社対応');
  assert.equal(appendTaskLine('', { major: 'A社対応', middle: '見積' }), '・A社対応\n　・見積');
});

test('登録済みの中タスクの下に、あとから小タスクを足せる', () => {
  assert.equal(
    appendTaskLine('・A社対応\n　・見積', TASK),
    TASK_LINES.join('\n')
  );
});

test('同じ大タスクが既にあれば、その配下に中タスクごと足す', () => {
  assert.equal(
    appendTaskLine(TASK_LINES.join('\n'), { major: 'A社対応', middle: '訪問', minor: '日程調整' }),
    [...TASK_LINES, '　・訪問', '　　・日程調整'].join('\n')
  );
});

test('同じ中タスクが既にあれば、その下に小タスクだけを足す', () => {
  assert.equal(
    appendTaskLine(TASK_LINES.join('\n'), { major: 'A社対応', middle: '見積', minor: '原価の再確認' }),
    [...TASK_LINES, '　　・原価の再確認'].join('\n')
  );
});

test('別の大タスクは、末尾に新しく足す', () => {
  assert.equal(
    appendTaskLine(TASK_LINES.join('\n'), { major: 'B社対応', middle: '請求', minor: '送付' }),
    [...TASK_LINES, '・B社対応', '　・請求', '　　・送付'].join('\n')
  );
});

test('大タスクが途中にあっても、その配下の末尾へ入る', () => {
  const before = [...TASK_LINES, '・B社対応', '　・請求'].join('\n');
  assert.equal(
    appendTaskLine(before, { major: 'A社対応', middle: '訪問', minor: '日程調整' }),
    [...TASK_LINES, '　・訪問', '　　・日程調整', '・B社対応', '　・請求'].join('\n')
  );
});

test('同じ行を二度押しても増えない', () => {
  const once = appendTaskLine('', TASK);
  assert.equal(appendTaskLine(once, TASK), once);
  assert.equal(appendTaskLine(once, { major: 'A社対応' }), once);
  assert.equal(appendTaskLine(once, { major: 'A社対応', middle: '見積' }), once);
});

test('ユーザーが自分で書いた文は消さず、その手前に差し込む', () => {
  const before = [...TASK_LINES, '所感：来週もう一度詰める'].join('\n');
  assert.equal(
    appendTaskLine(before, { major: 'A社対応', middle: '訪問', minor: '日程調整' }),
    [...TASK_LINES, '　・訪問', '　　・日程調整', '所感：来週もう一度詰める'].join('\n')
  );
});

test('先に書かれていた文章は残したまま、末尾に足す', () => {
  assert.equal(appendTaskLine('朝礼に参加した', TASK), ['朝礼に参加した', ...TASK_LINES].join('\n'));
});

test('末尾の空行や、中身のない「・」だけの行は詰めてから足す', () => {
  assert.equal(appendTaskLine('朝礼に参加した\n\n・', TASK), ['朝礼に参加した', ...TASK_LINES].join('\n'));
  assert.equal(appendTaskLine('・', TASK), TASK_LINES.join('\n'));
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

test('登録していない大・中タスクだけが、下の階層を足せる', () => {
  const tree = sampleTree();
  assert.equal(canAddChild(findTaskPath(tree, 1).major), true);
  assert.equal(canAddChild(findTaskPath(tree, 2).middle), true);
});

test('登録したタスクには、もう下の階層を足せない', () => {
  const tree = sampleTree();
  tree[0].registered = true;
  tree[0].children[0].registered = true;
  assert.equal(canAddChild(findTaskPath(tree, 1).major), false);
  assert.equal(canAddChild(findTaskPath(tree, 2).middle), false);
});

test('最下層の小タスクと、消えたあとのタスクには足せない', () => {
  const tree = sampleTree();
  assert.equal(canAddChild(findTaskPath(tree, 3).minor), false);
  assert.equal(canAddChild(null), false);
});

// ---------- 追加欄をどこに開くか ----------

test('「＋中」「＋小」を押した親の追加欄が開く', () => {
  const tree = sampleTree();
  assert.equal(openAddIdFor(tree, 1), 1);
  assert.equal(openAddIdFor(tree, 2), 2);
});

test('登録した行・小タスク・消えた行では開かない', () => {
  const tree = sampleTree();
  tree[0].registered = true;
  assert.equal(openAddIdFor(tree, 1), null); // 登録済みの大タスク
  assert.equal(openAddIdFor(tree, 3), null); // 最下層の小タスク
  assert.equal(openAddIdFor(tree, 99), null); // 消えたあとのタスク
});

test('どこも開いていない状態（null）は、そのまま閉じたまま', () => {
  assert.equal(openAddIdFor(sampleTree(), null), null);
  assert.equal(openAddIdFor(sampleTree(), undefined), null);
});
