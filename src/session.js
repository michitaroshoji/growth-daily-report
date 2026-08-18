// Supabase Auth のセッションを扱うヘルパー。
// 以前は localStorage による簡易ログインだったが、Googleログインに置き換えた。
import { supabase } from './supabase.js';

// Googleのプロフィールから表示名を組み立てる
function displayName(authUser) {
  const meta = authUser.user_metadata || {};
  return (
    meta.full_name ||
    meta.name ||
    (authUser.email ? authUser.email.split('@')[0] : 'ユーザー')
  );
}

// ログイン中のユーザー。未ログインなら null
export async function getCurrentUser() {
  // getSession() はクライアント初期化（OAuthリダイレクトの処理）の完了を待ってから返る
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) return null;

  return {
    id: session.user.id, // = auth.uid()。日報の user_id にそのまま使う
    name: displayName(session.user),
    email: session.user.email || '',
  };
}

// ログインしていなければログイン画面へ戻す。ログイン済みならユーザーを返す
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) {
    location.replace('index.html');
    return null;
  }
  return user;
}

export async function signOut() {
  await supabase.auth.signOut();
  location.replace('index.html');
}
