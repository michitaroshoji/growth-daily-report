// ============================================================
// デモ用シードデータ投入スクリプト
//
//   node scripts/seed-demo.mjs
//
// 「デモ太郎」というユーザーを作り、直近7日分の日報を流し込む。
// 触るのは デモ太郎 のデータだけ。実ユーザーの日報には一切手を出さない。
// 再実行すると デモ太郎 の既存データを消してから入れ直す（重複しない）。
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// アプリ本体と同じ解析ロジックを使う。
// こうしないと「画面に出る件数」と「保存された件数」がズレる
import { parseCommitmentLines, summarizeTasks } from '../src/util.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEMO_USER = 'デモ太郎';

// ---------- .env の読み込み（dotenv を足さずに済ませる） ----------
const env = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const at = line.indexOf('=');
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    })
);

const SUPABASE_URL = env.SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('.env に SUPABASE_URL / SUPABASE_ANON_KEY が必要です。');
  process.exit(1);
}

// ---------- REST 呼び出し ----------
async function rest(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path}\n  → ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

// ---------- 日付 ----------
const pad = (n) => String(n).padStart(2, '0');

function ymdDaysAgo(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ============================================================
// 7日分の中身（古い順）
// ============================================================
const METRIC_SETTINGS = [
  { name: '集中作業時間', unit: '分' },
  { name: 'コール件数', unit: '件' },
  { name: '商談数', unit: '件' },
];

// 数値実績は「山と谷」を作って推移が読み取れるようにする
const METRIC_VALUES = {
  集中作業時間: [150, 195, 120, 240, 210, 265, 230],
  コール件数: [12, 18, 14, 23, 19, 27, 24],
  商談数: [1, 2, 1, 3, 2, 4, 3],
};

// バリュー自己評価。日によって 3〜5 で波を作る
const PMV_PLAN = [
  { 常に越えようとする: 3, 圧倒的スピード: 3, 価値提供を喜ぶ: 4, 自分ごと化: 3, ワクワクできる: 4, 人に敬意を持つ: 4 },
  { 常に越えようとする: 4, 圧倒的スピード: 3, 価値提供を喜ぶ: 4, 自分ごと化: 4, ワクワクできる: 4, 人に敬意を持つ: 5 },
  { 常に越えようとする: 3, 圧倒的スピード: 4, 価値提供を喜ぶ: 3, 自分ごと化: 3, ワクワクできる: 3, 人に敬意を持つ: 4 },
  { 常に越えようとする: 5, 圧倒的スピード: 4, 価値提供を喜ぶ: 5, 自分ごと化: 4, ワクワクできる: 5, 人に敬意を持つ: 5 },
  { 常に越えようとする: 4, 圧倒的スピード: 4, 価値提供を喜ぶ: 4, 自分ごと化: 4, ワクワクできる: 4, 人に敬意を持つ: 4 },
  { 常に越えようとする: 5, 圧倒的スピード: 5, 価値提供を喜ぶ: 5, 自分ごと化: 5, ワクワクできる: 5, 人に敬意を持つ: 5 },
  { 常に越えようとする: 4, 圧倒的スピード: 5, 価値提供を喜ぶ: 4, 自分ごと化: 5, ワクワクできる: 4, 人に敬意を持つ: 5 },
];

// 引き継ぎタスクの達成率の目標値（60%〜100%で波を作る）
const RATE_PLAN = [0.6, 0.75, 0.7, 1.0, 0.8, 1.0, 0.85];

// 1日目だけは「前回の宣言」が存在しないので、振り返り対象を用意しておく
const SEED_PREV_COMMITMENT = `・提案資料の初稿を仕上げる
　・構成案を作る
　・競合比較のページを作る
・既存顧客のフォロー
　・A社に進捗を連絡する
　・B社の契約更新日を確認する
・週次の数値をまとめる`;

// 宣言の末端タスク数が翌日の「分母」になる。
// 4〜6件で揺らして、タスク総数のグラフにも動きが出るようにしている
const DAYS = [
  {
    fact: `・提案資料の作成
　・構成案の作成
　・競合比較ページの作成
　・図版の差し替え
・既存顧客フォロー
　・A社へ進捗連絡
　・B社の契約更新日を確認
・週次数値の集計`,
    problem: '・競合比較の情報収集に時間がかかった\n・図版の差し替えが中途半端で終わった',
    why: `・想定より競合の情報が散らばっていた
　・どこまで調べるかの基準を決めずに始めた
　・調べながら資料を作ろうとして手が止まった`,
    commitment: `・提案資料をレビューに出す
　・数値パートを更新する
　・体裁を整える
・C社の情報収集
　・業界レポートを読む
　・過去の取引履歴を確認する
・B社へ連絡する
・週次数値をチームに共有する`,
    action: '・資料の型を先に決めてから中身を埋める',
    insight: '調べる範囲を先に区切ると早い。',
    one_word: '週の立ち上がりとしては上々でした。',
  },
  {
    fact: `・提案資料の更新
　・数値パートの更新
　・体裁の調整
・C社の情報収集
　・業界レポートの読み込み
　・過去取引履歴の確認
・B社へ連絡
・チーム定例に参加`,
    problem: '・レビュー依頼が夕方になってしまった',
    why: `・午前に差し込みの対応が入った
　・優先順位を決めずに来た順で着手した`,
    commitment: `・レビュー指摘の反映
　・数値の出典を明記する
　・構成を1枚にまとめ直す
・C社への提案準備
　・ヒアリング項目を洗い出す
・週報の作成`,
    action: '・朝いちで今日やることを3つに絞る',
    insight: '差し込みの前に、今日の優先度を決めておくべきだった。',
    one_word: '定例で良いフィードバックをもらえました。',
  },
  {
    fact: `・レビュー指摘の反映
　・数値の出典を追記
　・構成を1枚に整理
・C社の提案準備
　・ヒアリング項目の洗い出し
　・日程調整の連絡
・週報の作成`,
    problem: '・ヒアリング項目が固まりきらなかった\n・集中して作業できる時間が短かった',
    why: `・過去の提案を参照しようとして探すのに時間がかかった
　・保存場所が個人フォルダに散っていた`,
    commitment: `・C社ヒアリングの実施
　・課題を3つに絞って聞く
　・予算感を確認する
・提案資料をチームに共有する
　・共有フォルダに整理する
・過去提案の置き場所を統一する
・議事録を当日中にまとめる`,
    action: '・過去提案の置き場所を共有フォルダにまとめる',
    insight: '探している時間が一番もったいない。',
    one_word: '少し疲れが出てきた日でした。',
  },
  {
    fact: `・C社ヒアリングの実施
　・課題の整理
　・予算感の確認
　・次回提案の方向性のすり合わせ
・提案資料の共有
　・共有フォルダへの整理
・議事録の作成`,
    problem: '・特になし。想定どおり進んだ',
    why: '・前日までに準備を終えていたので迷いがなかった',
    commitment: `・C社向け提案書の作成
　・課題整理をスライドに落とす
　・見積もりの叩き台を作る
　・導入スケジュールを引く
・社内勉強会の準備
　・デモの流れを決める
　・資料の骨子を作る
・日報アプリのデモ環境を用意する`,
    action: '・ヒアリングメモを当日中にまとめる',
    insight: '準備が終わっている日は驚くほど進む。',
    one_word: '今日は手応えがありました。',
  },
  {
    fact: `・C社向け提案書の作成
　・課題整理のスライド化
　・見積もりの叩き台作成
　・導入スケジュールの作成
・社内勉強会の準備
　・デモの流れを決定
　・資料の骨子作成`,
    problem: '・見積もりの前提条件が詰めきれなかった',
    why: `・工数の見積もりに自信が持てなかった
　・似た案件の実績を確認していなかった`,
    commitment: `・見積もりの前提を上長に相談する
・勉強会の資料を仕上げる
　・スライドを作り切る
　・リハーサルをする
・提案書の最終チェック
　・誤字と数値の確認
・想定質問を3つ用意する`,
    action: '・過去案件の工数実績を一覧にしておく',
    insight: '見積もりは過去実績を見るのが近道。',
    one_word: '勉強会が楽しみです。',
  },
  {
    fact: `・見積もりの相談と修正
・社内勉強会の準備
　・スライドの完成
　・リハーサルの実施
・提案書の最終チェック
　・誤字と数値の確認
・想定質問の準備`,
    problem: '・特になし',
    why: '・相談を早めに入れたことで手戻りがなかった',
    commitment: `・勉強会を実施する
　・デモを実演する
　・質疑に対応する
・C社へ提案書を送付する
　・上長チェックを受ける
・翌週の予定を組む`,
    action: '・リハーサルの指摘を資料に反映しておく',
    insight: '早めの相談は手戻りを消す。',
    one_word: 'リハーサルの手応えが良かったです。',
  },
  {
    fact: `・社内勉強会の実施
　・デモの実演
　・質疑への対応
・C社へ提案書を送付
　・上長チェックの反映
・翌週の予定作成
・日報アプリの改善点整理`,
    problem: '・質疑で回答に詰まる場面があった',
    why: `・想定質問を用意していなかった
　・デモの流れだけ練習していた`,
    commitment: `・想定質問リストの作成
　・勉強会で出た質問をまとめる
　・回答例を用意する
・C社からの返答をフォローする
　・翌営業日に連絡する
・月次の振り返りを書く
・デモ環境を整える`,
    action: '・勉強会で出た質問をそのまま記録しておく',
    insight: '質疑まで含めてリハーサルすべきだった。',
    one_word: '無事に終わってほっとしています。',
  },
];

// ============================================================
// 振り返りの割り当て
// ============================================================
// 末端タスクの一覧に対して、目標の達成率になるよう 達成/一部達成/未達成 を割り振る。
// 一部達成=0.5 で数えるのはアプリ側と同じ規則。
function assignAchievements(leafCount, targetRate) {
  const targetScore = Math.round(leafCount * targetRate * 2) / 2;
  const fullCount = Math.floor(targetScore);
  const hasHalf = targetScore - fullCount === 0.5;

  return Array.from({ length: leafCount }, (_, i) => {
    if (i < fullCount) return '達成';
    if (i === fullCount && hasHalf) return '一部達成';
    return '未達成';
  });
}

const MISS_REASONS = [
  '想定より確認事項が多く、時間が足りなかった。',
  '差し込みの対応が入り、優先順位を切り替えられなかった。',
  '前提の確認待ちが発生し、着手が翌日になった。',
  '見積もりが甘く、想定の倍の時間がかかった。',
];

// ============================================================
// 本体
// ============================================================
async function main() {
  console.log(`接続先: ${SUPABASE_URL}`);

  // ---------- 1. デモユーザー ----------
  const found = await rest(`users?select=id,name&name=eq.${encodeURIComponent(DEMO_USER)}`);
  const demoUser =
    found.length > 0 ? found[0] : (await rest('users', { method: 'POST', body: { name: DEMO_USER } }))[0];
  console.log(`ユーザー「${DEMO_USER}」: ${found.length > 0 ? '既存を使用' : '新規作成'} (${demoUser.id})`);

  // ---------- 2. 既存のデモデータを消す（再実行できるように） ----------
  // daily_metrics / commitment_reviews は日報に対して ON DELETE CASCADE
  await rest(`daily_reports?user_id=eq.${demoUser.id}`, { method: 'DELETE' });
  await rest(`user_metrics_settings?user_id=eq.${demoUser.id}`, { method: 'DELETE' });
  console.log('既存のデモデータを削除しました。');

  // ---------- 3. 数値評価項目の設定 ----------
  const settings = await rest('user_metrics_settings', {
    method: 'POST',
    body: METRIC_SETTINGS.map((m, i) => ({ ...m, user_id: demoUser.id, sort_order: i })),
  });
  console.log(`数値評価項目: ${settings.map((s) => s.name).join(' / ')}`);

  // ---------- 4. 7日分の日報 ----------
  let prevReportId = null;
  let prevCommitment = SEED_PREV_COMMITMENT;

  for (let i = 0; i < DAYS.length; i += 1) {
    const day = DAYS[i];
    const reportDate = ymdDaysAgo(DAYS.length - 1 - i); // 古い順に入れる

    // 前回の宣言の末端タスクを評価する（アプリと同じ解析）
    const leaves = parseCommitmentLines(prevCommitment).filter((row) => !row.isParent);
    const achievements = assignAchievements(leaves.length, RATE_PLAN[i]);
    const stats = summarizeTasks(achievements.map((achievement) => ({ achievement })));

    // 今日のタスク総件数は、業務実績の末端項目の数
    const todayTaskCount = parseCommitmentLines(day.fact).filter((row) => !row.isParent).length;

    const [report] = await rest('daily_reports', {
      method: 'POST',
      body: {
        user_id: demoUser.id,
        report_date: reportDate,
        prev_achievement:
          stats.rate === 1 ? '達成できた' : stats.rate === 0 ? 'できなかった' : '一部できた',
        fact: day.fact,
        problem: day.problem,
        why: day.why,
        commitment: day.commitment,
        action: day.action,
        insight: day.insight,
        one_word: day.one_word,
        pmv_ratings: PMV_PLAN[i],
        carryover_task_total: stats.total,
        carryover_task_done: stats.score,
        today_task_count: todayTaskCount,
      },
    });

    // 行ごとの振り返り（一覧のサマリーとダッシュボードのタスク分析はこれを見ている）
    let missIndex = 0;
    await rest('commitment_reviews', {
      method: 'POST',
      body: leaves.map((leaf, line) => ({
        report_id: report.id,
        prev_report_id: prevReportId,
        line_no: line,
        line_text: leaf.text,
        achievement: achievements[line],
        reason:
          achievements[line] === '達成'
            ? null
            : MISS_REASONS[missIndex++ % MISS_REASONS.length],
      })),
    });

    // 数値実績
    await rest('daily_metrics', {
      method: 'POST',
      body: settings.map((setting, order) => ({
        report_id: report.id,
        metric_id: setting.id,
        name: setting.name,
        unit: setting.unit,
        value: METRIC_VALUES[setting.name][i],
        sort_order: order,
      })),
    });

    console.log(
      `  ${reportDate}  引き継ぎ ${stats.score}/${stats.total}` +
        `  今日のタスク ${todayTaskCount}件  コール ${METRIC_VALUES['コール件数'][i]}件`
    );

    prevReportId = report.id;
    prevCommitment = day.commitment;
  }

  console.log(`\n完了しました。ログイン画面で「${DEMO_USER}」を選ぶとデモデータが見られます。`);
}

main().catch((error) => {
  console.error('\n失敗しました:\n' + error.message);
  process.exit(1);
});
