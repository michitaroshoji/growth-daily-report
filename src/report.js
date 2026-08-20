import { supabase, isConfigured } from './supabase.js';
import { requireUser, signOut } from './session.js';
import { setActiveNav } from './nav.js';
import { resolveViewUser, setupDemoToggle, showDemoBanner } from './demo.js';
import { setupManual } from './manual.js';
import { setupReleaseNotes } from './release-notes.js';
import { setupProfile } from './profile.js';
import { isAdmin } from './permissions.js';
import { AUTO_METRICS, getAutoMetricSettings, setAutoMetricSetting } from './settings.js';
import { draftKey, loadDraft, saveDraft, clearDraft, isDraftEmpty, formatSavedAt } from './draft.js';
import {
  escapeHtml,
  formatYmd,
  PMV_VALUES,
  METRIC_UNITS,
  parseCommitmentLines,
  attachBulletAssist,
  attachAutoResize,
  refreshAutoResize,
  cleanBulletText,
  summarizeTasks,
  trimDecimal,
  ACHIEVEMENTS,
  CANCELLED,
} from './util.js';

// 未ログインなら requireUser() が index.html へ飛ばす
init();

async function init() {
  const user = await requireUser();
  if (!user) return;

  // 管理者画面から ?view=<ユーザーID> で開かれたときは、その人の分析を読み取り専用で見る
  const adminView = await resolveAdminView(user);
  if (adminView) {
    main(user, user, adminView);
    return;
  }

  const viewUser = await resolveViewUser(user);

  // デモモード中の管理者は「デモ太郎」名義で記入できる（デモの実演用）。
  // 一般ユーザーは常に自分名義（RLSでも他人名義の作成は弾かれる）
  const writeUser = viewUser.isDemo && isAdmin(user) ? viewUser : user;

  main(user, writeUser, viewUser);
}

// 管理者閲覧モードの対象ユーザー。
// 管理者でない・対象が見つからない場合は null を返し、いつも通りの画面にする
async function resolveAdminView(user) {
  const viewId = new URLSearchParams(location.search).get('view');
  if (!viewId || !isAdmin(user)) return null;

  const { data, error } = await supabase
    .from('users')
    .select('id, name')
    .eq('id', viewId)
    .maybeSingle();

  if (error || !data) return null;
  return { id: data.id, name: data.name, isDemo: false, isAdminView: true };
}

// user      … ログイン中の本人（権限判定に使う）
// writeUser … 日報の持ち主として保存する相手（通常は user と同じ）
function main(user, writeUser, viewUser) {
  // ---------- DOM ----------
  const form = document.getElementById('report-form');
  const submitBtn = document.getElementById('submit-btn');
  const message = document.getElementById('message');

  const reportDateEl = document.getElementById('report-date');
  const dateNoteEl = document.getElementById('date-note');
  const prevStatusEl = document.getElementById('prev-status');
  const prevDateEl = document.getElementById('prev-date');
  const commitLinesEl = document.getElementById('commit-lines');
  const whyDynamicEl = document.getElementById('why-dynamic');

  const metricsInputsEl = document.getElementById('metrics-inputs');
  const metricsEmptyEl = document.getElementById('metrics-empty');
  const pmvListEl = document.getElementById('pmv-list');

  const modal = document.getElementById('metrics-modal');
  const settingListEl = document.getElementById('metric-setting-list');
  const metricNameEl = document.getElementById('metric-name');
  const metricUnitEl = document.getElementById('metric-unit');
  const metricAddBtn = document.getElementById('metric-add-btn');
  const metricMessage = document.getElementById('metric-message');

  // 選択肢は util.js を唯一の定義元にする（集計側と食い違わせないため）
  const SHORT_LABEL = { 達成: '達成', 一部達成: '一部', 未達成: '未達', [CANCELLED]: '中止' };
  const INDENT_PX = 16; // 1段あたりの見た目のインデント幅
  const BULLET_FIELDS = ['fact', 'problem', 'why', 'commitment', 'action', 'insight'];

  // ---------- 状態 ----------
  // ?edit=<日報ID> が付いていたら、新規作成ではなく既存日報の編集として動く
  const editId = new URLSearchParams(location.search).get('edit');

  let prevReport = null; // 振り返り対象の前回日報
  let editingReport = null; // 編集中の日報（新規作成時は null）
  let commitLines = []; // [{ depth, text, isParent }]
  let lineStates = []; // [{ achievement, reason }] commitLines と同じ並び
  let metricSettings = []; // カスタム数値評価枠の設定一覧
  const admin = isAdmin(user); // 管理者は他人の日報も編集できる
  // 管理者閲覧モード。DBにも端末の設定にも一切書かない読み取り専用の状態
  const adminView = viewUser.isAdminView === true;

  // 入力欄の値。自動挿入されただけの「・」行はここで捨てる
  const val = (id) => cleanBulletText(document.getElementById(id).value);
  const isLeaf = (i) => !commitLines[i].isParent;
  const leafIndexes = () => commitLines.map((_, i) => i).filter(isLeaf);
  // 達成度を選んだ行だけ。保存対象はこちらを使う
  const ratedLeafIndexes = () => leafIndexes().filter((i) => lineStates[i].achievement);

  function setMessage(text, type) {
    message.textContent = text || '';
    message.className = type ? `message message-${type}` : 'message';
  }

  // ============================================================
  // 0. 対象日（この日報がどの日のものか）
  // ============================================================
  // toISOString() はUTC基準なので、日本時間の朝は前日になってしまう。ローカルで組み立てる
  function todayString() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  // 今日以外でも保存できる。気づけるように軽い注意だけ出す
  function updateDateNote() {
    const isOtherDay = reportDateEl.value !== '' && reportDateEl.value !== todayString();
    dateNoteEl.textContent = isOtherDay ? '※今日ではない日付です' : '';
    dateNoteEl.hidden = !isOtherDay;
  }

  // 送信時に使う対象日。空欄のままでも止めずに今日で補完する
  function reportDateValue() {
    return reportDateEl.value || todayString();
  }

  reportDateEl.value = todayString();
  reportDateEl.addEventListener('change', updateDateNote);
  reportDateEl.addEventListener('input', updateDateNote);
  updateDateNote();

  // ============================================================
  // 0-b. 自動算出するタスク実績（リアルタイム表示）
  // ============================================================
  // 引き継ぎタスク：0. の評価結果。
  // 画面表示は未評価の行も分母に入れて「残りいくつ」が分かるようにする
  function carryoverStats() {
    return summarizeTasks(
      leafIndexes().map((i) => ({ achievement: lineStates[i].achievement }))
    );
  }

  // 保存する数値は、実際に評価した行だけで数える。
  // 未評価の行は commitment_reviews に入らないため、こちらと揃えないと後から辻褄が合わない
  function savedCarryoverStats() {
    return summarizeTasks(
      ratedLeafIndexes().map((i) => ({ achievement: lineStates[i].achievement }))
    );
  }

  // 今日のタスク総件数：1. 業務実績を前回の宣言と同じ規則で解析し、末端項目を数える
  function todayTaskCount() {
    return parseCommitmentLines(val('fact')).filter((row) => !row.isParent).length;
  }

  function updateAutoMetrics() {
    const carryover = carryoverStats();
    document.getElementById('auto-carryover').textContent =
      carryover.total === 0 ? '–' : `${trimDecimal(carryover.score)}/${carryover.total}`;
    document.getElementById('auto-today').textContent = String(todayTaskCount());
  }

  // 設定でオフにした項目は行ごと隠す
  function applyAutoMetricVisibility() {
    const settings = getAutoMetricSettings();
    document.querySelectorAll('#auto-metrics [data-auto]').forEach((row) => {
      row.hidden = settings[row.dataset.auto] === false;
    });
  }

  // 設定モーダル内のオン/オフスイッチ
  function renderAutoMetricToggles() {
    const settings = getAutoMetricSettings();
    document.getElementById('auto-metric-toggles').innerHTML = AUTO_METRICS.map(
      (item) => `
        <li class="metric-setting-item">
          <span>${item.label}</span>
          <label class="switch">
            <input type="checkbox" data-auto-toggle="${item.key}"
                   ${settings[item.key] === false ? '' : 'checked'} />
            <span class="switch-track"><span class="switch-knob"></span></span>
          </label>
        </li>`
    ).join('');
  }

  document.getElementById('auto-metric-toggles').addEventListener('change', (event) => {
    const input = event.target.closest('[data-auto-toggle]');
    if (!input) return;
    setAutoMetricSetting(input.dataset.autoToggle, input.checked);
    applyAutoMetricVisibility();
  });

  document.getElementById('fact').addEventListener('input', updateAutoMetrics);

  // ============================================================
  // 1. 前回の宣言 → 末端タスクだけを評価する
  // ============================================================
  async function loadPreviousCommitment() {
    if (!isConfigured) {
      prevStatusEl.textContent = '（Supabase未設定）';
      return;
    }

    // 対象日が優先。同じ日に複数書いた場合は後から書いたほうを振り返り対象にする
    const { data, error } = await supabase
      .from('daily_reports')
      .select('id, commitment, report_date, created_at')
      .eq('user_id', writeUser.id)
      .order('report_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) {
      prevStatusEl.textContent = '取得に失敗しました: ' + error.message;
      return;
    }

    if (!data || data.length === 0) {
      prevStatusEl.textContent = 'まだ日報がありません。今日が最初の1件です！';
      return;
    }

    prevReport = data[0];
    commitLines = parseCommitmentLines(prevReport.commitment);

    if (commitLines.length === 0) {
      prevStatusEl.textContent = '前回の日報に宣言が入っていませんでした。';
      return;
    }

    lineStates = commitLines.map(() => ({ achievement: null, reason: '' }));
    prevStatusEl.hidden = true;
    prevDateEl.textContent = `（${formatYmd(prevReport.report_date)} の日報より）`;
    renderCommitLines();
    updateAutoMetrics();
  }

  // ============================================================
  // 1-b. 編集モード：既存の日報を読み込んでフォームに流し込む
  // ============================================================
  async function loadEditTarget() {
    const banner = document.getElementById('edit-banner');
    const bannerText = document.getElementById('edit-banner-text');
    banner.hidden = false;

    // 一般ユーザーは自分の日報だけ。管理者は他人の日報も開ける
    let query = supabase
      .from('daily_reports')
      .select('*, users(name), daily_metrics(*)')
      .eq('id', editId);

    if (!admin) query = query.eq('user_id', user.id);

    const { data, error } = await query.maybeSingle();

    if (error || !data) {
      bannerText.textContent = '編集対象の日報が見つかりませんでした。';
      submitBtn.disabled = true;
      prevStatusEl.textContent = '';
      return;
    }

    editingReport = data;

    const author = data.users ? data.users.name : '';
    const othersReport = data.user_id !== user.id;
    bannerText.textContent = othersReport
      ? `【管理者】${author || '他ユーザー'}さんの ${formatYmd(data.report_date)} の日報を編集しています`
      : `${formatYmd(data.report_date)} の日報を編集しています`;
    banner.classList.toggle('is-admin-edit', othersReport);
    submitBtn.textContent = 'この日報を更新する';

    // --- 対象日と本文 ---
    reportDateEl.value = data.report_date;
    updateDateNote();
    ['fact', 'problem', 'why', 'commitment', 'action', 'insight', 'one_word'].forEach(
      (id) => {
        document.getElementById(id).value = data[id] || '';
      }
    );
    refreshAutoResize(); // 流し込んだ本文の量に高さを合わせる
    updateAutoMetrics();

    // --- PMV自己評価 ---
    if (data.pmv_ratings) {
      PMV_VALUES.forEach((value, i) => {
        const score = data.pmv_ratings[value];
        const radio = pmvListEl.querySelector(`input[name="pmv-${i}"][value="${score}"]`);
        if (radio) radio.checked = true;
      });
    }

    fillMetricValues(data.daily_metrics || []);
    await loadEditReviews();
  }

  // 記録済みの数値を入力欄に戻す。
  // 設定を削除済みの項目は入力欄が無いので、その日報限りの枠として足しておく（編集で消えないように）
  function fillMetricValues(recorded) {
    const orphans = recorded.filter(
      (m) => !metricSettings.some((s) => s.id === m.metric_id || s.name === m.name)
    );
    orphans.forEach((m, i) => {
      metricSettings.push({ id: `orphan-${i}`, name: m.name, unit: m.unit, orphan: true });
    });
    if (orphans.length > 0) renderMetricInputs();

    recorded.forEach((m) => {
      const setting =
        metricSettings.find((s) => s.id === m.metric_id) ||
        metricSettings.find((s) => s.name === m.name);
      if (!setting) return;
      const input = document.getElementById(`metric-${setting.id}`);
      if (input) input.value = m.value;
    });
  }

  // 保存済みの「行ごとの振り返り」を復元する。
  // 評価対象だった末端タスクだけが残っているので、それをそのまま並べ直す
  async function loadEditReviews() {
    const { data, error } = await supabase
      .from('commitment_reviews')
      .select('prev_report_id, line_no, line_text, achievement, reason')
      .eq('report_id', editId)
      .order('line_no', { ascending: true });

    if (error || !data || data.length === 0) {
      prevStatusEl.textContent = 'この日報には前回の振り返りが記録されていません。';
      return;
    }

    prevReport = { id: data[0].prev_report_id };
    commitLines = data.map((row) => ({ depth: 0, text: row.line_text, isParent: false }));
    lineStates = data.map((row) => ({
      achievement: row.achievement,
      reason: row.reason || '',
    }));

    prevStatusEl.hidden = true;
    prevDateEl.textContent = '（この日報で評価した内容）';
    renderCommitLines();

    // 保存済みの評価をボタンに反映してから、要因分析の枠を復元する
    lineStates.forEach((state, i) => {
      const row = commitLinesEl.querySelector(`.commit-line[data-line="${i}"]`);
      if (!row) return;
      row.dataset.state = state.achievement;
      row.querySelectorAll('.seg-btn').forEach((btn) => {
        btn.classList.toggle('is-active', btn.dataset.value === state.achievement);
      });
    });
    syncWhyBlocks();
    updateAutoMetrics();
  }

  function renderCommitLines() {
    commitLinesEl.innerHTML = commitLines
      .map((row, i) => {
        const indent = `style="margin-left:${Math.min(row.depth, 5) * INDENT_PX}px"`;

        // 子を持つ行は「見出し」。評価ボタンは付けない
        if (row.isParent) {
          return `
            <div class="commit-line is-parent" ${indent}>
              <p class="commit-line-text">${escapeHtml(row.text)}</p>
            </div>`;
        }

        return `
          <div class="commit-line" data-line="${i}" ${indent}>
            <p class="commit-line-text">${escapeHtml(row.text)}</p>
            <div class="seg" role="group" aria-label="達成度">
              ${ACHIEVEMENTS.map(
                (v) =>
                  `<button type="button" class="seg-btn" data-line="${i}" data-value="${v}">${SHORT_LABEL[v]}</button>`
              ).join('')}
            </div>
          </div>`;
      })
      .join('');
  }

  // 達成度ボタン：押した瞬間に行の色を変え、要因分析エリアへ転記する
  commitLinesEl.addEventListener('click', (event) => {
    const btn = event.target.closest('.seg-btn');
    if (!btn) return;

    const index = Number(btn.dataset.line);
    const value = btn.dataset.value;
    lineStates[index].achievement = value;

    const row = btn.closest('.commit-line');
    row.dataset.state = value;
    row.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('is-active', b === btn));

    syncWhyBlocks();
    updateAutoMetrics();
    scheduleDraftSave();
  });

  // その行の親（見出し）テキスト。転記先で何の話か分かるように添える
  function parentTextOf(index) {
    for (let i = index - 1; i >= 0; i -= 1) {
      if (commitLines[i].depth < commitLines[index].depth) return commitLines[i].text;
    }
    return '';
  }

  // 「未達成 / 一部達成」の行だけ、要因分析の入力枠を出し入れする。
  // 「中止」はやらないと決めたタスクなので、理由を聞かずにそのまま飛ばす
  function syncWhyBlocks() {
    commitLines.forEach((row, i) => {
      const state = lineStates[i];
      const needsReason = state.achievement === '未達成' || state.achievement === '一部達成';
      const existing = whyDynamicEl.querySelector(`.why-block[data-line="${i}"]`);

      if (needsReason && !existing) {
        insertWhyBlock(i, row.text, state);
      } else if (needsReason && existing) {
        // 「未達成 ⇄ 一部達成」を切り替えたときはラベルだけ差し替える（入力は保持）
        existing.dataset.achievement = state.achievement;
        const tag = existing.querySelector('.tag');
        tag.className = `tag ${state.achievement === '未達成' ? 'tag-bad' : 'tag-mid'}`;
        tag.textContent = state.achievement;
      } else if (!needsReason && existing) {
        state.reason = existing.querySelector('textarea').value; // 消す前に入力を退避
        existing.remove();
      }
    });
  }

  function insertWhyBlock(index, text, state) {
    const parent = parentTextOf(index);
    const block = document.createElement('div');
    block.className = 'why-block';
    block.dataset.line = String(index);
    block.dataset.achievement = state.achievement;
    block.innerHTML = `
      <p class="why-block-head">
        <span class="tag ${state.achievement === '未達成' ? 'tag-bad' : 'tag-mid'}">${state.achievement}</span>
        ${parent ? `<span class="why-parent">${escapeHtml(parent)} ›</span>` : ''}
        ${escapeHtml(text)}
      </p>
      <textarea rows="2" placeholder="なぜ達成できなかった？（なぜ1→なぜ2→なぜ3 と深掘り）"></textarea>`;

    const textarea = block.querySelector('textarea');
    attachAutoResize(textarea);
    textarea.value = state.reason || '';
    textarea.addEventListener('input', () => {
      state.reason = textarea.value;
      scheduleDraftSave();
    });
    refreshAutoResize();

    // 宣言の並び順どおりに差し込む
    const next = [...whyDynamicEl.children].find((child) => Number(child.dataset.line) > index);
    whyDynamicEl.insertBefore(block, next || null);
  }

  // ============================================================
  // 2. カスタム数値評価枠（1.5 数値実績）
  // ============================================================
  async function loadMetricSettings() {
    if (!isConfigured) return;

    const { data, error } = await supabase
      .from('user_metrics_settings')
      .select('id, name, unit, sort_order')
      .eq('user_id', writeUser.id)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      metricsEmptyEl.hidden = false;
      metricsEmptyEl.textContent = '評価項目の取得に失敗しました: ' + error.message;
      return;
    }

    metricSettings = data || [];
    renderMetricInputs();
    renderMetricSettingList();
  }

  function renderMetricInputs() {
    metricsEmptyEl.hidden = metricSettings.length > 0;
    metricsInputsEl.innerHTML = metricSettings
      .map(
        (m) => `
        <label class="metric-field">
          <span class="metric-name" title="${escapeHtml(m.name)}">${escapeHtml(m.name)}</span>
          <input type="number" class="metric-input" step="any" min="0"
                 id="metric-${m.id}" placeholder="0" />
          <span class="metric-unit">${escapeHtml(m.unit)}</span>
        </label>`
      )
      .join('');
  }

  function renderMetricSettingList() {
    // 設定を削除済みの項目（編集時に復元した枠）は設定一覧には出さない
    const registered = metricSettings.filter((m) => !m.orphan);
    if (registered.length === 0) {
      settingListEl.innerHTML = '<li class="hint">まだ登録がありません。</li>';
      return;
    }
    settingListEl.innerHTML = registered
      .map(
        (m) => `
        <li class="metric-setting-item">
          <span>${escapeHtml(m.name)}</span>
          <span class="metric-setting-unit">${escapeHtml(m.unit)}</span>
          <button type="button" class="btn btn-ghost" data-delete="${m.id}">削除</button>
        </li>`
      )
      .join('');
  }

  function setMetricMessage(text, type) {
    metricMessage.textContent = text || '';
    metricMessage.className = type ? `message message-${type}` : 'message';
  }

  // 単位は初期値を空にしておく（「選ばれていない」状態を作って必須判定を成立させる）
  metricUnitEl.innerHTML =
    '<option value="">単位を選択</option>' +
    METRIC_UNITS.map((u) => `<option value="${u}">${u}</option>`).join('');

  // 項目名と単位の両方が揃うまで「追加」を押せなくする
  function syncAddButton() {
    metricAddBtn.disabled = !metricNameEl.value.trim() || !metricUnitEl.value;
  }

  metricNameEl.addEventListener('input', syncAddButton);
  metricUnitEl.addEventListener('change', syncAddButton);

  // 項目名の入力中にEnterを押しても登録しない（誤登録・フォーム送信の防止）
  metricNameEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') event.preventDefault();
  });

  document.getElementById('metrics-setting-btn').addEventListener('click', () => {
    setMetricMessage('', null);
    modal.hidden = false;
    metricNameEl.focus();
  });

  function closeModal() {
    modal.hidden = true;
  }

  document.getElementById('metrics-close-btn').addEventListener('click', closeModal);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeModal(); // 背景クリックで閉じる
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.hidden) closeModal();
  });

  async function addMetric() {
    const name = metricNameEl.value.trim();
    const unit = metricUnitEl.value;

    if (!name || !unit) {
      setMetricMessage('評価項目名と単位の両方を入力してください。', 'error');
      return;
    }
    if (metricSettings.some((m) => m.name === name)) {
      setMetricMessage('同じ名前の項目がすでにあります。', 'error');
      return;
    }

    metricAddBtn.disabled = true;
    setMetricMessage('追加中...', null);

    const { data, error } = await supabase
      .from('user_metrics_settings')
      .insert({ user_id: writeUser.id, name, unit, sort_order: metricSettings.length })
      .select('id, name, unit, sort_order')
      .single();

    if (error) {
      syncAddButton();
      setMetricMessage('追加に失敗しました: ' + error.message, 'error');
      return;
    }

    metricSettings.push(data);
    metricNameEl.value = '';
    metricUnitEl.value = '';
    syncAddButton();
    renderMetricInputs();
    renderMetricSettingList();
    setMetricMessage(`「${name}」を追加しました。`, 'success');
    metricNameEl.focus();
  }

  metricAddBtn.addEventListener('click', addMetric);

  settingListEl.addEventListener('click', async (event) => {
    const btn = event.target.closest('[data-delete]');
    if (!btn) return;

    const id = btn.dataset.delete;
    const target = metricSettings.find((m) => m.id === id);
    if (
      !confirm(
        `「${target ? target.name : 'この項目'}」を削除しますか？\n（過去の日報に記録済みの数値は残ります）`
      )
    ) {
      return;
    }

    btn.disabled = true;
    const { error } = await supabase.from('user_metrics_settings').delete().eq('id', id);
    if (error) {
      btn.disabled = false;
      setMetricMessage('削除に失敗しました: ' + error.message, 'error');
      return;
    }

    metricSettings = metricSettings.filter((m) => m.id !== id);
    renderMetricInputs();
    renderMetricSettingList();
    setMetricMessage('削除しました。', null);
  });

  // ============================================================
  // 3. PMV（バリュー）自己評価：5段階の星
  // ============================================================
  function renderPmv() {
    pmvListEl.innerHTML = PMV_VALUES.map((value, i) => {
      // 5→1 の順に置き、CSS(row-reverse)で見た目を 1→5 に戻している
      const stars = [5, 4, 3, 2, 1]
        .map(
          (score) => `
          <input type="radio" name="pmv-${i}" id="pmv-${i}-${score}" value="${score}"
                 aria-label="${escapeHtml(value)} ${score}点" />
          <label for="pmv-${i}-${score}" title="${score}">★</label>`
        )
        .join('');
      return `
        <div class="pmv-row">
          <span class="pmv-label">${escapeHtml(value)}</span>
          <div class="stars" data-value="${escapeHtml(value)}">${stars}</div>
        </div>`;
    }).join('');
  }

  // 選ばれた星を { バリュー名: 1〜5 } にまとめる（1件も選ばれていなければ null）
  function collectPmvRatings() {
    const ratings = {};
    PMV_VALUES.forEach((value, i) => {
      const checked = pmvListEl.querySelector(`input[name="pmv-${i}"]:checked`);
      if (checked) ratings[value] = Number(checked.value);
    });
    return Object.keys(ratings).length > 0 ? ratings : null;
  }

  // ============================================================
  // 3-b. 入力途中の自動保存（localStorage）
  // ============================================================
  const DRAFT_KEY = draftKey(writeUser.id, editId);
  const DRAFT_FIELDS = ['fact', 'problem', 'why', 'commitment', 'action', 'insight', 'one_word'];
  let draftReady = false; // 初期化中の値流し込みで保存が走らないようにする

  function collectDraft() {
    const fields = {};
    DRAFT_FIELDS.forEach((id) => {
      fields[id] = document.getElementById(id).value;
    });

    const metrics = {};
    metricSettings.forEach((m) => {
      const input = document.getElementById(`metric-${m.id}`);
      if (input && input.value !== '') metrics[m.name] = input.value;
    });

    const pmv = {};
    PMV_VALUES.forEach((value, i) => {
      const checked = pmvListEl.querySelector(`input[name="pmv-${i}"]:checked`);
      if (checked) pmv[value] = Number(checked.value);
    });

    return {
      reportDate: reportDateEl.value,
      fields,
      metrics,
      pmv,
      // 行の並びが変わっても取り違えないよう、本文も一緒に持っておく
      reviews: commitLines.map((row, i) => ({
        text: row.text,
        achievement: lineStates[i].achievement,
        reason: lineStates[i].reason,
      })),
    };
  }

  let draftTimer = null;

  function scheduleDraftSave() {
    if (!draftReady || adminView) return;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => saveDraft(DRAFT_KEY, collectDraft()), 250);
  }

  // 打鍵のたびに書くと重いので少し待つが、離脱時は取りこぼさないよう即保存する
  window.addEventListener('pagehide', () => {
    if (draftReady && !adminView) saveDraft(DRAFT_KEY, collectDraft());
  });

  form.addEventListener('input', scheduleDraftSave);
  form.addEventListener('change', scheduleDraftSave);

  // ============================================================
  // 3-b. Enterキーの扱い
  //   1行入力（<input>）でEnterを押すと、ブラウザ標準の挙動でフォームが
  //   送信されてしまう。誤送信を止めたうえで、次の入力欄へ送る。
  //   複数行の <textarea> は改行のままにしたいので対象外（次へはTabで移動）。
  // ============================================================
  const TEXT_INPUT_TYPES = ['text', 'number', 'date', 'email', 'password', 'search', 'tel', 'url'];

  // 目に見えて操作できるものだけを移動先にする。
  // バリュー自己評価の星は opacity:0 / 幅0の radio なので、ここで自然に外れる
  function focusableFields() {
    return [...form.querySelectorAll('input, textarea, select, button')].filter(
      (el) => !el.disabled && (el.offsetWidth > 0 || el.offsetHeight > 0)
    );
  }

  form.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    // 日本語入力の「変換確定」のEnterはここで拾わない（229は古いブラウザ向け）
    if (event.isComposing || event.keyCode === 229) return;

    const el = event.target;
    if (el.tagName !== 'INPUT') return; // textarea は改行、ボタンは本来の動作のまま

    event.preventDefault(); // ここで誤送信を止める

    // ラジオなどは送信を止めるだけで、フォーカスは動かさない
    if (!TEXT_INPUT_TYPES.includes(el.type)) return;

    const fields = focusableFields();
    const index = fields.indexOf(el);
    if (index < 0) return;

    const next = fields[index + 1];
    if (next) next.focus();
  });

  function showDraftBanner(draft) {
    const banner = document.getElementById('draft-banner');
    const savedAt = formatSavedAt(draft.savedAt);
    document.getElementById('draft-banner-text').textContent = savedAt
      ? `入力途中のデータを復元しました（${savedAt} 時点）`
      : '入力途中のデータを復元しました';
    banner.hidden = false;
  }

  document.getElementById('draft-discard').addEventListener('click', () => {
    clearDraft(DRAFT_KEY);
    location.reload();
  });

  // 画面の初期化がすべて終わったあとに、下書きを上書きで流し込む
  function restoreDraft() {
    const draft = loadDraft(DRAFT_KEY);

    if (isDraftEmpty(draft)) {
      if (draft) clearDraft(DRAFT_KEY); // 中身が無い下書きは掃除しておく
      draftReady = true;
      return;
    }

    if (draft.reportDate) {
      reportDateEl.value = draft.reportDate;
      updateDateNote();
    }

    DRAFT_FIELDS.forEach((id) => {
      if (draft.fields && draft.fields[id] !== undefined) {
        document.getElementById(id).value = draft.fields[id];
      }
    });

    Object.entries(draft.metrics || {}).forEach(([name, value]) => {
      const setting = metricSettings.find((m) => m.name === name);
      if (!setting) return;
      const input = document.getElementById(`metric-${setting.id}`);
      if (input) input.value = value;
    });

    Object.entries(draft.pmv || {}).forEach(([value, score]) => {
      const index = PMV_VALUES.indexOf(value);
      if (index < 0) return;
      const radio = pmvListEl.querySelector(`input[name="pmv-${index}"][value="${score}"]`);
      if (radio) radio.checked = true;
    });

    // 前回の宣言が入れ替わっている可能性があるので、本文が一致する行だけ戻す
    (draft.reviews || []).forEach((saved, i) => {
      if (!commitLines[i] || commitLines[i].text !== saved.text) return;
      lineStates[i].achievement = saved.achievement;
      lineStates[i].reason = saved.reason || '';

      const row = commitLinesEl.querySelector(`.commit-line[data-line="${i}"]`);
      if (!row || !saved.achievement) return;
      row.dataset.state = saved.achievement;
      row.querySelectorAll('.seg-btn').forEach((btn) => {
        btn.classList.toggle('is-active', btn.dataset.value === saved.achievement);
      });
    });

    syncWhyBlocks();
    updateAutoMetrics();
    refreshAutoResize();
    showDraftBanner(draft);
    draftReady = true;
  }

  // ============================================================
  // 4. 送信
  // ============================================================
  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    // 読み取り専用。入力欄は隠してあるが、念のためここでも止める
    if (adminView) {
      setMessage('管理者閲覧モード中は保存できません。', 'error');
      return;
    }

    if (!isConfigured) {
      setMessage('.env の設定が未完了のため保存できません。', 'error');
      return;
    }

    // 必須項目は設けない方針。全項目が空でも保存できる
    submitBtn.disabled = true;
    setMessage(editingReport ? '更新中...' : '送信中...', null);

    const carryover = savedCarryoverStats();
    const fields = {
      report_date: reportDateValue(),
      // 自動算出したタスク実績。引き継ぎが無い日報は NULL のままにする
      carryover_task_total: carryover.total || null,
      carryover_task_done: carryover.total ? carryover.score : null,
      today_task_count: todayTaskCount(),
      // 一覧のタグ表示のため、行ごとの評価を1つに集約して従来カラムにも残す
      prev_achievement: summarizeAchievement(),
      prev_reflection: null,
      fact: val('fact'),
      problem: val('problem') || null,
      why: val('why') || null,
      commitment: val('commitment'),
      action: val('action') || null,
      insight: val('insight') || null,
      one_word: val('one_word') || null,
      pmv_ratings: collectPmvRatings(),
    };

    const { reportId, error } = editingReport
      ? await updateReport(fields)
      : await insertReport(fields);

    if (error) {
      submitBtn.disabled = false;
      setMessage((editingReport ? '更新' : '保存') + 'に失敗しました: ' + error.message, 'error');
      return;
    }

    // 子テーブル（行ごとの振り返り／数値実績）を保存する
    const childError = await saveChildRecords(reportId);
    if (childError) {
      submitBtn.disabled = false;
      setMessage('日報は保存できましたが、一部の保存に失敗しました: ' + childError.message, 'error');
      return;
    }

    // Supabaseへの保存が通ったので、下書きは役目を終える
    clearDraft(DRAFT_KEY);
    draftReady = false;
    form.reset();

    setMessage(
      editingReport
        ? '日報を更新しました。一覧画面へ移動します...'
        : '日報を送信しました！お疲れさまでした。一覧画面へ移動します...',
      'success'
    );
    setTimeout(() => {
      location.href = 'list.html';
    }, 1200);
  });

  async function insertReport(fields) {
    const { data, error } = await supabase
      .from('daily_reports')
      .insert({ user_id: writeUser.id, ...fields })
      .select('id')
      .single();
    return { reportId: data ? data.id : null, error };
  }

  async function updateReport(fields) {
    let query = supabase.from('daily_reports').update(fields).eq('id', editingReport.id);
    // 一般ユーザーは自分の日報のみ。管理者は制限なし（user_id は fields に無いので持ち主は変わらない）
    if (!admin) query = query.eq('user_id', user.id);

    const { error } = await query;
    if (error) return { reportId: null, error };

    // 子テーブルは差分更新せず、いったん消して入れ直す（行が増減するため）
    const removals = await Promise.all([
      supabase.from('commitment_reviews').delete().eq('report_id', editingReport.id),
      supabase.from('daily_metrics').delete().eq('report_id', editingReport.id),
    ]);
    const failed = removals.find((r) => r.error);
    if (failed) return { reportId: null, error: failed.error };

    return { reportId: editingReport.id, error: null };
  }

  function summarizeAchievement() {
    const leaves = leafIndexes();
    if (leaves.length === 0) return null;
    // 中止は達成/未達成のどちらでもないので、集約の判断材料から外す
    const values = leaves
      .map((i) => lineStates[i].achievement)
      .filter((v) => v !== CANCELLED);
    if (values.length === 0) return null;
    if (values.every((v) => v === '達成')) return '達成できた';
    if (values.every((v) => v === '未達成')) return 'できなかった';
    return '一部できた';
  }

  async function saveChildRecords(reportId) {
    // 評価対象は末端タスクのみ。見出し行は保存しない。
    // 達成度を選ばなかった行も除く（achievement は NOT NULL + CHECK 制約のため）
    const reviewRows = ratedLeafIndexes().map((i) => ({
      report_id: reportId,
      prev_report_id: prevReport ? prevReport.id : null,
      line_no: i,
      line_text: commitLines[i].text,
      achievement: lineStates[i].achievement,
      reason: lineStates[i].reason.trim() || null,
    }));

    const metricRows = metricSettings
      .map((m, i) => {
        const input = document.getElementById(`metric-${m.id}`);
        const raw = input ? input.value.trim() : '';
        if (raw === '') return null; // 未入力の項目は保存しない
        return {
          report_id: reportId,
          metric_id: m.orphan ? null : m.id, // 設定が消えている枠は紐付け先なし
          name: m.name,
          unit: m.unit,
          value: Number(raw),
          sort_order: i,
        };
      })
      .filter(Boolean);

    if (reviewRows.length > 0) {
      const { error } = await supabase.from('commitment_reviews').insert(reviewRows);
      if (error) return error;
    }
    if (metricRows.length > 0) {
      const { error } = await supabase.from('daily_metrics').insert(metricRows);
      if (error) return error;
    }
    return null;
  }

  // ============================================================
  // 5. タブ切り替え（日報作成 / データ分析）
  // ============================================================
  const panels = {
    report: document.getElementById('panel-report'),
    dashboard: document.getElementById('panel-dashboard'),
  };
  let dashboardLoaded = false;

  function activateTab(name) {
    // 管理者閲覧モードで見せるのは分析だけ。日報の入力欄には戻さない
    if (adminView) name = 'dashboard';

    setActiveNav(name);
    Object.entries(panels).forEach(([key, panel]) => {
      panel.hidden = key !== name;
    });
    if (name === 'report') refreshAutoResize();

    // Chart.js はダッシュボードを開くまで読み込まない（日報入力の初期表示を軽く保つ）
    if (name === 'dashboard' && !dashboardLoaded) {
      dashboardLoaded = true;
      // デモモード中は「デモ太郎」のデータで描く
      import('./dashboard.js').then((module) => module.initDashboard(viewUser));
      // メモは見ているデータに関係なく、常にログイン中の本人のもの。
      // 管理者閲覧モードでは「保存されるもの」を一切置かないので開かない
      if (!adminView) import('./knowledge.js').then((module) => module.setupKnowledge(user));
    }
  }

  // ⚠️ 管理者閲覧モードの見た目。読み取り専用であることを画面上部で明示し、
  // 保存につながる操作（日報入力・メモ・デモ切替）は画面から外す
  function applyAdminViewMode() {
    document.getElementById('knowledge-card').hidden = true;
    document.getElementById('demo-btn').hidden = true;
    // マニュアルは管理者が書き換えられるので、読み取り専用の画面からは外す
    document.getElementById('manual-btn').hidden = true;
    document.querySelector('.navbtn[data-nav="report"]').hidden = true;

    const banner = document.getElementById('demo-banner');
    banner.hidden = false;
    banner.classList.add('is-admin-view');
    banner.textContent =
      '⚠️ 管理者閲覧モード中（操作しても設定は保存されません）' +
      `／「${viewUser.name}」のデータを表示しています`;

    const back = document.createElement('a');
    back.className = 'admin-view-back';
    back.href = 'admin.html';
    back.textContent = '管理者画面に戻る';
    banner.appendChild(back);
  }

  // 「日報作成」「データ分析」はこのページ内の切り替え。「過去の日報」は普通のリンクのまま
  document.querySelectorAll('.navbtn').forEach((button) => {
    const target = button.dataset.nav;
    if (target !== 'report' && target !== 'dashboard') return;

    button.addEventListener('click', (event) => {
      event.preventDefault();
      activateTab(target);
      // 他画面から #dashboard で直接開けるようにURLも合わせる
      history.replaceState(null, '', target === 'dashboard' ? '#dashboard' : location.pathname);
    });
  });

  activateTab(location.hash === '#dashboard' || adminView ? 'dashboard' : 'report');
  if (adminView) applyAdminViewMode();

  // ============================================================
  // 6. 初期化
  // ============================================================
  document.getElementById('user-name').textContent = user.name;
  // 管理者閲覧モードでは、自分の設定も含めて保存につながる操作を出さない
  if (!adminView) setupProfile(user);
  document.getElementById('logout-btn').addEventListener('click', signOut);

  // 1〜6の入力欄に階層的箇条書きアシストを付ける（7は自由記述なので対象外）
  BULLET_FIELDS.forEach((id) => attachBulletAssist(document.getElementById(id)));
  // 入力量に応じて伸びるようにする。
  // マニュアル／バージョンアップ共有の編集欄はモーダルの高さに収める側なので、ここでは伸ばさない
  document
    .querySelectorAll('textarea:not(#manual-editor-input):not(#release-content-input)')
    .forEach(attachAutoResize);

  renderPmv();
  syncAddButton();
  renderAutoMetricToggles();
  applyAutoMetricVisibility();
  updateAutoMetrics();

  setupDemoToggle();
  if (!adminView) showDemoBanner(viewUser);
  setupManual(user);
  setupReleaseNotes(user);

  // デモ名義で書くときは、保存先を取り違えないよう帯で明示する
  if (writeUser.id !== user.id) {
    const banner = document.getElementById('demo-banner');
    banner.hidden = false;
    banner.textContent =
      `デモモード表示中：この画面で作成・更新した日報は「${writeUser.name}」として保存されます`;
  }

  (async () => {
    // 管理者閲覧モードでは日報の入力欄を使わないので、下書きも編集対象も読み込まない
    if (adminView) return;

    if (editId) {
      // 編集時は入力欄が出来てから値を戻したいので、設定の読み込みを待ってから流し込む
      await loadMetricSettings();
      await loadEditTarget();
    } else {
      await Promise.all([loadPreviousCommitment(), loadMetricSettings()]);
    }

    // 画面の初期値がすべて入ったあとに下書きを重ねる（順序が逆だと上書きされる）
    restoreDraft();
  })();
}
