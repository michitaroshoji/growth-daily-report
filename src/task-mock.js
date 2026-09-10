// ============================================================
// タスク管理（3階層）のモック画面
//
//   src/report.html の日報フォームを縮めて写したうえで、
//   「タスク管理」セクションの動きだけを確かめるための画面。
//   Supabase には一切つながず、状態はこのページを閉じると消える。
// ============================================================
import { escapeHtml, attachAutoResize, attachBulletAssist, showToast } from './util.js';
import { appendTaskLine, findTaskPath, removeTask } from './task-tree.js';

const form = document.getElementById('report-form');
const factEl = document.getElementById('fact');
const commitmentEl = document.getElementById('commitment');

const panelEl = document.getElementById('task-panel');
const treeEl = document.getElementById('task-tree');
const emptyEl = document.getElementById('task-empty');
const majorInputEl = document.getElementById('task-major-input');

// ============================================================
// 1. 日報フォーム側（本番と同じ入力の作法をそのまま持ってくる）
// ============================================================
form.querySelectorAll('textarea').forEach(attachAutoResize);
attachBulletAssist(commitmentEl);

// 対象日は今日を入れておく（report.js と同じくローカル時刻で組み立てる）
const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
document.getElementById('report-date').value =
  `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

// 送信はしない。モックで日報が飛ばないようにここで止める
form.addEventListener('submit', (event) => event.preventDefault());

// ---------- Enterキーの扱い（report.js と同じ） ----------
const TEXT_INPUT_TYPES = ['text', 'number', 'date', 'email', 'password', 'search', 'tel', 'url'];

// タスク管理セクションの入力欄は、日報の記入順とは関係ないので移動先から外す。
// これを入れないと「対象日」でEnterを押した先がタスク追加欄になってしまう
function focusableFields() {
  return [...form.querySelectorAll('input, textarea, select, button')].filter(
    (el) => !el.disabled && !panelEl.contains(el) && (el.offsetWidth > 0 || el.offsetHeight > 0)
  );
}

form.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  if (event.isComposing || event.keyCode === 229) return;

  const el = event.target;
  if (el.tagName !== 'INPUT') return;

  event.preventDefault();
  if (!TEXT_INPUT_TYPES.includes(el.type)) return;

  const fields = focusableFields();
  const index = fields.indexOf(el);
  if (index < 0) return; // タスク管理の入力欄はここで抜ける（フォーカスは動かさない）

  const next = fields[index + 1];
  if (next) next.focus();
});

// ============================================================
// 2. タスク管理（使い捨てのState。DBには保存しない）
//    tree = [{ id, name, children: [{ id, name, children: [{ id, name, status }] }] }]
// ============================================================
const tree = [];
let nextId = 1;

// 「＋中タスク」「＋小タスク」で開いている入力欄の親ID。開いていなければ null。
// 同時にひとつだけ開いて、パネルが縦に伸びすぎないようにする
let openAddId = null;

function findPath(id) {
  return findTaskPath(tree, id);
}

function removeNode(id) {
  removeTask(tree, id);
  // 消したタスクの下で開いていた追加欄は、行ごと無くなるので閉じる
  if (openAddId !== null && !findPath(openAddId)) openAddId = null;
}

// ---------- 描画 ----------
function renderTree() {
  treeEl.innerHTML = tree.map(majorHtml).join('');
  emptyEl.hidden = tree.length > 0;

  // 開いている追加欄は、描き直したあとも続けて打てるようにフォーカスを戻す
  const openInput = treeEl.querySelector('[data-add-input]');
  if (openInput) openInput.focus();
}

function majorHtml(major) {
  return `
    <div class="task-group">
      <div class="task-row task-row-major">
        <p class="task-row-text">${escapeHtml(major.name)}</p>
        <button type="button" class="task-icon-btn" data-add="${major.id}">＋中</button>
        <button type="button" class="task-icon-btn is-remove" data-remove="${major.id}"
                aria-label="大タスクを削除">×</button>
      </div>
      ${major.children.map(middleHtml).join('')}
      ${addInputHtml(major.id, '中タスクを追加', false)}
    </div>`;
}

function middleHtml(middle) {
  return `
    <div class="task-row task-row-middle">
      <p class="task-row-text">${escapeHtml(middle.name)}</p>
      <button type="button" class="task-icon-btn" data-add="${middle.id}">＋小</button>
      <button type="button" class="task-icon-btn is-remove" data-remove="${middle.id}"
              aria-label="中タスクを削除">×</button>
    </div>
    ${middle.children.map(minorHtml).join('')}
    ${addInputHtml(middle.id, '小タスクを追加', true)}`;
}

// 最下層のタスクにだけ「完了 / 未達 / 削除」を出す
function minorHtml(minor) {
  const state = minor.status ? ` data-state="${minor.status}"` : '';
  return `
    <div class="task-row task-row-minor is-leaf"${state}>
      <p class="task-row-text">${escapeHtml(minor.name)}</p>
      <div class="seg" role="group" aria-label="タスクの操作">
        <button type="button" class="seg-btn" data-act="done" data-task="${minor.id}">完了</button>
        <button type="button" class="seg-btn" data-act="miss" data-task="${minor.id}">未達</button>
        <button type="button" class="seg-btn" data-act="remove" data-task="${minor.id}">削除</button>
      </div>
    </div>`;
}

function addInputHtml(parentId, placeholder, isMinor) {
  if (openAddId !== parentId) return '';
  return `
    <div class="task-add task-add-child${isMinor ? ' is-minor' : ''}">
      <input type="text" data-add-input="${parentId}" placeholder="${placeholder}" maxlength="60" />
      <button type="button" class="btn btn-mini" data-add-commit="${parentId}">追加</button>
    </div>`;
}

// ---------- 追加 ----------
function addMajor() {
  const name = majorInputEl.value.trim();
  if (!name) return;

  const major = { id: nextId, name, children: [] };
  nextId += 1;
  tree.push(major);
  majorInputEl.value = '';

  // 大タスクだけでは日報に書き出せないので、続けて中タスクを打てるようにしておく
  openAddId = major.id;
  renderTree();
}

function addChild(parentId) {
  const input = treeEl.querySelector(`[data-add-input="${parentId}"]`);
  if (!input) return;

  const name = input.value.trim();
  if (!name) return;

  const path = findPath(parentId);
  if (!path) return;

  // 中タスクの下は最下層なので、それ以上の子は持たせない
  const child = path.middle ? { id: nextId, name } : { id: nextId, name, children: [] };
  (path.middle || path.major).children.push(child);
  nextId += 1;
  renderTree(); // 入力欄は開いたまま。同じ階層を続けて足せる
}

// ---------- 完了 / 未達 / 削除 ----------
// 完了 → 「1. 業務実績」、未達 → 「4. 次回の宣言」へ、大タスクを見出しにして書き出す。
// 押し間違えたときは、テキストエリアの文字を手で消してもらう（自動での取り消しはしない）
function runLeafAction(id, act) {
  const path = findPath(id);
  if (!path || !path.minor) return;

  if (act === 'remove') {
    removeNode(id);
    renderTree();
    return;
  }

  const done = act === 'done';
  const target = done ? factEl : commitmentEl;
  const task = { major: path.major.name, middle: path.middle.name, minor: path.minor.name };

  target.value = appendTaskLine(target.value, task);
  target.dispatchEvent(new Event('input', { bubbles: true })); // 自動リサイズを追従させる

  path.minor.status = done ? '完了' : '未達';
  renderTree();
  showToast(done ? '「1. 業務実績」へ書き出しました' : '「4. 次回の宣言」へ書き出しました');
}

// ---------- 操作の受け口 ----------
majorInputEl.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return;
  addMajor();
});

document.getElementById('task-major-add').addEventListener('click', addMajor);

treeEl.addEventListener('click', (event) => {
  const leafBtn = event.target.closest('.seg-btn[data-act]');
  if (leafBtn) {
    runLeafAction(Number(leafBtn.dataset.task), leafBtn.dataset.act);
    return;
  }

  const addBtn = event.target.closest('[data-add]');
  if (addBtn) {
    const id = Number(addBtn.dataset.add);
    openAddId = openAddId === id ? null : id; // もう一度押したら閉じる
    renderTree();
    return;
  }

  const commitBtn = event.target.closest('[data-add-commit]');
  if (commitBtn) {
    addChild(Number(commitBtn.dataset.addCommit));
    return;
  }

  const removeBtn = event.target.closest('[data-remove]');
  if (removeBtn) {
    removeNode(Number(removeBtn.dataset.remove));
    renderTree();
  }
});

treeEl.addEventListener('keydown', (event) => {
  const input = event.target.closest('[data-add-input]');
  if (!input) return;

  if (event.key === 'Escape') {
    openAddId = null;
    renderTree();
    return;
  }

  if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return;
  addChild(Number(input.dataset.addInput));
});

renderTree();

// ============================================================
// 3. 左の余白へ回り込ませるための高さ合わせ
//    ヘッダーの高さは折り返しで変わるので、CSS変数に流し込む
// ============================================================
const topbarEl = document.querySelector('.topbar');

function syncTopbarHeight() {
  document.documentElement.style.setProperty('--topbar-h', `${topbarEl.offsetHeight}px`);
}

syncTopbarHeight();
window.addEventListener('resize', syncTopbarHeight);
