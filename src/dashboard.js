// ============================================================
// データ分析ダッシュボード（Supabase実データ）
//
// 集計の軸は「日報の対象日(report_date)」。
// 出勤日がまちまちなので、日報が存在する日だけを横軸に並べる。
// ============================================================
import Chart from 'chart.js/auto';
import { supabase, isConfigured } from './supabase.js';
import { escapeHtml, PMV_VALUES, summarizeTasks } from './util.js';

// 数値実績とは別枠で出す、振り返りから計算する系列
const TASK_TOTAL = '__task_total__';
const TASK_RATE = '__task_rate__';
const TASK_TODAY = '__task_today__';

// 検証済みの配色（白背景で 明度帯 / 彩度 / CVD分離 / コントラスト 全てPASS）
const SERIES_BLUE = '#2a78d6';
const SERIES_BLUE_FILL = 'rgba(42, 120, 214, 0.14)';
const INK = '#1e293b';
const INK_MUTED = '#64748b';
const GRID = '#e2e8f0';

// 出勤日が不定期なので、暦の7日間ではなく「日報が存在する直近7日分」を既定にする
const RECENT_ENTRY_DAYS = 7;

// つまずきの傾向を数えるための語彙。表記ゆれをまとめて1つのラベルに寄せる
const STUMBLE_KEYWORDS = [
  { label: '時間不足', patterns: ['時間がな', '時間不足', '時間が足り', '間に合わ', '時間切れ'] },
  { label: '見積もりの甘さ', patterns: ['見積', '想定より', '思ったより', '甘か', '甘さ'] },
  { label: '準備不足', patterns: ['準備不足', '準備がで', '準備でき', '段取り'] },
  { label: '優先順位', patterns: ['優先', '後回し'] },
  { label: '割り込み対応', patterns: ['割り込み', '急な', '緊急', '別の業務', '他の業務'] },
  { label: '確認・返答待ち', patterns: ['確認待ち', '返答', '返事', '待ちが', '依頼中'] },
  { label: '集中力・体調', patterns: ['集中', '疲れ', '体調', '眠'] },
];

// ============================================================
// 日付ユーティリティ（report_date は 'YYYY-MM-DD' 文字列のまま扱う）
// ============================================================
function shortLabel(ymd) {
  const [, m, d] = ymd.split('-').map(Number);
  return `${m}/${d}`;
}

function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${y}年${m}月`;
}

// ============================================================
// 取得したデータを「日付ごと」にまとめる
// ============================================================
function groupByDate(reports) {
  const byDate = new Map();

  reports.forEach((report) => {
    const key = report.report_date;
    if (!byDate.has(key)) {
      byDate.set(key, {
        date: key,
        reportIds: [],
        metrics: new Map(),
        pmvList: [],
        todayTaskCount: null, // 旧データは未記録なので null のまま
      });
    }
    const day = byDate.get(key);
    day.reportIds.push(report.id);

    // 同じ日に複数の日報がある場合、数値は合算する
    (report.daily_metrics || []).forEach((m) => {
      const current = day.metrics.get(m.name);
      day.metrics.set(m.name, {
        unit: m.unit,
        value: (current ? current.value : 0) + Number(m.value ?? 0),
      });
    });

    if (report.today_task_count !== null && report.today_task_count !== undefined) {
      day.todayTaskCount = (day.todayTaskCount ?? 0) + report.today_task_count;
    }

    if (report.pmv_ratings) day.pmvList.push(report.pmv_ratings);
  });

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function summarize(values) {
  if (values.length === 0) return { avg: 0, sum: 0, max: 0, count: 0 };
  const sum = values.reduce((a, b) => a + b, 0);
  return { avg: sum / values.length, sum, max: Math.max(...values), count: values.length };
}

// 小数が出る項目だけ小数第1位まで出す
function decimalsFor(values) {
  return values.some((v) => !Number.isInteger(v)) ? 1 : 0;
}

function formatNumber(value, decimals) {
  return value.toLocaleString('ja-JP', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// ============================================================
// 本体
// ============================================================
export async function initDashboard(user) {
  const rangeSelect = document.getElementById('dash-range');
  const monthsGroup = document.getElementById('range-months');
  const metricSelect = document.getElementById('dash-metric');
  const metricCaption = document.getElementById('metric-caption');
  const metricFigure = document.getElementById('metric-figure');
  const metricEmpty = document.getElementById('metric-empty');
  const metricTableView = document.getElementById('metric-table-view');
  const tableEl = document.getElementById('metric-table');
  const pmvCaption = document.getElementById('pmv-caption');
  const pmvAnalysis = document.getElementById('pmv-analysis');
  const pmvEmpty = document.getElementById('pmv-empty');
  const aiReportEl = document.getElementById('ai-report');

  let allDays = []; // 全期間の日付ごと集計
  let reviews = []; // commitment_reviews（AI分析で使う）
  let texts = []; // 要因分析まわりのテキスト（AI分析で使う）
  let metricNames = []; // 数値項目名の一覧
  let metricChart = null;
  let pmvChart = null;

  function showLoadError(text) {
    metricEmpty.hidden = false;
    metricEmpty.textContent = text;
    metricFigure.hidden = true;
    metricTableView.hidden = true;
    pmvEmpty.hidden = false;
    pmvEmpty.textContent = text;
    pmvAnalysis.hidden = true;
  }

  // ---------- 取得 ----------
  async function loadData() {
    if (!isConfigured || !user) {
      showLoadError('Supabaseの設定が未完了のため、分析データを取得できません。');
      return false;
    }

    const { data: reports, error } = await supabase
      .from('daily_reports')
      .select('id, report_date, problem, why, pmv_ratings, today_task_count, daily_metrics(name, unit, value, sort_order)')
      .eq('user_id', user.id)
      .order('report_date', { ascending: true });

    if (error) {
      showLoadError('分析データの取得に失敗しました: ' + error.message);
      return false;
    }

    allDays = groupByDate(reports || []);
    texts = (reports || []).flatMap((r) => [r.problem, r.why]).filter(Boolean);

    // 行ごとの振り返り（未達の要因分析テキストと達成率に使う）
    const ids = (reports || []).map((r) => r.id);
    if (ids.length > 0) {
      const { data: reviewRows } = await supabase
        .from('commitment_reviews')
        .select('report_id, achievement, reason')
        .in('report_id', ids);
      reviews = reviewRows || [];
    }

    // 日付ごとのタスク集計（総数・達成数・達成率）を持たせておく
    const reviewsByReport = new Map();
    reviews.forEach((row) => {
      if (!reviewsByReport.has(row.report_id)) reviewsByReport.set(row.report_id, []);
      reviewsByReport.get(row.report_id).push(row);
    });
    allDays.forEach((day) => {
      day.tasks = summarizeTasks(
        day.reportIds.flatMap((id) => reviewsByReport.get(id) || [])
      );
    });

    // 数値項目：登録中の設定と、過去に記録された項目名を統合する
    // （設定を消した項目でも、過去データが見られるようにするため）
    const recorded = new Set();
    allDays.forEach((day) => day.metrics.forEach((_, name) => recorded.add(name)));

    const { data: settings } = await supabase
      .from('user_metrics_settings')
      .select('name')
      .eq('user_id', user.id)
      .order('sort_order', { ascending: true });

    const ordered = [];
    (settings || []).forEach((s) => ordered.push(s.name));
    [...recorded].sort().forEach((name) => {
      if (!ordered.includes(name)) ordered.push(name);
    });
    metricNames = ordered;

    return true;
  }

  // ---------- 期間の選択肢 ----------
  function buildMonthOptions() {
    const months = [...new Set(allDays.map((day) => day.date.slice(0, 7)))].sort().reverse();
    monthsGroup.innerHTML = months
      .map((ym) => `<option value="month:${ym}">${monthLabel(ym)}</option>`)
      .join('');
    monthsGroup.hidden = months.length === 0;
  }

  function rangeLabel() {
    const option = rangeSelect.selectedOptions[0];
    return option ? option.textContent : '';
  }

  // 選択中の期間に入る日だけ返す
  function filteredDays() {
    const value = rangeSelect.value;
    if (value === 'all') return allDays;
    if (value.startsWith('month:')) {
      const ym = value.slice('month:'.length);
      return allDays.filter((day) => day.date.startsWith(ym));
    }
    // allDays は日付の昇順。末尾から7件＝記入があった直近7日分
    return allDays.slice(-RECENT_ENTRY_DAYS);
  }

  // 直前の同じ長さの期間（総合評価の比較に使う）
  function previousDays(days) {
    if (days.length === 0) return [];
    const from = days[0].date;
    const index = allDays.findIndex((day) => day.date === from);
    if (index <= 0) return [];
    return allDays.slice(Math.max(0, index - days.length), index);
  }

  // ---------- ① 数値実績 / タスク分析 ----------
  // 選択中の項目を「1本の系列」に変換する。
  // 数値実績・タスク総数・タスク達成率で、以降の描画処理を共通化するため
  function buildSeries(days, name) {
    if (name === TASK_TOTAL) {
      return {
        label: '引き継ぎタスク総数',
        unit: '件',
        decimals: 0,
        kind: 'count',
        points: days.map((day) => (day.tasks.total > 0 ? day.tasks.total : null)),
        emptyText: `${rangeLabel()}に評価したタスクがありません。`,
      };
    }

    if (name === TASK_TODAY) {
      return {
        label: '今日のタスク総件数',
        unit: '件',
        decimals: 0,
        kind: 'count',
        points: days.map((day) => day.todayTaskCount),
        emptyText: `${rangeLabel()}に記録がありません。この項目は今後保存する日報から記録されます。`,
      };
    }

    if (name === TASK_RATE) {
      return {
        label: '引き継ぎタスク達成率',
        unit: '%',
        decimals: 0,
        kind: 'rate',
        // 一部達成は0.5として数えた比率
        points: days.map((day) => (day.tasks.rate === null ? null : day.tasks.rate * 100)),
        emptyText: `${rangeLabel()}に評価したタスクがありません。`,
      };
    }

    const points = days.map((day) => {
      const entry = day.metrics.get(name);
      return entry ? entry.value : null;
    });
    return {
      label: name,
      unit: days.map((day) => day.metrics.get(name)).find(Boolean)?.unit || '',
      decimals: decimalsFor(points.filter((v) => v !== null)),
      kind: 'count',
      points,
      emptyText: name
        ? `${rangeLabel()}に「${name}」の記録がありません。`
        : '数値項目がまだ登録されていません。日報作成画面の「項目を設定」から追加してください。',
    };
  }

  // 代表値カード。達成率で「合計」を出しても意味がないので中身を差し替える
  function renderStats(series, values) {
    const stats = summarize(values);
    const cards =
      series.kind === 'rate'
        ? [
            ['平均', stats.avg],
            ['最高', stats.max],
            ['最低', values.length ? Math.min(...values) : 0],
          ]
        : [
            ['平均', stats.avg],
            ['合計', stats.sum],
            ['最高', stats.max],
          ];

    cards.forEach(([label, value], i) => {
      document.getElementById(`stat-label-${i + 1}`).textContent = label;
      document.getElementById(`stat-${i + 1}`).innerHTML = statHtml(
        value,
        series.unit,
        series.decimals
      );
    });
  }

  function renderMetric() {
    const days = filteredDays();
    const series = buildSeries(days, metricSelect.value);
    const points = series.points;
    const values = points.filter((v) => v !== null);
    const { unit, decimals } = series;

    renderStats(series, values);

    if (values.length === 0) {
      metricFigure.hidden = true;
      metricTableView.hidden = true;
      metricEmpty.hidden = false;
      metricEmpty.textContent = series.emptyText;
      if (metricChart) {
        metricChart.destroy();
        metricChart = null;
      }
      return;
    }

    metricFigure.hidden = false;
    metricTableView.hidden = false;
    metricEmpty.hidden = true;
    metricCaption.textContent = `${series.label}${unit ? `（${unit}）` : ''}の日別推移 ／ ${rangeLabel()} ・ ${values.length}日ぶん`;

    const labels = days.map((day) => shortLabel(day.date));

    if (metricChart) metricChart.destroy();
    metricChart = new Chart(document.getElementById('metric-chart'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: series.label,
            data: points,
            borderColor: SERIES_BLUE,
            backgroundColor: SERIES_BLUE_FILL,
            borderWidth: 2,
            pointRadius: labels.length > 20 ? 2 : 4,
            pointHoverRadius: 6,
            pointBackgroundColor: SERIES_BLUE,
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            fill: true,
            tension: 0.25,
            spanGaps: false, // 記録がない日はあえて線を切る
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        // 1系列なので凡例は出さない（キャプションが系列名を担う）
        plugins: {
          legend: { display: false },
          tooltip: {
            mode: 'index',
            intersect: false,
            callbacks: {
              label: (ctx) =>
                ctx.parsed.y === null
                  ? ' 記録なし'
                  : ` ${formatNumber(ctx.parsed.y, decimals)}${unit}`,
            },
          },
        },
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: INK_MUTED, maxRotation: 0, autoSkipPadding: 16 },
          },
          y: {
            beginAtZero: true,
            // 達成率は0〜100%の軸に固定して、日ごとの高低を正しく比べられるようにする
            max: series.kind === 'rate' ? 100 : undefined,
            grid: { color: GRID },
            border: { display: false },
            ticks: { color: INK_MUTED },
          },
        },
      },
    });

    renderTable(days, series);
  }

  function statHtml(value, unit, decimals) {
    return `${formatNumber(Number(value.toFixed(decimals)), decimals)}<span class="stat-unit">${escapeHtml(
      unit
    )}</span>`;
  }

  // グラフを読めない場合の代替（アクセシビリティ用の表ビュー）
  function renderTable(days, series) {
    const head = days.map((day) => `<th scope="col">${shortLabel(day.date)}</th>`).join('');
    const body = series.points
      .map((value) =>
        `<td>${value === null ? '–' : formatNumber(value, series.decimals)}</td>`
      )
      .join('');
    tableEl.innerHTML = `
      <caption>${escapeHtml(series.label)}${series.unit ? `（${escapeHtml(series.unit)}）` : ''}</caption>
      <thead><tr><th scope="col">日付</th>${head}</tr></thead>
      <tbody><tr><th scope="row">${escapeHtml(series.label)}</th>${body}</tr></tbody>`;
  }

  // ---------- ② バリュー評価レーダー ----------
  // 期間内の全日報のPMV評価を項目ごとに平均する
  function pmvAverages(days) {
    const ratings = days.flatMap((day) => day.pmvList);
    if (ratings.length === 0) return null;

    return {
      count: ratings.length,
      scores: PMV_VALUES.map((value) => {
        const scored = ratings.map((r) => r[value]).filter((v) => typeof v === 'number');
        if (scored.length === 0) return 0;
        return scored.reduce((a, b) => a + b, 0) / scored.length;
      }),
    };
  }

  function renderPmv() {
    const days = filteredDays();
    const averages = pmvAverages(days);

    if (!averages) {
      pmvAnalysis.hidden = true;
      pmvEmpty.hidden = false;
      pmvEmpty.textContent = `${rangeLabel()}にバリュー自己評価の記録がありません。`;
      if (pmvChart) {
        pmvChart.destroy();
        pmvChart = null;
      }
      return;
    }

    pmvAnalysis.hidden = false;
    pmvEmpty.hidden = true;
    pmvCaption.textContent = `バリュー自己評価の平均 ／ ${rangeLabel()} ・ ${averages.count}件の日報から算出`;

    if (pmvChart) pmvChart.destroy();
    pmvChart = new Chart(document.getElementById('pmv-chart'), {
      type: 'radar',
      data: {
        labels: PMV_VALUES,
        datasets: [
          {
            label: '期間平均',
            data: averages.scores,
            borderColor: SERIES_BLUE,
            backgroundColor: SERIES_BLUE_FILL,
            borderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBackgroundColor: SERIES_BLUE,
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => ` ${ctx.parsed.r.toFixed(1)} / 5.0` } },
        },
        scales: {
          r: {
            min: 0,
            max: 5,
            ticks: {
              stepSize: 1,
              color: INK_MUTED,
              backdropColor: 'transparent',
              font: { size: 10 },
            },
            grid: { color: GRID },
            angleLines: { color: GRID },
            pointLabels: { color: INK, font: { size: 11, weight: '600' } },
          },
        },
      },
    });

    renderPmvInsight(averages.scores);
  }

  // 強み＝上位2つ、伸びしろ＝下位2つ。色だけに頼らず文字と数値でも示す
  function renderPmvInsight(scores) {
    const ranked = PMV_VALUES.map((name, i) => ({ name, score: scores[i] })).sort(
      (a, b) => b.score - a.score
    );
    const toHtml = (items) =>
      items
        .map(
          (v) =>
            `<li><span class="insight-name">${escapeHtml(v.name)}</span>
             <span class="insight-score">${v.score.toFixed(1)}</span></li>`
        )
        .join('');

    document.getElementById('pmv-strengths').innerHTML = toHtml(ranked.slice(0, 2));
    document.getElementById('pmv-gaps').innerHTML = toHtml(ranked.slice(-2).reverse());
  }

  // ---------- ③ 統合分析（実データからの簡易ロジック） ----------
  // 一覧のサマリーと同じ重み付け（一部達成=0.5）で達成率を出す
  function achievementRate(days) {
    const ids = new Set(days.flatMap((day) => day.reportIds));
    const stats = summarizeTasks(reviews.filter((r) => ids.has(r.report_id)));
    return stats.total === 0 ? null : { rate: stats.rate, total: stats.total };
  }

  // 未達の要因分析テキストから、つまずきの型を数える
  function countStumbles(days) {
    const ids = new Set(days.flatMap((day) => day.reportIds));
    const corpus = [
      ...reviews.filter((r) => ids.has(r.report_id) && r.reason).map((r) => r.reason),
      ...texts,
    ].join('\n');

    return STUMBLE_KEYWORDS.map((keyword) => ({
      label: keyword.label,
      count: keyword.patterns.reduce(
        (total, pattern) => total + corpus.split(pattern).length - 1,
        0
      ),
    }))
      .filter((k) => k.count > 0)
      .sort((a, b) => b.count - a.count);
  }

  function renderAiReport() {
    const days = filteredDays();

    if (days.length === 0) {
      aiReportEl.innerHTML = `<p class="empty-note">${escapeHtml(rangeLabel())}に日報がありません。日報を書くと分析が表示されます。</p>`;
      return;
    }

    const blocks = [];

    // 🌟 強みの発見：最も高いバリューと、その日の数値実績を結びつける
    const averages = pmvAverages(days);
    if (averages) {
      const ranked = PMV_VALUES.map((name, i) => ({ name, score: averages.scores[i] })).sort(
        (a, b) => b.score - a.score
      );
      const top = ranked[0];
      const best = bestMetricDay(days);
      blocks.push({
        icon: '🌟',
        kind: 'good',
        title: '強みの発見',
        body:
          `${rangeLabel()}はバリュー「${top.name}」のスコアが平均 ${top.score.toFixed(1)} と最も高いです！` +
          (best
            ? `この期間で「${best.name}」が最も多かったのは ${shortLabel(best.date)} の ${formatNumber(best.value, decimalsFor([best.value]))}${best.unit} でした。`
            : ''),
      });
    }

    // 💡 つまずきの傾向：要因分析テキストの語彙を数える
    const stumbles = countStumbles(days);
    const rate = achievementRate(days);
    if (stumbles.length > 0) {
      const top = stumbles.slice(0, 2);
      blocks.push({
        icon: '💡',
        kind: 'gap',
        title: 'つまずきの傾向',
        body: `未達成の要因分析で ${top
          .map((s) => `「${s.label}」`)
          .join('')} が計${top.reduce((a, b) => a + b.count, 0)}回出現しています。次回の宣言では、タスクをさらに細分化してみましょう。`,
      });
    } else if (rate) {
      blocks.push({
        icon: '💡',
        kind: 'gap',
        title: 'つまずきの傾向',
        body: `${rangeLabel()}に評価したタスクは${rate.total}件で、目立った共通の要因はまだ見つかっていません。要因分析を書き溜めると傾向が見えてきます。`,
      });
    }

    // 📈 総合評価：直前の同じ長さの期間と達成率を比べる
    if (rate) {
      const previous = achievementRate(previousDays(days));
      const current = Math.round(rate.rate * 100);
      let body = `${rangeLabel()}のタスク達成率は ${current}%（${rate.total}件中）です。`;
      if (previous) {
        const diff = current - Math.round(previous.rate * 100);
        body +=
          diff > 0
            ? `直前の同じ期間より ${diff}ポイント上がっています。素晴らしい成長ペースです！`
            : diff < 0
              ? `直前の同じ期間より ${Math.abs(diff)}ポイント下がっています。宣言の量が多すぎないか見直してみましょう。`
              : '直前の同じ期間と同じ水準を保てています。';
      } else {
        body += '比較できる過去の期間がまだないので、次回から推移を追えます。';
      }
      blocks.push({ icon: '📈', kind: 'trend', title: '総合評価', body });
    }

    if (blocks.length === 0) {
      aiReportEl.innerHTML =
        '<p class="empty-note">分析できるデータがまだ足りません。バリュー評価や振り返りを入力すると表示されます。</p>';
      return;
    }

    aiReportEl.innerHTML = blocks
      .map(
        (b) => `
        <div class="ai-block ai-block-${b.kind}">
          <p class="ai-block-title"><span class="ai-icon">${b.icon}</span>${b.title}</p>
          <p class="ai-block-body">${escapeHtml(b.body)}</p>
        </div>`
      )
      .join('');
  }

  // 期間内で「選択中の項目」が最も大きかった日。
  // 単位の違う項目どうし（円と件など）を生の数値で比べても意味がないため、1項目に絞る
  function bestMetricDay(days) {
    const name = metricSelect.value;
    if (!name) return null;

    let best = null;
    days.forEach((day) => {
      const entry = day.metrics.get(name);
      if (entry && (!best || entry.value > best.value)) {
        best = { name, date: day.date, value: entry.value, unit: entry.unit };
      }
    });
    return best;
  }

  // ---------- 描画のまとめ ----------
  function renderAll() {
    renderMetric();
    renderPmv();
    renderAiReport();
  }

  rangeSelect.addEventListener('change', renderAll);
  metricSelect.addEventListener('change', () => {
    renderMetric();
    renderAiReport(); // 「強みの発見」は選択中の項目を参照するので一緒に更新する
  });

  // ---------- 起動 ----------
  const loaded = await loadData();
  if (!loaded) return;

  buildMonthOptions();

  // 数値実績と、振り返りから計算するタスク分析を分けて並べる
  const metricOptions = metricNames.length
    ? `<optgroup label="数値実績">${metricNames
        .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
        .join('')}</optgroup>`
    : '';
  metricSelect.innerHTML =
    metricOptions +
    `<optgroup label="タスク分析">
       <option value="${TASK_TOTAL}">引き継ぎタスク総数</option>
       <option value="${TASK_RATE}">引き継ぎタスク達成率（%）</option>
       <option value="${TASK_TODAY}">今日のタスク総件数</option>
     </optgroup>`;

  if (allDays.length === 0) {
    showLoadError('まだ日報がありません。日報を書くとここに分析が表示されます。');
    renderAiReport();
    return;
  }

  renderAll();
}
