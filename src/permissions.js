// ============================================================
// 権限判定
//   ここが唯一の判定元。画面ごとに条件を書き散らさない。
//   ※ UI制御は「見せない」だけの話で、実際の防御はSupabaseのRLSが行う
//     （supabase/schema_v11_departments.sql と条件を必ず揃えること）
// ============================================================

// 権限3階層。並び順がそのまま管理画面のドロップダウンの並びになる
export const ROLES = [
  { value: 'admin', label: '管理者' },
  { value: 'member', label: '一般' },
  { value: 'restricted', label: '制限付き' },
];

export const DEFAULT_ROLE = 'member';

// 昇格の事故で管理者が居なくなったときの逃げ道。
// 通常の判定は users.role で行う（RLS側の is_admin() と同じ値にする）
export const ADMIN_EMAILS = ['michitaro.shoji@teetime.co.jp'];

function normalize(email) {
  return String(email || '').trim().toLowerCase();
}

export function roleLabel(role) {
  const found = ROLES.find((item) => item.value === role);
  return found ? found.label : ROLES.find((item) => item.value === DEFAULT_ROLE).label;
}

export function isAdmin(user) {
  if (user && user.role === 'admin') return true;
  const email = normalize(user && user.email);
  return email !== '' && ADMIN_EMAILS.includes(email);
}

// 制限付きユーザー。自分の日報しか見られない
export function isRestricted(user) {
  return !!user && user.role === 'restricted' && !isAdmin(user);
}

// 他人の日報を一覧・検索してよいか
export function canSeeOthers(user) {
  return !isRestricted(user);
}

// その日報を編集・削除してよいか。
// 1) 自分が書いた日報である  2) 管理者である
export function canManageReport(user, report) {
  if (!user || !report) return false;
  return report.user_id === user.id || isAdmin(user);
}
