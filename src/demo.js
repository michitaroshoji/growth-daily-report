// ============================================================
// デモモード
//   ヘッダーのボタンで「デモ太郎」のデータ表示に切り替える。
//   閲覧専用の切り替えで、日報の作成・編集は常に自分のアカウントで行う。
// ============================================================
import { supabase } from './supabase.js';

const STORAGE_KEY = 'gdr_demo_mode';
export const DEMO_USER_NAME = 'デモ太郎';

export function isDemoMode() {
  return localStorage.getItem(STORAGE_KEY) === '1';
}

export function setDemoMode(on) {
  if (on) localStorage.setItem(STORAGE_KEY, '1');
  else localStorage.removeItem(STORAGE_KEY);
}

// 「デモ太郎」を名前で引いて user_id を得る。1回引いたら使い回す
let demoUserPromise = null;

export function fetchDemoUser() {
  if (!demoUserPromise) {
    demoUserPromise = supabase
      .from('users')
      .select('id, name')
      .eq('name', DEMO_USER_NAME)
      .maybeSingle()
      .then(({ data, error }) => (error ? null : data));
  }
  return demoUserPromise;
}

// 各画面が「どのユーザーのデータを表示するか」を決める。
// デモ太郎が見つからない場合は通常表示にフォールバックする（画面が壊れないように）
export async function resolveViewUser(currentUser) {
  if (!isDemoMode()) {
    return { id: currentUser.id, name: currentUser.name, isDemo: false };
  }

  const demo = await fetchDemoUser();
  if (!demo) {
    setDemoMode(false); // デモデータが消えていたら勝手に解除する
    return { id: currentUser.id, name: currentUser.name, isDemo: false, demoMissing: true };
  }

  return { id: demo.id, name: demo.name, isDemo: true };
}

// ヘッダーのボタンを配線する。切り替えたらリロードして状態を作り直す
// （画面ごとに部分更新すると取りこぼしが出るため、まるごと読み直すのが確実）
export function setupDemoToggle() {
  const button = document.getElementById('demo-btn');
  if (!button) return;

  const on = isDemoMode();
  button.textContent = on ? '📊 デモモードを終了' : '📊 デモモードを見る';
  button.classList.toggle('is-on', on);

  button.addEventListener('click', () => {
    setDemoMode(!isDemoMode());
    location.reload();
  });
}

// デモ表示中であることを画面上に明示する
export function showDemoBanner(viewUser) {
  const banner = document.getElementById('demo-banner');
  if (!banner) return;

  banner.hidden = !viewUser.isDemo;
  if (viewUser.isDemo) {
    banner.textContent = `デモモード表示中：「${viewUser.name}」のデータを見ています（編集はできません）`;
  }
}
