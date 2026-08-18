// 画面上部の共通ナビゲーション。
// マークアップは全画面で同じものを置き、今いる画面だけ JS で印を付ける。
export function setActiveNav(current) {
  document.querySelectorAll('.navbtn').forEach((button) => {
    const isActive = button.dataset.nav === current;
    button.classList.toggle('is-active', isActive);
    // 色だけに頼らず、支援技術にも「今このページ」と伝える
    if (isActive) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
}
