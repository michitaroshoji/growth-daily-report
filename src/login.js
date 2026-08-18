import { supabase, isConfigured } from './supabase.js';
import { getCurrentUser } from './session.js';

const button = document.getElementById('google-btn');
const message = document.getElementById('message');
const form = document.getElementById('password-form');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const passwordButton = document.getElementById('password-btn');

function setMessage(text, type) {
  message.textContent = text || '';
  message.className = type ? `message message-${type}` : 'message';
}

// 通信中は全部の操作を止めて、二重ログインを防ぐ
function setBusy(busy) {
  button.disabled = busy;
  passwordButton.disabled = busy;
  emailInput.disabled = busy;
  passwordInput.disabled = busy;
}

// Supabaseのエラーは英語で返るので、利用者に伝わる日本語に置き換える
function authErrorMessage(error) {
  const raw = String((error && error.message) || '');

  if (/invalid login credentials/i.test(raw)) {
    return 'メールアドレスまたはパスワードが違います。もう一度ご確認ください。';
  }
  if (/email not confirmed/i.test(raw)) {
    return 'このアカウントはメールアドレスの確認が済んでいません。確認メールのリンクを開いてください。';
  }
  if (/invalid email|email address .* is invalid/i.test(raw)) {
    return 'メールアドレスの形式が正しくありません。';
  }
  if (/too many requests|rate limit/i.test(raw)) {
    return 'ログインの試行が多すぎます。しばらく待ってからもう一度お試しください。';
  }
  if (/failed to fetch|network/i.test(raw)) {
    return 'サーバーに接続できませんでした。通信環境を確認してもう一度お試しください。';
  }
  return 'ログインに失敗しました: ' + (raw || '原因不明のエラー');
}

// 画面を開いた時点でログイン済みなら、そのままメイン画面へ送る
async function init() {
  if (!isConfigured) {
    setMessage('.env に Supabase の URL とキーを設定して、npm run dev を再起動してください。', 'error');
    return;
  }

  const user = await getCurrentUser();
  if (user) {
    location.replace('report.html');
    return;
  }

  setBusy(false);
  setMessage('', null);
}

button.addEventListener('click', async () => {
  setBusy(true);
  setMessage('Googleの認証画面へ移動します...', null);

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      // 認証後にこのアプリのどこへ戻すか。Supabaseの Redirect URLs に登録が必要
      redirectTo: new URL('report.html', location.href).href,
      queryParams: { prompt: 'select_account' },
    },
  });

  // 成功時はGoogleへ遷移してしまうので、ここに来るのは失敗したときだけ
  if (error) {
    setBusy(false);
    setMessage('ログインに失敗しました: ' + error.message, 'error');
  }
});

// 社外向け：メール/パスワードでのログイン
form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !password) {
    setMessage('メールアドレスとパスワードを入力してください。', 'error');
    (email ? passwordInput : emailInput).focus();
    return;
  }

  setBusy(true);
  setMessage('ログインしています...', null);

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    setBusy(false);
    setMessage(authErrorMessage(error), 'error');
    passwordInput.value = '';
    passwordInput.focus();
    return;
  }

  location.replace('report.html');
});

init();
