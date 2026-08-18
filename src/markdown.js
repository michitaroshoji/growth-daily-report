// ============================================================
// ごく小さなMarkdownレンダラ
//   マニュアル表示だけが用途なので、外部ライブラリは足さない。
//   先にHTMLをエスケープしてから記法を変換するため、
//   本文にタグが混ざっても差し込まれない（管理者しか書けないが念のため）。
// ============================================================
import { escapeHtml } from './util.js';

function inline(text) {
  return text
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    // リンクは http(s) のみ許可する
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

export function renderMarkdown(source) {
  const lines = escapeHtml(source || '').split('\n');
  const html = [];
  let listType = null;

  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  };

  const openList = (type) => {
    if (listType !== type) {
      closeList();
      html.push(`<${type}>`);
      listType = type;
    }
  };

  lines.forEach((line) => {
    const trimmed = line.trim();

    if (trimmed === '') {
      closeList();
      return;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      closeList();
      const level = heading[1].length + 1; // # を h2 から始める
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      return;
    }

    if (/^(---|___|\*\*\*)$/.test(trimmed)) {
      closeList();
      html.push('<hr />');
      return;
    }

    if (/^&gt;\s?/.test(trimmed)) {
      closeList();
      html.push(`<blockquote>${inline(trimmed.replace(/^&gt;\s?/, ''))}</blockquote>`);
      return;
    }

    const ordered = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (ordered) {
      openList('ol');
      html.push(`<li>${inline(ordered[1])}</li>`);
      return;
    }

    const bullet = trimmed.match(/^[-*・]\s*(.*)$/);
    if (bullet) {
      openList('ul');
      html.push(`<li>${inline(bullet[1])}</li>`);
      return;
    }

    closeList();
    html.push(`<p>${inline(trimmed)}</p>`);
  });

  closeList();
  return html.join('\n');
}
