// 画面をまたいで使う小さなヘルパー

// HTMLに文字列を差し込む前にエスケープする（入力にタグが含まれても壊れないように）
export function escapeHtml(text) {
  return String(text ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

export function formatDateTime(isoString) {
  return new Date(isoString).toLocaleString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  });
}

// 'YYYY-MM-DD' を表示用に整形する。
// new Date('YYYY-MM-DD') はUTC解釈になるため、ずれないよう数値で組み立てる
export function formatYmd(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  });
}

// 'YYYY-MM-DD' → '2026/08/18'。チャットへ貼る前提の短い表記
export function formatYmdSlash(ymd) {
  const [y, m, d] = String(ymd).split('-');
  return `${y}/${m}/${d}`;
}

// 会社のバリュー（PMV自己評価の項目）
export const PMV_VALUES = [
  '常に越えようとする',
  '圧倒的スピード',
  '価値提供を喜ぶ',
  '自分ごと化',
  'ワクワクできる',
  '人に敬意を持つ',
];

// カスタム数値評価枠で選べる単位
export const METRIC_UNITS = ['件', '回', '社', '人', '時間', '分', '円', '万円', '%', 'pt'];

// ============================================================
// テキストエリアの自動拡張
//   入力量に合わせて高さを伸ばし、枠内スクロールをなくす
// ============================================================
const resizers = new Map();

export function attachAutoResize(textarea) {
  textarea.classList.add('is-autoresize');
  let minHeight = 0; // rows属性ぶんの高さ。これより縮めない

  const resize = () => {
    // 非表示のうちは高さを測れないので触らない（タブ切替時に refresh で追いつく）
    if (textarea.offsetParent === null) return;
    if (!minHeight) minHeight = textarea.offsetHeight;

    textarea.style.height = 'auto';
    const frame = textarea.offsetHeight - textarea.clientHeight; // 枠線ぶん
    textarea.style.height = `${Math.max(minHeight, textarea.scrollHeight + frame)}px`;
  };

  textarea.addEventListener('input', resize);
  resizers.set(textarea, resize);
  resize();
}

// 値をJSで入れ直したときや、隠れていた画面を表示したときに高さを合わせ直す
export function refreshAutoResize() {
  resizers.forEach((resize) => resize());
}

// ============================================================
// タスク達成の集計
//   達成 = 1 / 一部達成 = 0.5 / 未達成 = 0 として数える
//   （進捗を達成率に反映させ、推移グラフが滞りにくいようにするため）
//
//   「中止」は“やらないと決めた”タスクなので、分母から丸ごと外す。
//   達成率を下げも上げもしない扱いにする。
// ============================================================
export const CANCELLED = '中止';
export const ACHIEVEMENTS = ['達成', '一部達成', '未達成', CANCELLED];

const ACHIEVEMENT_WEIGHT = { 達成: 1, 一部達成: 0.5, 未達成: 0 };

export function summarizeTasks(reviews) {
  const all = reviews || [];
  const counts = { 達成: 0, 一部達成: 0, 未達成: 0, [CANCELLED]: 0 };
  let score = 0;

  all.forEach((row) => {
    if (row.achievement in counts) counts[row.achievement] += 1;
  });

  // 中止の行は集計対象から除く（未評価の行は「残りいくつ」を出すため分母に残す）
  const rows = all.filter((row) => row.achievement !== CANCELLED);
  rows.forEach((row) => {
    score += ACHIEVEMENT_WEIGHT[row.achievement] ?? 0;
  });

  return {
    total: rows.length,
    score, // 重み付けした達成数（例: 4.5）
    counts,
    cancelled: counts[CANCELLED],
    rate: rows.length > 0 ? score / rows.length : null,
  };
}

// 4.5 → '4.5' / 4 → '4' のように、余計な .0 を出さない
export function trimDecimal(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

// ============================================================
// 階層つき箇条書きのパース
// ============================================================

const INDENT_UNIT = '　'; // 1段 = 全角スペース1つ
const LEADING_SPACE_RE = /^[　\t ]*/;
const BULLET_RE = /^[・\-*＊•‣▪>＞→⇒]+[ 　]*/;

// 行頭の空白から「何段目か」を数える。
// 全角スペース／タブを1段、半角スペース2つを1段として扱う（手打ちの揺れを吸収するため）
function indentDepth(leadingSpace) {
  let halfWidths = 0;
  for (const ch of leadingSpace) {
    halfWidths += ch === ' ' ? 1 : 2;
  }
  return Math.floor(halfWidths / 2);
}

// 1行から「インデント段数」と「記号を外した本文」を取り出す
export function parseIndentedLine(rawLine) {
  const leading = rawLine.match(LEADING_SPACE_RE)[0];
  return {
    depth: indentDepth(leading),
    text: rawLine.slice(leading.length).replace(BULLET_RE, '').trim(),
  };
}

// 宣言テキストを階層つきの行配列にする。
// isParent = 次の行が自分より深い（＝子を持つ見出し行）。false の行が「末端タスク」。
export function parseCommitmentLines(text) {
  const rows = String(text || '')
    .split('\n')
    .map(parseIndentedLine)
    .filter((row) => row.text !== '');

  return rows.map((row, i) => ({
    ...row,
    isParent: i + 1 < rows.length && rows[i + 1].depth > row.depth,
  }));
}

// ============================================================
// 階層的箇条書きの入力アシスト
//   Enter               … 現在行のインデントを維持して「・」を挿入
//   Shift+Enter         … 1段深いインデントにして「・」を挿入
//   中身のない「・」行で Enter … 改行せず1段浅くする（最上段なら「・」を外して箇条書きを抜ける）
//   フォーカス時         … 空の入力欄なら先頭に「・」を置く
// ============================================================
const BULLET = '・';
const EMPTY_BULLET_RE = /^([　\t ]*)・[ 　]*$/; // インデント＋「・」だけの行

// インデントを1段浅くする（全角スペース/タブは1文字、半角スペースは2文字ぶん）
function outdentOnce(indent) {
  if (indent.endsWith('　') || indent.endsWith('\t')) return indent.slice(0, -1);
  if (indent.endsWith('  ')) return indent.slice(0, -2);
  if (indent.endsWith(' ')) return indent.slice(0, -1);
  return '';
}

// 中身のない「・」だけの行を取り除く。
// フォーカスで自動挿入した「・」が、そのまま本文として保存されるのを防ぐ
export function cleanBulletText(text) {
  return String(text || '')
    .split('\n')
    .filter((line) => !EMPTY_BULLET_RE.test(line))
    .join('\n')
    .trim();
}

export function attachBulletAssist(textarea) {
  // 枠をクリックした時点で空なら「・」を置き、すぐ書き始められるようにする
  textarea.addEventListener('focus', () => {
    if (textarea.value !== '') return;
    textarea.value = BULLET;
    textarea.setSelectionRange(BULLET.length, BULLET.length);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // 「・」だけ残して離れたら空に戻す（必須チェックが誤って通らないように）
  textarea.addEventListener('blur', () => {
    if (cleanBulletText(textarea.value) !== '') return;
    textarea.value = '';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });

  textarea.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    // 日本語変換の確定Enterでは発火させない（変換のたびに改行されてしまうため）
    if (event.isComposing || event.keyCode === 229) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    const { selectionStart, selectionEnd, value } = textarea;
    const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
    const lineBreak = value.indexOf('\n', selectionStart);
    const lineEnd = lineBreak === -1 ? value.length : lineBreak;
    const emptyBullet = value.slice(lineStart, lineEnd).match(EMPTY_BULLET_RE);

    // 何も書かずにEnterを続けた場合：改行せず、その行の階層だけを1段動かす
    if (emptyBullet) {
      event.preventDefault();
      const indent = emptyBullet[1];
      // 最上段で「・」だけの行なら、記号を消して箇条書きを抜ける
      const replacement =
        !event.shiftKey && indent === ''
          ? ''
          : (event.shiftKey ? indent + INDENT_UNIT : outdentOnce(indent)) + BULLET;

      textarea.setRangeText(replacement, lineStart, lineEnd, 'end');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    // 箇条書きを抜けた空行では、普通の改行に任せる
    if (value.slice(lineStart, lineEnd).trim() === '') return;

    event.preventDefault();
    const currentIndent = value.slice(lineStart, selectionStart).match(LEADING_SPACE_RE)[0];
    const nextIndent = event.shiftKey ? currentIndent + INDENT_UNIT : currentIndent;

    textarea.setRangeText('\n' + nextIndent + BULLET, selectionStart, selectionEnd, 'end');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
