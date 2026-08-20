// Supabase Auth のセッションを扱うヘルパー。
// 以前は localStorage による簡易ログインだったが、Googleログインに置き換えた。
import { supabase } from './supabase.js';
import { DEFAULT_ROLE } from './permissions.js';

// 凍結アカウントに出す案内。ログイン画面と共通で使う
export const FROZEN_MESSAGE =
  'このアカウントは現在凍結されています。管理者にお問い合わせください。';

// Googleのプロフィールから表示名を組み立てる
function displayName(authUser) {
  const meta = authUser.user_metadata || {};
  return (
    meta.full_name ||
    meta.name ||
    (authUser.email ? authUser.email.split('@')[0] : 'ユーザー')
  );
}

// public.users 側のプロフィール（権限・所属部署・凍結）。
// schema_v11 未適用のDBでは列が無くてエラーになるが、
// 画面を止めるほどのことではないので既定値へ倒す
async function fetchProfile(id) {
  const { data, error } = await supabase
    .from('users')
    .select('name, role, department_id, is_frozen')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('プロフィールの取得に失敗しました', error);
    return null;
  }
  return data;
}

// ログイン中のユーザー。未ログインなら null
export async function getCurrentUser() {
  // getSession() はクライアント初期化（OAuthリダイレクトの処理）の完了を待ってから返る
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) return null;

  const profile = await fetchProfile(session.user.id);

  return {
    id: session.user.id, // = auth.uid()。日報の user_id にそのまま使う
    // 表示名は管理者が付け替えられるので、あればDB側を優先する
    name: (profile && profile.name) || displayName(session.user),
    email: session.user.email || '',
    role: (profile && profile.role) || DEFAULT_ROLE,
    departmentId: (profile && profile.department_id) || null,
    isFrozen: !!(profile && profile.is_frozen),
  };
}

// ログインしていなければログイン画面へ戻す。ログイン済みならユーザーを返す
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) {
    location.replace('index.html');
    return null;
  }
  // 凍結アカウントはアプリに入れない（DB側も書き込みを弾いている）
  if (user.isFrozen) {
    await supabase.auth.signOut();
    location.replace('index.html?frozen=1');
    return null;
  }
  return user;
}

export async function signOut() {
  await supabase.auth.signOut();
  location.replace('index.html');
}
