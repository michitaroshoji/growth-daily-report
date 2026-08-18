// ============================================================
// 権限判定
//   ここが唯一の判定元。画面ごとに条件を書き散らさない。
//   ※ UI制御は「見せない」だけの話で、実際の防御はSupabaseのRLSが行う
//     （supabase/schema_v6_admin.sql と条件を必ず揃えること）
// ============================================================

// 管理者のメールアドレス（RLS側の is_admin() と同じ値にする）
export const ADMIN_EMAILS = ['michitaro.shoji@teetime.co.jp'];

function normalize(email) {
  return String(email || '').trim().toLowerCase();
}

export function isAdmin(user) {
  const email = normalize(user && user.email);
  return email !== '' && ADMIN_EMAILS.includes(email);
}

// その日報を編集・削除してよいか。
// 1) 自分が書いた日報である  2) 管理者である
export function canManageReport(user, report) {
  if (!user || !report) return false;
  return report.user_id === user.id || isAdmin(user);
}
