// ============================================================
// 日報入力画面のタスク管理パネルのテスト
//
//   npm test
//
// ブラウザは起動しない。HTML と JS を読んで、崩れると困る前提だけを確かめる。
//   ・「前回のタスクを復元しました」の帯と「タスクを破棄する」ボタンが無いこと
//   ・タスクの追加欄とツリーは残っていること
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(SRC, 'report.html'), 'utf8');
const js = readFileSync(join(SRC, 'report.js'), 'utf8');

// <section id="task-panel"> の中身だけを取り出す
function taskPanel(text) {
  const m = /<section[^>]*id="task-panel"[^>]*>([\s\S]*?)<\/section>/.exec(text);
  assert.ok(m, 'タスク管理パネルが見つからない');
  return m[1];
}

test('タスク管理に復元の帯と破棄ボタンが出ない', () => {
  const panel = taskPanel(html);
  assert.ok(!panel.includes('task-draft-banner'));
  assert.ok(!panel.includes('task-draft-discard'));
  assert.ok(!panel.includes('タスクを破棄する'));
});

test('report.js が消した帯・ボタンを参照していない', () => {
  // 要素が無いのに getElementById で掴むと、画面の初期化ごと止まる
  assert.ok(!js.includes('task-draft-banner'));
  assert.ok(!js.includes('task-draft-discard'));
  assert.ok(!js.includes('前回のタスクを復元しました'));
});

test('タスクの追加欄とツリーは残っている', () => {
  const panel = taskPanel(html);
  assert.ok(panel.includes('id="task-major-input"'));
  assert.ok(panel.includes('id="task-major-add"'));
  assert.ok(panel.includes('id="task-tree"'));
});
