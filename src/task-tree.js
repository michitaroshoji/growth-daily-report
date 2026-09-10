// ============================================================
// タスク管理（3階層）のデータ操作と、日報テキストへの差し込み
//
//   ツリーの形:
//     [{ id, name, children: [{ id, name, children: [{ id, name, status }] }] }]
//
//   日報へ書き出す形:
//     ■ {大タスク}
//     　・{中タスク}：{小タスク}
//
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

const MAJOR_MARK = '■';
const CHILD_MARK = '・';
const INDENT_UNIT = '　'; // util.js の階層つき箇条書きと同じ「全角スペース1つ」
const CHILD_SEPARATOR = '：';

const MAJOR_LINE_RE = /^[　\t ]*■[ 　]*(.*?)[ 　]*$/;
const CHILD_LINE_RE = /^[　\t ]*・/;
const BLANK_LINE_RE = /^[　\t ]*(・[ 　]*)?$/; // 空行と、中身のない「・」だけの行

// 大タスクの見出し行
export function majorHeadingLine(major) {
  return `${MAJOR_MARK} ${String(major).trim()}`;
}

// 見出しにぶら下げる1行。小タスクが無い（中タスクが末端）ときは中タスク名だけ
export function taskChildLine(middle, minor) {
  const middleText = String(middle ?? '').trim();
  const minorText = String(minor ?? '').trim();
  const body = minorText ? `${middleText}${CHILD_SEPARATOR}${minorText}` : middleText;
  return `${INDENT_UNIT}${CHILD_MARK}${body}`;
}

// 見出し行なら大タスク名を返す。見出し行でなければ null
function majorOf(line) {
  const match = String(line).match(MAJOR_LINE_RE);
  return match ? match[1] : null;
}

// 末尾の空行（フォーカスで自動挿入された「・」だけの行を含む）を落とす
function dropTrailingBlank(lines) {
  const body = [...lines];
  while (body.length > 0 && BLANK_LINE_RE.test(body[body.length - 1])) body.pop();
  return body;
}

// text に task（{ major, middle, minor }）を1行ぶん差し込んだ文字列を返す。
// 元の text は書き換えない
export function appendTaskLine(text, task) {
  const major = String(task.major ?? '').trim();
  const child = taskChildLine(task.middle, task.minor);
  const lines = String(text ?? '').split('\n');
  const headIndex = lines.findIndex((line) => majorOf(line) === major);

  // 見出しがまだ無い：末尾の空行を落としてから、見出しごと足す
  if (headIndex < 0) {
    return [...dropTrailingBlank(lines), majorHeadingLine(major), child].join('\n');
  }

  // 見出しの直後に続く子行のうち、いちばん最後の次へ差し込む。
  // 子行でない行（ユーザーが自分で書いた文）が来たらそこで止める
  let end = headIndex + 1;
  while (end < lines.length && CHILD_LINE_RE.test(lines[end])) end += 1;

  // まったく同じ行が既にあるなら二重には足さない
  if (lines.slice(headIndex + 1, end).some((line) => line.trim() === child.trim())) {
    return String(text ?? '');
  }

  return [...lines.slice(0, end), child, ...lines.slice(end)].join('\n');
}
