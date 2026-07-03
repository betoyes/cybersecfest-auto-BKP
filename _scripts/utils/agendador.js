// Agendador de publicação — verifica `publicar_em` em todos os bancos de artes
// e publica automaticamente quando a data chega. Roda no dev-server via setInterval.
'use strict';

const fs   = require('fs');
const path = require('path');
const { atomicWriteFileSync } = require('./atomic-write.js');

const ROOT = path.join(__dirname, '..', '..');
const INTERVALO_MS = 60_000;

function bancosDisponiveis() {
  const fixos = ['artes.json', 'artes-cast.json'];
  let dinamicos = [];
  try {
    const clients = JSON.parse(fs.readFileSync(path.join(ROOT, '_clients.json'), 'utf8'));
    dinamicos = clients.filter(c => c.ativo).map(c => `artes-${c.slug}.json`);
  } catch { /* sem clientes dinâmicos */ }
  return [...fixos, ...dinamicos]
    .map(f => path.join(ROOT, f))
    .filter(f => fs.existsSync(f));
}

// Publica artes agendadas cuja data já passou. Retorna quantas publicou.
// bancos: lista de paths opcional (default: todos os bancos do projeto).
function verificarAgendamentos(bancos = bancosDisponiveis()) {
  const agora = new Date().toISOString();
  let publicadas = 0;

  for (const banco of bancos) {
    let artes;
    try { artes = JSON.parse(fs.readFileSync(banco, 'utf8')); } catch { continue; }
    if (!Array.isArray(artes)) continue;

    const paraPublicar = artes.filter(a => !a.publicado && a.publicar_em && a.publicar_em <= agora);
    if (!paraPublicar.length) continue;

    for (const arte of paraPublicar) {
      arte.publicado    = true;
      arte.publicado_em = agora;
      arte.publicar_em  = null;
      console.log(`✅ Agendador: auto-publicou ${arte.slug} (${path.basename(banco)})`);
      publicadas++;
      notificarTelegram(arte).catch(e => console.warn('⚠️  Telegram:', e.message));
    }
    atomicWriteFileSync(banco, JSON.stringify(artes, null, 2) + '\n');
  }

  return publicadas;
}

// Envia a arte publicada via Telegram (PNG + legenda) — no-op se as env vars não existirem.
// Requer TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID no _scripts/.env
async function notificarTelegram(arte) {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  const headline = (arte.headline || arte.slug).replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '');
  const caption  = `🚀 Publicado agora: ${headline}\n\n${arte.legenda || ''}`.slice(0, 1024);
  const thumbPath = path.join(ROOT, 'artes', arte.slug, 'thumb.png');

  if (fs.existsSync(thumbPath)) {
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('caption', caption);
    form.append('photo', new Blob([fs.readFileSync(thumbPath)], { type: 'image/png' }), 'arte.png');
    const r = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', body: form });
    if (!r.ok) throw new Error(`sendPhoto ${r.status}`);
  } else {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: caption }),
    });
    if (!r.ok) throw new Error(`sendMessage ${r.status}`);
  }
  console.log(`📨 Telegram: notificação enviada para ${arte.slug}`);
}

// onChange: chamado quando alguma arte foi publicada (ex.: invalidar caches do servidor)
function iniciarAgendador(onChange = null) {
  const timer = setInterval(() => {
    try {
      const publicadas = verificarAgendamentos();
      if (publicadas > 0 && typeof onChange === 'function') onChange();
    } catch (e) { console.warn('⚠️  Agendador:', e.message); }
  }, INTERVALO_MS);
  timer.unref();
  return timer;
}

module.exports = { verificarAgendamentos, iniciarAgendador, notificarTelegram, INTERVALO_MS };
