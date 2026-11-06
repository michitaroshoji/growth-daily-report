// ============================================================
// 日報入力画面のタスク管理パネルのテスト
//
//   npm test
//
// ブラウザは起動しない。HTML と JS を読んで、崩れると困る前提だけを確かめる。
//   ・「前回のタスクを復元しました」の帯と「タスクを破棄する」ボタンが無いこと
//   ・タスクの追加欄とツリーは残っていること
//   ・大タスクの折りたたみボタンが、並び替えのつまみとぶつからないこと
//   ・大タスクの折りたたみ状態が、タスクと一緒に一時保存されること
//   ・優先度ボタンが、行の枠（.task-row）の外に置かれていること
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

test('大タスクに折りたたみボタンがあり、畳んだ状態を一時保存する', () => {
  assert.ok(js.includes('data-toggle="${major.id}"'));
  assert.ok(js.includes('aria-expanded="${!collapsed}"'));
  // 畳んだ大タスクはタスクと同じキーへ保存し、開き直したときに戻す
  assert.ok(/saveDraft\(TASK_DRAFT_KEY, \{[\s\S]*?collapsed: liveMajorIds\(taskTree, collapsedIds\)/.test(js));
  assert.ok(js.includes('liveMajorIds(taskTree, draft.collapsed)'));
});

test('折りたたみボタンは並び替えのつまみと別の要素になっている', () => {
  // つまみ（draggable）の中に入れると、クリックとドラッグがぶつかる
  const handle = /<span class="task-drag-handle"[\s\S]*?<\/span>/.exec(js);
  assert.ok(handle, '並び替えのつまみが見つからない');
  assert.ok(!handle[0].includes('data-toggle'));
  assert.ok(!/class="task-toggle"[^>]*draggable/.test(js));
});

test('優先度ボタンは行の枠の外（右）にあり、完了 / 未達 / 削除の中に入っていない', () => {
  // 行（.task-row）を閉じたあと、同じ .task-line の中に優先度ボタンを置く
  const lines = js.match(/<div class="task-line">[\s\S]*?<\/div>\s*\$\{taskPriorityHtml\(\w+\)\}\s*<\/div>/g) || [];
  assert.equal(lines.length, 2, '大・中タスクの行と、小タスクの行の2か所');
  const actions = /function taskActionsHtml[\s\S]*?\n  \}/.exec(js);
  assert.ok(actions);
  assert.ok(!actions[0].includes('data-priority'));
});
