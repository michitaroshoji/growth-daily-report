import { supabase, isConfigured } from './supabase.js';
import { getCurrentUser } from './session.js';

const button = document.getElementById('google-btn');
const message = document.getElementById('message');

function setMessage(text, type) {
  message.textContent = text || '';
  message.className = type ? `message message-${type}` : 'message';
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

  button.disabled = false;
  setMessage('', null);
}

button.addEventListener('click', async () => {
  button.disabled = true;
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
    button.disabled = false;
    setMessage('ログインに失敗しました: ' + error.message, 'error');
  }
});

init();
