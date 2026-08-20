import { supabase, isConfigured } from './supabase.js';
import { requireUser, signOut } from './session.js';
import { setActiveNav } from './nav.js';
import { resolveViewUser, setupDemoToggle, showDemoBanner } from './demo.js';
import { setupManual } from './manual.js';
import { setupReleaseNotes } from './release-notes.js';
import { canManageReport, canSeeOthers } from './permissions.js';
import { fetchDepartments } from './departments.js';
import { setupProfile } from './profile.js';
import { isAutoMetricVisible } from './settings.js';
import { escapeHtml, formatYmd, PMV_VALUES, summarizeTasks, trimDecimal } from './util.js';

init();

async function init() {
  const user = await requireUser();
  if (user) main(user);
}

function main(user) {
  const listEl = document.getElementById('report-list');
  const message = document.getElementById('message');
  const deptSelect = document.getElementById('dept-select');
  const userSelect = document.getElementById('user-select');
  const searchBox = document.getElementById('search-box');
  const expandBtn = document.getElementById('expand-btn');

  // 「1. 業務実績」が空のときに代わりに出す文言。
  // 数値実績だけで完結した日でも、貼り付けたテキストが空欄にならないようにする
  const FACT_FALLBACK = '（数値実績の業務に集中）';

  // 2段階フィルターの「絞り込まない」を表す値。部署ID・ユーザーIDと衝突しない文字列
  const ALL = 'all';

  let reports = []; // 取得済みの日報（検索はこの配列に対してフロントで行う）
  let viewUser = user; // 「誰のデータを見ているか」。デモモード中は デモ太郎
  let departments = []; // 対象集団（部署）の選択肢
  let members = []; // 対象ユーザーの元になる全ユーザー [{ id, name, department_id }]

  function setMessage(text, type) {
    message.textContent = text || '';
    message.className = type ? `message message-${type}` : 'message';
    message.hidden = !text;
  }

  // ============================================================
  // 検索用ヘルパー
  // ============================================================
  // 日報1件を「検索対象の1本のテキスト」に畳み込む
  function searchableText(report) {
    const parts = [
      report.fact,
      report.problem,
      report.why,
      report.commitment,
      report.action,
      report.insight,
      report.one_word,
      report.users ? report.users.name : '',
      formatYmd(report.report_date),
    ];
    (report.reviews || []).forEach((r) => parts.push(r.line_text, r.reason, r.achievement));
    (report.daily_metrics || []).forEach((m) => parts.push(m.name));
    return parts.filter(Boolean).join('\n').toLowerCase();
  }

  function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // エスケープしてから、検索語だけ <mark> で囲む
  function highlight(text, keyword) {
    const safe = escapeHtml(text);
    if (!keyword) return safe;
    return safe.replace(
      new RegExp(escapeRegExp(escapeHtml(keyword)), 'gi'),
      (hit) => `<mark class="mark">${hit}</mark>`
    );
  }

  // ============================================================
  // 描画
  // ============================================================
  // ============================================================
  // 画面とコピー用HTMLで共有するインラインスタイル
  //   クラス名はクリップボードに乗らない（貼り付け先に style.css は無い）。
  //   LINE WORKS のノートなどへ貼っても色や太さを残したいので、
  //   バッジ・見出し・★の色は style 属性へ直接書く。
  //   ここを直したら screenshot で貼り付け後の見た目も見直すこと。
  // ============================================================
  const HEADING_STYLE =
    'color: #4b5563; font-size: 0.95em; font-weight: bold; margin-top: 16px; margin-bottom: 8px;';

  const BADGE_BASE = 'border-radius: 4px; padding: 2px 8px; font-size: 0.85em; margin-right: 8px;';

  const BADGE_COLOR = {
    達成: 'background-color: #d1fae5; color: #065f46;',
    一部達成: 'background-color: #fef3c7; color: #92400e;',
    未達成: 'background-color: #fee2e2; color: #991b1b;',
    中止: 'background-color: #f3f4f6; color: #374151;',
  };

  // 行ごとの評価が無かった頃の集約表現。同じ色に寄せる
  const BADGE_ALIAS = { 達成できた: '達成', 一部できた: '一部達成', できなかった: '未達成' };

  const REASON_STYLE = 'color: #6b7280; font-size: 0.9em; margin: 2px 0 0 4px;';

  function badgeStyle(value) {
    const key = BADGE_ALIAS[value] || value;
    const color = BADGE_COLOR[key] || 'background-color: #f3f4f6; color: #374151;';
    return `${color} ${BADGE_BASE}`;
  }

  // 改行は <br> に変換して貼り付け先へ持っていく。
  // white-space の指定は貼り付け先で落ちることがあり、落ちると全部1行に潰れてしまう
  function richText(value, keyword) {
    return highlight(value, keyword).replace(/\n/g, '<br>');
  }

  function renderItem(label, value, keyword) {
    if (!value) return '';
    return `
      <div class="report-item">
        <p class="report-item-label" style="${HEADING_STYLE}">${label}</p>
        <p class="report-item-text">${richText(value, keyword)}</p>
      </div>`;
  }

  // 前回宣言の行ごとの振り返り
  function renderReviews(reviews, keyword) {
    if (!reviews || reviews.length === 0) return '';
    // バッジと本文は同じ行に並べたいので、どちらもインライン要素にする。
    // flex に頼ると貼り付け先で解除されて、バッジだけ別の行に落ちてしまう
    const lines = reviews
      .map(
        (r) => `
        <div class="review-line">
          <span style="${badgeStyle(r.achievement)}">${escapeHtml(r.achievement)}</span>
          <span class="review-line-text">${highlight(r.line_text, keyword)}</span>
          ${r.reason ? `<div class="review-line-reason" style="${REASON_STYLE}">${richText(r.reason, keyword)}</div>` : ''}
        </div>`
      )
      .join('');
    return `
      <div class="report-item">
        <p class="report-item-label" style="${HEADING_STYLE}">前回宣言の振り返り</p>
        ${lines}
      </div>`;
  }

  // 2行目に置くカスタム数値実績。
  //   例) 📊 集中作業時間: 230分 ／ コール件数: 24件
  // 画面と貼り付け結果を一致させるため、チップではなく1行のテキストにする
  function customMetricsLine(metrics) {
    if (!metrics || metrics.length === 0) return '';
    const parts = [...metrics]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((m) => `${m.name}: ${m.value}${m.unit}`);
    return `📊 ${parts.join(' ／ ')}`;
  }

  // ★を黄色、☆をグレーで出す。
  // ただし文字列としては「★★★☆☆」が続いていないと、選択してコピーしたときに
  // 崩れてしまうので、2つの span の間には改行も空白も入れないこと
  function starsHtml(score) {
    const filled = '★'.repeat(score);
    const empty = '☆'.repeat(5 - score);
    return `<span style="color: #eab308;">${filled}</span><span style="color: #9ca3af;">${empty}</span>`;
  }

  function renderPmv(ratings) {
    if (!ratings || Object.keys(ratings).length === 0) return '';
    // 横並びは inline-block + margin で作る（flex は貼り付け先で解除される）
    const items = PMV_VALUES.filter((v) => ratings[v])
      .map(
        (v) =>
          `<span style="display: inline-block; margin-right: 16px;">${escapeHtml(v)} ${starsHtml(
            ratings[v]
          )}</span>`
      )
      .join('');
    if (!items) return '';
    return `
      <div class="report-item">
        <p class="report-item-label" style="${HEADING_STYLE}">バリュー自己評価</p>
        <p class="pmv-line">${items}</p>
      </div>`;
  }

  // 本文の先頭に置く自動算出値の1行。
  //   例) 📝本日消化: 5件 ｜ 🏆前日タスク達成率: 88% (3.5/4)
  // 中身を全選択してチャットへ貼ったとき、この行が1行目に来るようにする。
  // その日の成果である「本日消化」を先に置き、前日ぶんの達成率は後ろに回す
  function taskMetricsLine(report) {
    const parts = [];

    // 数値実績の設定でオフにした項目は、画面にもコピー文にも出さない。
    // 保存済みの自動算出値。旧データは未記録なので、その場合は出さない
    if (
      isAutoMetricVisible('today') &&
      report.today_task_count !== null &&
      report.today_task_count !== undefined
    ) {
      parts.push(`📝 本日消化: ${report.today_task_count}件`);
    }

    // 前日の宣言に対する達成率。当日ぶんと取り違えられないよう「前日」を付ける
    const stats = summarizeTasks(report.reviews);
    if (isAutoMetricVisible('carryover') && stats.total > 0) {
      const percent = Math.round(stats.rate * 100);
      parts.push(`🏆 前日タスク達成率: ${percent}% (${trimDecimal(stats.score)}/${stats.total})`);
    }

    // 両方オフ（または該当データなし）なら行そのものを出さない
    return parts.join(' ｜ ');
  }

  // 達成率に応じた色。数字だけでなく色でも掴めるように。
  // 貼り付け先にはクラスが効かないので、同じ色を style 属性でも当てる
  function taskMetricsColor(reviews) {
    const stats = summarizeTasks(reviews);
    if (!isAutoMetricVisible('carryover') || stats.total === 0) return '';
    if (stats.rate >= 0.8) return 'color: #059669;';
    if (stats.rate >= 0.5) return 'color: #d97706;';
    return 'color: #dc2626;';
  }

  function taskMetricsStyle(reviews) {
    return `${taskMetricsColor(reviews)} font-weight: bold; margin-top: 10px; margin-bottom: 0;`;
  }

  // 見出し（閉じている時）に出す1行プレビュー
  function summaryPreview(report) {
    return String(report.fact || '').replace(/\s+/g, ' ').slice(0, 60);
  }

  function renderAccordion(report, keyword, open) {
    const name = report.users ? report.users.name : '';
    return `
      <details class="report-acc" ${open ? 'open' : ''}>
        <summary>
          <span class="acc-caret">▶</span>
          <span class="acc-date">${escapeHtml(formatYmd(report.report_date))}</span>
          ${name ? `<span class="acc-author">${escapeHtml(name)}</span>` : ''}
          <span class="acc-summary">${escapeHtml(summaryPreview(report))}</span>
        </summary>
        <div class="acc-body">
          ${
            // 1〜2行目。コピー時に先頭へ来るよう、操作ボタンより前に置く
            taskMetricsLine(report)
              ? `<p class="acc-metrics" style="${taskMetricsStyle(report.reviews)}">${escapeHtml(
                  taskMetricsLine(report)
                )}</p>`
              : ''
          }
          ${
            customMetricsLine(report.daily_metrics)
              ? `<p class="acc-metrics-custom">${highlight(
                  customMetricsLine(report.daily_metrics),
                  keyword
                )}</p>`
              : ''
          }
          <div class="acc-actions">
            ${
              // 編集は自分の日報か管理者のときだけ。コピーは誰の日報でもできる
              canManageReport(user, report) && report.user_id !== user.id
                ? '<span class="admin-note">管理者として編集できます</span>'
                : ''
            }
            <button type="button" class="btn btn-ghost" data-copy="${report.id}">本文をコピー</button>
            ${
              canManageReport(user, report)
                ? `<a class="btn btn-ghost" href="report.html?edit=${report.id}">この日報を編集する</a>
                   <button type="button" class="btn btn-ghost btn-danger" data-delete="${report.id}">削除</button>`
                : ''
            }
          </div>
          ${renderItem('1. 業務実績', report.fact || FACT_FALLBACK, keyword)}
          ${renderItem('2. 未達成・課題', report.problem, keyword)}
          ${renderItem('3. 要因分析', report.why, keyword)}
          ${renderReviews(report.reviews, keyword)}
          ${renderItem('4. 次回の宣言（次回のタスク）', report.commitment, keyword)}
          ${renderItem('5. 改善の準備', report.action, keyword)}
          ${renderItem('6. 学び・備考', report.insight, keyword)}
          ${renderItem('7. 一言', report.one_word, keyword)}
          ${renderPmv(report.pmv_ratings)}
        </div>
      </details>`;
  }


  // ============================================================
  // 本文のコピー
  //   画面のDOMではなくデータから組み立てる。
  //   見た目の都合（タグの色分けなど）に引きずられず、
  //   チャットに貼ったときに読める素のテキストにするため。
  // ============================================================
  function buildCopyText(report) {
    const lines = [];

    // 1〜2行目は数値。チャットのプレビューにここが出る
    const metrics = taskMetricsLine(report);
    if (metrics) lines.push(metrics);

    const custom = customMetricsLine(report.daily_metrics);
    if (custom) lines.push(custom);

    // 見出しと中身を積む。ブロックの切れ目が分かるよう、
    // 2つ目以降の大見出しの前には空行を1行入れる
    const section = (title, body) => {
      if (!body) return;
      if (lines.length > 0) lines.push('');
      lines.push(`■ ${title}`, body);
    };

    // 業務実績が空でも、貼り付け先で空欄にならないよう代替文言を入れる
    section('1. 業務実績', report.fact || FACT_FALLBACK);
    section('2. 未達成・課題', report.problem);
    section('3. 要因分析', report.why);

    // 振り返りは要因分析のあと、次回の宣言の前
    if (report.reviews && report.reviews.length > 0) {
      const reviewLines = report.reviews.map((r) => {
        const head = `[${r.achievement}] ${r.line_text}`;
        return r.reason ? `${head}\n　→ ${r.reason}` : head;
      });
      section('前回宣言の振り返り', reviewLines.join('\n'));
    }

    section('4. 次回の宣言（次回のタスク）', report.commitment);
    section('5. 改善の準備', report.action);
    section('6. 学び・備考', report.insight);
    section('7. 一言', report.one_word);

    const ratings = report.pmv_ratings;
    if (ratings && Object.keys(ratings).length > 0) {
      const stars = PMV_VALUES.filter((v) => ratings[v]).map(
        (v) => `${v} ${'★'.repeat(ratings[v])}${'☆'.repeat(5 - ratings[v])}`
      );
      if (stars.length > 0) section('バリュー自己評価', stars.join('\n'));
    }

    return lines.join('\n');
  }

  // ============================================================
  // 貼り付け用の HTML
  //   LINE WORKS のノートなどのエディタは、貼り付けた <div> や <p> を
  //   そのまま「段落」として取り込み、エディタ側の段落マージンを当てる。
  //   画面のDOM（項目ごとに div + p）をそのまま渡すと、この段落マージンが
  //   積み重なって項目と項目の間が極端に空いてしまう。
  //   そこで貼り付け用は段落を作らず、行の区切りは <br> だけにして、
  //   装飾はインライン要素の style 属性だけで組み立てる。
  //   並び順は text/plain 側（buildCopyText）と揃えること。
  //   検索語の <mark> は貼り付け先に要らないので、DOMではなくデータから作る。
  // ============================================================
  const COPY_HEADING_STYLE = 'color: #4b5563; font-weight: bold;';

  // 改行だけ <br> にして、それ以外はエスケープする
  function copyHtmlText(value) {
    return escapeHtml(value).replace(/\n/g, '<br>');
  }

  function buildCopyHtml(report) {
    // 1ブロック = 見出し1つ分。ブロックの間だけ空行を1つ入れる
    const blocks = [];

    // 1〜2行目の数値。貼り付け先のプレビューにここが出る
    const headLines = [];
    const metrics = taskMetricsLine(report);
    if (metrics) {
      headLines.push(
        `<span style="${taskMetricsColor(report.reviews)} font-weight: bold;">${escapeHtml(
          metrics
        )}</span>`
      );
    }
    const custom = customMetricsLine(report.daily_metrics);
    if (custom) headLines.push(escapeHtml(custom));
    if (headLines.length > 0) blocks.push(headLines.join('<br>'));

    const section = (title, bodyHtml) => {
      if (!bodyHtml) return;
      blocks.push(`<span style="${COPY_HEADING_STYLE}">■ ${escapeHtml(title)}</span><br>${bodyHtml}`);
    };

    const textSection = (title, value) => {
      if (value) section(title, copyHtmlText(value));
    };

    textSection('1. 業務実績', report.fact || FACT_FALLBACK);
    textSection('2. 未達成・課題', report.problem);
    textSection('3. 要因分析', report.why);

    if (report.reviews && report.reviews.length > 0) {
      const lines = report.reviews.map((r) => {
        const head = `<span style="${badgeStyle(r.achievement)}">${escapeHtml(
          r.achievement
        )}</span>${escapeHtml(r.line_text)}`;
        return r.reason
          ? `${head}<br><span style="${REASON_STYLE}">　→ ${copyHtmlText(r.reason)}</span>`
          : head;
      });
      section('前回宣言の振り返り', lines.join('<br>'));
    }

    textSection('4. 次回の宣言（次回のタスク）', report.commitment);
    textSection('5. 改善の準備', report.action);
    textSection('6. 学び・備考', report.insight);
    textSection('7. 一言', report.one_word);

    const ratings = report.pmv_ratings;
    if (ratings && Object.keys(ratings).length > 0) {
      // 全角スペースで区切る（HTMLの半角スペースと違って貼り付け先でも潰れない）
      const stars = PMV_VALUES.filter((v) => ratings[v]).map(
        (v) => `${escapeHtml(v)} ${starsHtml(ratings[v])}`
      );
      if (stars.length > 0) section('バリュー自己評価', stars.join('　　'));
    }

    // charset を添えないと、貼り付け先によっては文字化けする
    return (
      '<meta charset="utf-8">' +
      '<div style="font-family: sans-serif; font-size: 14px; line-height: 1.6; color: #1e293b;">' +
      blocks.join('<br><br>') +
      '</div>'
    );
  }

  // text/html と text/plain の両方をクリップボードに載せる。
  // リッチテキストエディタなら装飾つきで、メモ帳などなら素のテキストで貼られる
  async function copyToClipboard(html, text) {
    // https と localhost では Clipboard API が使える
    if (navigator.clipboard && window.ClipboardItem && window.isSecureContext) {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([text], { type: 'text/plain' }),
          }),
        ]);
        return true;
      } catch {
        // 権限が下りない場合は下の方法にフォールバックする
      }
    }

    // 古い環境向け。copyイベントを横取りして、2つの形式を自分で書き込む
    const onCopy = (event) => {
      event.preventDefault();
      event.clipboardData.setData('text/html', html);
      event.clipboardData.setData('text/plain', text);
    };
    document.addEventListener('copy', onCopy);

    // execCommand('copy') は選択範囲が無いと動かないので、見えない枠を選んでおく
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    document.body.appendChild(area);
    area.select();

    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
    document.removeEventListener('copy', onCopy);
    document.body.removeChild(area);
    return copied;
  }

  // コピーボタン（一覧は再描画されるのでイベント委譲で受ける）
  listEl.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-copy]');
    if (!button) return;

    const report = reports.find((r) => r.id === button.dataset.copy);
    if (!report) return;

    const ok = await copyToClipboard(buildCopyHtml(report), buildCopyText(report));
    const original = button.textContent;
    button.textContent = ok ? 'コピーしました' : 'コピーできませんでした';
    button.classList.toggle('is-copied', ok);

    setTimeout(() => {
      button.textContent = original;
      button.classList.remove('is-copied');
    }, 1600);
  });

  // 削除ボタン（本人と管理者にしか描画していないが、実際の防御はRLS側で行う）
  listEl.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-delete]');
    if (!button) return;

    const report = reports.find((r) => r.id === button.dataset.delete);
    if (!report) return;

    // 取り消せない操作なので、必ず一度確認する
    if (!window.confirm('本当にこの日報を削除しますか？')) return;

    button.disabled = true;
    button.textContent = '削除中...';

    // 数値実績と振り返りは外部キーの on delete cascade で一緒に消える。
    // .select() を付けて「実際に何行消えたか」を確認する
    // （RLSで弾かれた場合はエラーではなく0件で返るため）
    const { data, error } = await supabase
      .from('daily_reports')
      .delete()
      .eq('id', report.id)
      .select('id');

    if (error || !data || data.length === 0) {
      button.disabled = false;
      button.textContent = '削除';
      setMessage(
        error
          ? '削除に失敗しました: ' + error.message
          : '削除できませんでした。この日報を削除する権限がありません。',
        'error'
      );
      return;
    }

    await loadReports();
    setMessage('日報を削除しました。', 'success');
  });

  // 検索語で絞り込んで描画し直す
  function applyFilter() {
    const keyword = searchBox.value.trim();
    const needle = keyword.toLowerCase();
    const hits = needle ? reports.filter((r) => r._text.includes(needle)) : reports;

    if (hits.length === 0) {
      listEl.innerHTML = '';
      setMessage(
        needle ? `「${keyword}」に一致する日報はありません。` : 'まだ日報がありません。',
        null
      );
      return;
    }

    setMessage(
      needle ? `${hits.length}件ヒットしました。` : `${hits.length}件の日報があります。`,
      null
    );
    // 検索中はヒットを全部開く。通常時は最新の1件だけ開く
    listEl.innerHTML = hits
      .map((r, i) => renderAccordion(r, keyword, needle ? true : i === 0))
      .join('');
  }

  // ============================================================
  // 取得
  // ============================================================
  async function loadReports() {
    if (!isConfigured) {
      setMessage('.env に Supabase の URL とキーを設定してください。', 'error');
      return;
    }

    setMessage('読み込み中...', null);
    listEl.innerHTML = '';

    let query = supabase
      .from('daily_reports')
      .select('*, users(name), daily_metrics(*)')
      .order('report_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(100);

    // 表示範囲：対象集団（部署）→ 対象ユーザー の2段階で絞り込む。
    // 制限付きユーザーは選択に関わらず自分の分だけ。他人のIDは指定そのものをしない
    if (!canSeeOthers(user)) {
      query = query.eq('user_id', viewUser.id);
    } else if (userSelect.value !== ALL) {
      query = query.eq('user_id', userSelect.value);
    } else if (deptSelect.value !== ALL) {
      const ids = membersInDepartment().map((row) => row.id);
      // 在籍者が0人の部署。問い合わせても必ず0件なので、ここで打ち切る
      if (ids.length === 0) {
        reports = [];
        applyFilter();
        return;
      }
      query = query.in('user_id', ids);
    }

    const { data, error } = await query;

    if (error) {
      setMessage('取得に失敗しました: ' + error.message, 'error');
      return;
    }

    reports = data || [];

    // commitment_reviews は daily_reports への外部キーを2本持つため
    // （report_id / prev_report_id）、埋め込みではなく別クエリで取ってから結合する
    if (reports.length > 0) {
      const ids = reports.map((r) => r.id);
      const { data: reviews, error: reviewError } = await supabase
        .from('commitment_reviews')
        .select('report_id, line_no, line_text, achievement, reason')
        .in('report_id', ids)
        .order('line_no', { ascending: true });

      if (reviewError) {
        setMessage('振り返りの取得に失敗しました: ' + reviewError.message, 'error');
        return;
      }

      const byReport = new Map();
      (reviews || []).forEach((r) => {
        if (!byReport.has(r.report_id)) byReport.set(r.report_id, []);
        byReport.get(r.report_id).push(r);
      });
      reports.forEach((r) => {
        r.reviews = byReport.get(r.id) || [];
      });
    }

    reports.forEach((r) => {
      r._text = searchableText(r); // 検索用テキストは1回だけ作っておく
    });

    applyFilter();
  }

  // ============================================================
  // 2段階の絞り込み（対象集団 → 対象ユーザー）
  // ============================================================
  // 選ばれている対象集団に属するユーザー。「全社」なら全員
  function membersInDepartment() {
    if (deptSelect.value === ALL) return members;
    return members.filter((row) => row.department_id === deptSelect.value);
  }

  // 対象ユーザーの選択肢を、選ばれている対象集団に合わせて作り直す。
  // 部署を変えても同じ人を見続けられるよう、選択は残せるなら引き継ぐ
  function renderUserOptions(preferredId) {
    const department = departments.find((row) => row.id === deptSelect.value);
    const rows = membersInDepartment();

    userSelect.innerHTML = '';

    const everyone = document.createElement('option');
    everyone.value = ALL;
    everyone.textContent = department ? `${department.name}全員` : '全員';
    userSelect.appendChild(everyone);

    rows.forEach((row) => {
      const option = document.createElement('option');
      option.value = row.id;
      // 「自分のデータ」を探しやすくする（デモモード中は デモ太郎 が選ばれている）
      option.textContent = row.id === user.id ? `${row.name}（自分）` : row.name;
      userSelect.appendChild(option);
    });

    userSelect.value = rows.some((row) => row.id === preferredId) ? preferredId : ALL;
  }

  // 対象集団・対象ユーザーの選択肢を作る。
  // ここで失敗しても一覧そのものは見せたいので、握りつぶしてログだけ残す
  async function loadFilterOptions() {
    const [departmentRows, { data, error }] = await Promise.all([
      fetchDepartments(),
      supabase.from('users').select('id, name, department_id').order('name'),
    ]);

    if (error) console.error('ユーザー一覧の取得に失敗しました', error);

    departments = departmentRows;
    members = (data || []).filter((row) => row.name);

    departments.forEach((row) => {
      const option = document.createElement('option');
      option.value = row.id;
      option.textContent = row.name;
      deptSelect.appendChild(option);
    });

    // 既定は今までと同じ「自分（デモモード中は デモ太郎）のデータ」
    renderUserOptions(viewUser.id);
  }

  // 制限付きユーザーは自分の日報しか読めない（RLSでも弾かれる）。
  // 他人を選ぶ余地が残らないよう、選択肢を自分だけにして両方とも非活性にする
  function lockFiltersToSelf() {
    deptSelect.innerHTML = '';
    userSelect.innerHTML = '';

    const onlyMe = document.createElement('option');
    onlyMe.value = ALL;
    onlyMe.textContent = '自分のみ';
    deptSelect.appendChild(onlyMe);

    const me = document.createElement('option');
    me.value = viewUser.id;
    me.textContent = viewUser.name;
    userSelect.appendChild(me);

    deptSelect.disabled = true;
    userSelect.disabled = true;
  }

  // ============================================================
  // イベント
  // ============================================================
  let searchTimer = null;
  searchBox.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(applyFilter, 180); // 入力のたびに描画し直さないよう少し待つ
  });

  // 対象集団を変えたら対象ユーザーの選択肢を作り直してから取り直す（カスケード）
  deptSelect.addEventListener('change', () => {
    renderUserOptions(userSelect.value);
    loadReports();
  });

  userSelect.addEventListener('change', loadReports);

  expandBtn.addEventListener('click', () => {
    const items = [...listEl.querySelectorAll('.report-acc')];
    const shouldOpen = items.some((el) => !el.open);
    items.forEach((el) => {
      el.open = shouldOpen;
    });
    expandBtn.textContent = shouldOpen ? 'すべて閉じる' : 'すべて開く';
  });

  setActiveNav('list');
  setupDemoToggle();
  setupManual(user);
  setupReleaseNotes(user);
  document.getElementById('user-name').textContent = user.name;
  setupProfile(user);
  document.getElementById('logout-btn').addEventListener('click', signOut);

  (async () => {
    viewUser = await resolveViewUser(user);
    showDemoBanner(viewUser);

    if (canSeeOthers(user)) {
      await loadFilterOptions();
    } else {
      lockFiltersToSelf();
    }

    loadReports();
  })();
}
