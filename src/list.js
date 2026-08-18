import { supabase, isConfigured } from './supabase.js';
import { requireUser, signOut } from './session.js';
import { setActiveNav } from './nav.js';
import { resolveViewUser, setupDemoToggle, showDemoBanner } from './demo.js';
import { setupManual } from './manual.js';
import { canManageReport, isAdmin } from './permissions.js';
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
  const scopeSelect = document.getElementById('scope-select');
  const searchBox = document.getElementById('search-box');
  const expandBtn = document.getElementById('expand-btn');

  // 「1. 業務実績」が空のときに代わりに出す文言。
  // 数値実績だけで完結した日でも、貼り付けたテキストが空欄にならないようにする
  const FACT_FALLBACK = '（数値実績の業務に集中）';

  let reports = []; // 取得済みの日報（検索はこの配列に対してフロントで行う）
  let viewUser = user; // 「誰のデータを見ているか」。デモモード中は デモ太郎

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
  function achievementClass(value) {
    if (value === '達成' || value === '達成できた') return 'tag tag-good';
    if (value === '一部達成' || value === '一部できた') return 'tag tag-mid';
    if (value === '未達成' || value === 'できなかった') return 'tag tag-bad';
    if (value === '中止') return 'tag tag-off';
    return 'tag';
  }

  function renderItem(label, value, keyword) {
    if (!value) return '';
    return `
      <div class="report-item">
        <p class="report-item-label">${label}</p>
        <p class="report-item-text">${highlight(value, keyword)}</p>
      </div>`;
  }

  // 前回宣言の行ごとの振り返り
  function renderReviews(reviews, keyword) {
    if (!reviews || reviews.length === 0) return '';
    const lines = reviews
      .map(
        (r) => `
        <div class="review-line">
          <span class="${achievementClass(r.achievement)}">${escapeHtml(r.achievement)}</span>
          <div class="review-line-text">
            ${highlight(r.line_text, keyword)}
            ${r.reason ? `<p class="review-line-reason">${highlight(r.reason, keyword)}</p>` : ''}
          </div>
        </div>`
      )
      .join('');
    return `
      <div class="report-item">
        <p class="report-item-label">前回宣言の振り返り</p>
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

  function renderPmv(ratings) {
    if (!ratings || Object.keys(ratings).length === 0) return '';
    const chips = PMV_VALUES.filter((v) => ratings[v])
      .map(
        (v) =>
          `<span class="chip">${escapeHtml(v)} <span class="chip-stars">${'★'.repeat(
            ratings[v]
          )}${'☆'.repeat(5 - ratings[v])}</span></span>`
      )
      .join('');
    if (!chips) return '';
    return `
      <div class="report-item">
        <p class="report-item-label">バリュー自己評価</p>
        <div class="chip-row">${chips}</div>
      </div>`;
  }

  // 本文の先頭に置く自動算出値の1行。
  //   例) 🏆タスク達成率: 88% (3.5/4) ｜ 📝本日消化: 5件
  // 中身を全選択してチャットへ貼ったとき、この行が1行目に来るようにする
  function taskMetricsLine(report) {
    const parts = [];

    // 数値実績の設定でオフにした項目は、画面にもコピー文にも出さない
    const stats = summarizeTasks(report.reviews);
    if (isAutoMetricVisible('carryover') && stats.total > 0) {
      const percent = Math.round(stats.rate * 100);
      parts.push(`🏆 タスク達成率: ${percent}% (${trimDecimal(stats.score)}/${stats.total})`);
    }

    // 保存済みの自動算出値。旧データは未記録なので、その場合は出さない
    if (
      isAutoMetricVisible('today') &&
      report.today_task_count !== null &&
      report.today_task_count !== undefined
    ) {
      parts.push(`📝 本日消化: ${report.today_task_count}件`);
    }

    // 両方オフ（または該当データなし）なら行そのものを出さない
    return parts.join(' ｜ ');
  }

  // 達成率に応じた色。数字だけでなく色でも掴めるように
  function taskMetricsClass(reviews) {
    const stats = summarizeTasks(reviews);
    if (!isAutoMetricVisible('carryover') || stats.total === 0) return 'acc-metrics';
    if (stats.rate >= 0.8) return 'acc-metrics is-good';
    if (stats.rate >= 0.5) return 'acc-metrics is-mid';
    return 'acc-metrics is-bad';
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
              ? `<p class="${taskMetricsClass(report.reviews)}">${escapeHtml(
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

    // 見出しと中身を続けて積む（空行は入れず、貼り付けたときに詰まった見た目にする）
    const section = (title, body) => {
      if (!body) return;
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

  async function copyToClipboard(text) {
    // https と localhost では Clipboard API が使える
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // 権限が下りない場合は下の方法にフォールバックする
      }
    }

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
    document.body.removeChild(area);
    return copied;
  }

  // コピーボタン（一覧は再描画されるのでイベント委譲で受ける）
  listEl.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-copy]');
    if (!button) return;

    const report = reports.find((r) => r.id === button.dataset.copy);
    if (!report) return;

    const ok = await copyToClipboard(buildCopyText(report));
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

    // 表示範囲：自分のデータ / 全員のデータ / 特定のユーザー（user:<id>）
    const scope = scopeSelect.value;
    if (scope === 'mine') {
      query = query.eq('user_id', viewUser.id);
    } else if (scope.startsWith('user:')) {
      query = query.eq('user_id', scope.slice(5));
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

  // 投稿ユーザーの選択肢を「自分のデータ / 全員のデータ」の後ろに足す。
  // ここで失敗しても一覧そのものは見せたいので、握りつぶしてログだけ残す
  async function loadUserOptions() {
    const { data, error } = await supabase.from('users').select('id, name').order('name');
    if (error) {
      console.error('ユーザー一覧の取得に失敗しました', error);
      return;
    }

    (data || []).forEach((row) => {
      if (!row.name) return;
      const option = document.createElement('option');
      option.value = `user:${row.id}`;
      option.textContent = row.name;
      scopeSelect.appendChild(option);
    });
  }

  // ============================================================
  // イベント
  // ============================================================
  let searchTimer = null;
  searchBox.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(applyFilter, 180); // 入力のたびに描画し直さないよう少し待つ
  });

  scopeSelect.addEventListener('change', loadReports);

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
  if (isAdmin(user)) document.body.classList.add('is-admin');
  document.getElementById('user-name').textContent = user.name;
  document.getElementById('logout-btn').addEventListener('click', signOut);

  (async () => {
    viewUser = await resolveViewUser(user);
    showDemoBanner(viewUser);

    // デモ中は「自分のデータ」の意味が変わるので、選択肢の表示も合わせる
    if (viewUser.isDemo) {
      scopeSelect.options[0].textContent = `${viewUser.name}のデータ`;
    }

    await loadUserOptions();
    loadReports();
  })();
}
