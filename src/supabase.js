// Supabase クライアントを1か所で作って、各画面から使い回す
import { createClient } from '@supabase/supabase-js';

// Parcel が .env の値をビルド時にここへ埋め込みます
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

export const isConfigured =
  !!SUPABASE_URL && SUPABASE_URL.startsWith('https://') && !!SUPABASE_ANON_KEY;

// 未設定のときに出す案内。何が足りないかと、次に何をすればいいかを1文で伝える
const NOT_CONFIGURED_MESSAGE =
  '.env の SUPABASE_URL / SUPABASE_ANON_KEY が未設定です。.env.example をコピーして値を入れ、npm run dev を再起動してください。';

// 画面上部に警告帯を出す。
// 各画面の isConfigured の案内はその欄にしか出ないので、
// どの画面を開いても未設定に気づけるよう、ここでまとめて出す。
function showNotConfiguredBanner() {
  const render = () => {
    if (document.getElementById('supabase-not-configured')) return;

    const banner = document.createElement('p');
    banner.id = 'supabase-not-configured';
    // デモモードの警告帯と同じ見た目を使い回す（style.css の .demo-banner）
    banner.className = 'demo-banner';
    banner.setAttribute('role', 'alert');
    banner.textContent = '⚠ Supabase 未設定：' + NOT_CONFIGURED_MESSAGE;
    document.body.prepend(banner);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render, { once: true });
  } else {
    render();
  }
}

// 未設定のときに本物の代わりに渡す張りぼて。
// 接続先を直書きすると公開リポジトリに実在のURLを載せることになるので、そもそも作らない。
// import しただけで例外を投げると、その画面が真っ白になって原因が分からなくなるため、
// 呼ばれても投げずに「未設定」というエラーを返すだけにする。
function notConfiguredClient() {
  const error = { message: NOT_CONFIGURED_MESSAGE };

  // .from('x').select().eq().order() のように繋いでも落ちないよう、
  // 知らないメソッドは自分自身を返す。await されたときだけ { data, error } になる
  const query = new Proxy(
    { then: (resolve) => resolve({ data: null, error }) },
    { get: (target, key) => (key in target ? target[key] : () => query) }
  );

  return {
    from: () => query,
    auth: {
      // 未ログイン扱いにする。各画面はログイン画面へ戻り、そこで案内を読める
      getSession: async () => ({ data: { session: null }, error: null }),
      signInWithOAuth: async () => ({ data: null, error }),
      signInWithPassword: async () => ({ data: null, error }),
      signOut: async () => ({ error: null }),
    },
  };
}

if (!isConfigured) {
  console.error(NOT_CONFIGURED_MESSAGE);
  showNotConfiguredBanner();
}

export const supabase = isConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : notConfiguredClient();
