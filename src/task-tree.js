// ============================================================
// タスク管理（3階層）のデータ操作と、日報テキストへの差し込み
//
//   ツリーの形:
//     [{ id, name, registered, status, children: [{ ... , children: [{ ... }] }] }]
//
//   日報へ書き出す形（インデント1段 = 全角スペース1つ）:
//     ・{大タスク}
//     　・{中タスク}
//     　　・{小タスク}
//
//   翌日の「0. 前回の振り返り」は、この形をそのまま階層として読み直す（util.js）。
//   DOM や Supabase には触らない。画面の組み立ては report.js の担当。
// ============================================================

// ============================================================
// ツリーの操作
// ============================================================

// id がツリーのどこにあるかを { major, middle, minor } で返す。
// 大タスクなら major だけ、中タスクなら major+middle、と深さぶんだけ埋まる。
// 見つからなければ null
export function findTaskPath(tree, id) {
  for (const major of tree) {
    if (major.id === id) return { major };
    for (const middle of major.children) {
      if (middle.id === id) return { major, middle };
      for (const minor of middle.children) {
        if (minor.id === id) return { major, middle, minor };
      }
    }
  }
  return null;
}

// id のタスクを（子ごと）ツリーから取り除く。取り除けたら true
export function removeTask(tree, id) {
  const path = findTaskPath(tree, id);
  if (!path) return false;

  const target = path.minor || path.middle || path.major;
  const siblings = path.minor ? path.middle.children : path.middle ? path.major.children : tree;
  siblings.splice(siblings.indexOf(target), 1);
  return true;
}

// ============================================================
// 日報テキストへの差し込み
// ============================================================

const BULLET_MARK = '・';
const INDENT_UNIT = '　'; // util.js の階層つき箇条書きと同じ「全角スペース1つ」

const BULLET_LINE_RE = /^([　\t ]*)・[ 　]*(.*?)[ 　]*$/;
const BLANK_LINE_RE = /^[　\t ]*(・[ 　]*)?$/; // 空行と、中身のない「・」だけの行

// 深さ（0=大 / 1=中 / 2=小）ぶんだけ字下げした1行
export function taskLine(depth, name) {
  return `${INDENT_UNIT.repeat(depth)}${BULLET_MARK}${String(name ?? '').trim()}`;
}

// 行頭の空白から「何段目か」を数える。
// 全角スペース／タブを1段、半角スペース2つを1段として扱う（util.js と同じ規則）
function indentDepth(leadingSpace) {
  let halfWidths = 0;
  for (const ch of leadingSpace) {
    halfWidths += ch === ' ' ? 1 : 2;
  }
  return Math.floor(halfWidths / 2);
}

// 箇条書きの行なら { depth, text } を返す。箇条書きでなければ null
function bulletRow(line) {
  const match = String(line).match(BULLET_LINE_RE);
  return match ? { depth: indentDepth(match[1]), text: match[2] } : null;
}

// lines[from, to) から「深さ depth の、名前が name の行」を探す。無ければ -1
function findRowIndex(lines, name, depth, from, to) {
  for (let i = from; i < to; i += 1) {
    const row = bulletRow(lines[i]);
    if (row && row.depth === depth && row.text === name) return i;
  }
  return -1;
}

// lines[index] の行にぶら下がる子行がどこで終わるか（その次の行番号）を返す。
// 同じ深さ以下の箇条書き（＝次の兄弟）か、箇条書きでない行（ユーザーが書いた文）で止まる
function blockEnd(lines, index, depth) {
  let end = index + 1;
  while (end < lines.length) {
    const row = bulletRow(lines[end]);
    if (!row || row.depth <= depth) break;
    end += 1;
  }
  return end;
}

// 末尾の空行（フォーカスで自動挿入された「・」だけの行を含む）を落とす
function dropTrailingBlank(lines) {
  const body = [...lines];
  while (body.length > 0 && BLANK_LINE_RE.test(body[body.length - 1])) body.pop();
  return body;
}

// text に task（{ major, middle, minor }）を差し込んだ文字列を返す。
// 上の階層から順にたどり、既にある行はそのまま使って、足りない階層だけを足す。
// 元の text は書き換えない
export function appendTaskLine(text, task) {
  // 名前が空になった時点で打ち切る（大だけ／大＋中／大＋中＋小 の3通り）
  const names = [];
  for (const raw of [task.major, task.middle, task.minor]) {
    const name = String(raw ?? '').trim();
    if (!name) break;
    names.push(name);
  }

  const lines = String(text ?? '').split('\n');
  if (names.length === 0) return lines.join('\n');

  // たどれるところまでたどる。found = 既にある階層の数、end = そこへ足すときの差し込み位置
  let found = 0;
  let from = 0;
  let end = lines.length;
  while (found < names.length) {
    const index = findRowIndex(lines, names[found], found, from, end);
    if (index < 0) break;
    from = index + 1;
    end = blockEnd(lines, index, found);
    found += 1;
  }

  // まったく同じ行が既にあるなら二重には足さない
  if (found === names.length) return lines.join('\n');

  const added = names.slice(found).map((name, i) => taskLine(found + i, name));

  // 大タスクの見出しがまだ無い：末尾の空行を落としてから、見出しごと足す
  if (found === 0) return [...dropTrailingBlank(lines), ...added].join('\n');

  return [...lines.slice(0, end), ...added, ...lines.slice(end)].join('\n');
}
