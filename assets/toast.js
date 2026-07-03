// Toast de notificação compartilhado pelas galerias — substitui alert().
// Uso: toast('mensagem') — detecta erro pelo prefixo ❌/Erro e muda a cor.
(function () {
  function toast(msg) {
    let wrap = document.getElementById('toast-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'toast-wrap';
      wrap.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none;';
      document.body.appendChild(wrap);
    }
    const isErr = /^(❌|Erro|Falha)/i.test(String(msg).trim());
    const el = document.createElement('div');
    el.textContent = String(msg);
    el.style.cssText =
      'max-width:420px;padding:10px 18px;border-radius:10px;font-size:13px;line-height:1.45;' +
      'font-family:Inter,-apple-system,sans-serif;color:#fff;box-shadow:0 8px 30px rgba(0,0,0,.5);' +
      'opacity:0;transition:opacity .25s,transform .25s;transform:translateY(8px);' +
      (isErr ? 'background:#7f1d1d;border:1px solid #b91c1c;' : 'background:#111827;border:1px solid #374151;');
    wrap.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateY(0)'; });
    setTimeout(() => {
      el.style.opacity = '0'; el.style.transform = 'translateY(8px)';
      setTimeout(() => el.remove(), 300);
    }, 4000);
  }
  window.toast = toast;
})();
