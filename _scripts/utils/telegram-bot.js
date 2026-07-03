'use strict';

// Bot Telegram bidirecional — aprovação de propostas pelo celular.
// Quando um lote de propostas é gerado (FEST, CAST ou cliente dinâmico),
// envia as opções com botões inline; responder ✅ 1/2/3 aprova via API local
// e ❌ rejeita o lote. Requer TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID no
// _scripts/.env — sem eles todo o módulo é no-op silencioso.
//
// Callback data (limite de 64 bytes): "apv|{cliente}|{idx}" e "rej|{cliente}".
// O lote completo fica em memória (lotesPendentes) — o processo do bot é o
// mesmo do dev-server, então não há serialização entre processos.

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const POLL_TIMEOUT_S = 50;

// cliente → { lote, modo: 'dinamico'|'cast'|'fest' }
const lotesPendentes = new Map();

let apiBase   = 'http://127.0.0.1:8765';
let rodando   = false;
let offset    = 0;

function token()  { return process.env.TELEGRAM_BOT_TOKEN; }
function chatId() { return process.env.TELEGRAM_CHAT_ID; }
function botConfigurado() { return Boolean(token() && chatId()); }

async function tg(metodo, payload) {
  const r = await fetch(`https://api.telegram.org/bot${token()}/${metodo}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await r.json().catch(() => ({}));
  if (!data.ok) throw new Error(`${metodo}: ${data.description || r.status}`);
  return data.result;
}

function limparHtml(s) {
  return String(s || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').trim();
}

// ── Notificação de lote novo ───────────────────────────────────────
// modo: 'dinamico' (aprovar por idx), 'cast' ou 'fest' (aprovar por loteId+principalId)
async function notificarPropostas(cliente, lote, modo = 'dinamico') {
  if (!botConfigurado() || !lote?.propostas?.length) return;

  lotesPendentes.set(cliente, { lote, modo });

  const numeros = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];
  const linhas = lote.propostas.map((p, i) => {
    const hl  = limparHtml(p.headline);
    const sub = limparHtml(p.subtitulo);
    const rec = p.recomendada ? ' ⭐' : '';
    return `${numeros[i] || `${i + 1}.`} *${hl}*${rec}${sub ? `\n    _${sub}_` : ''}`;
  }).join('\n\n');

  const texto = `🗳 *${cliente.toUpperCase()}* — ${lote.propostas.length} propostas (${lote.tipo || lote.tipoPost || 'post'})\n\n${linhas}\n\nAprovar gera a imagem e cria a arte.`;

  const botoesAprovar = lote.propostas.map((_, i) => ({
    text: `✅ ${i + 1}`,
    callback_data: `apv|${cliente}|${i}`,
  }));

  try {
    await tg('sendMessage', {
      chat_id: chatId(),
      text: texto,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [botoesAprovar, [{ text: '❌ Rejeitar lote', callback_data: `rej|${cliente}` }]] },
    });
    console.log(`📨 Telegram: lote de propostas enviado (${cliente})`);
  } catch (e) {
    console.warn('⚠️  Telegram notificarPropostas:', e.message);
  }
}

// ── Ações dos botões ───────────────────────────────────────────────
async function postApi(pathname, body) {
  const r = await fetch(`${apiBase}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.ok === false) throw new Error(data.erro || `HTTP ${r.status}`);
  return data;
}

function rotasDoCliente(cliente, modo) {
  if (modo === 'fest') return { aprovar: '/api/propostas/aprovar', rejeitar: '/api/propostas/rejeitar' };
  return { aprovar: `/api/${cliente}/propostas/aprovar`, rejeitar: `/api/${cliente}/propostas/rejeitar` };
}

async function enviarThumb(slug, legenda) {
  const thumbPath = path.join(ROOT, 'artes', slug, 'thumb.png');
  // thumb é gerado async após a arte — espera curta antes de cair no texto
  for (let i = 0; i < 5 && !fs.existsSync(thumbPath); i++) {
    await new Promise(r => setTimeout(r, 2000));
  }
  if (!fs.existsSync(thumbPath)) {
    return tg('sendMessage', { chat_id: chatId(), text: legenda });
  }
  const form = new FormData();
  form.append('chat_id', chatId());
  form.append('caption', legenda.slice(0, 1024));
  form.append('photo', new Blob([fs.readFileSync(thumbPath)], { type: 'image/png' }), 'arte.png');
  const r = await fetch(`https://api.telegram.org/bot${token()}/sendPhoto`, { method: 'POST', body: form });
  if (!r.ok) throw new Error(`sendPhoto ${r.status}`);
}

async function aprovarViaBot(cliente, idx) {
  const pendente = lotesPendentes.get(cliente);
  if (!pendente) throw new Error('lote não está mais pendente — aprove pela galeria');

  const { lote, modo } = pendente;
  const proposta = lote.propostas[idx];
  if (!proposta) throw new Error('proposta inválida');

  const rotas = rotasDoCliente(cliente, modo);
  const body = modo === 'dinamico'
    ? { idx }
    : { loteId: lote.id, principalId: proposta.id };

  const resultado = await postApi(rotas.aprovar, body);
  lotesPendentes.delete(cliente);
  return resultado;
}

async function rejeitarViaBot(cliente) {
  const pendente = lotesPendentes.get(cliente);
  if (!pendente) throw new Error('lote não está mais pendente');

  const { lote, modo } = pendente;
  const rotas = rotasDoCliente(cliente, modo);
  await postApi(rotas.rejeitar, modo === 'dinamico' ? {} : { loteId: lote.id });
  lotesPendentes.delete(cliente);
}

async function tratarCallback(cb) {
  // só aceita comandos do chat autorizado
  if (String(cb.message?.chat?.id) !== String(chatId())) {
    return tg('answerCallbackQuery', { callback_query_id: cb.id, text: 'Não autorizado' }).catch(() => {});
  }

  const [acao, cliente, idxStr] = String(cb.data || '').split('|');

  try {
    if (acao === 'apv') {
      await tg('answerCallbackQuery', { callback_query_id: cb.id, text: '⏳ Gerando imagem (30–90s)…' });
      const idx = parseInt(idxStr, 10) || 0;
      const resultado = await aprovarViaBot(cliente, idx);
      const slug = resultado.slug || resultado.arte?.slug;
      await enviarThumb(slug, `✅ [${cliente}] Arte criada: ${slug}`);
    } else if (acao === 'rej') {
      await tg('answerCallbackQuery', { callback_query_id: cb.id, text: 'Lote rejeitado' });
      await rejeitarViaBot(cliente);
      await tg('sendMessage', { chat_id: chatId(), text: `❌ [${cliente}] Lote de propostas rejeitado.` });
    } else {
      await tg('answerCallbackQuery', { callback_query_id: cb.id, text: 'Comando desconhecido' });
    }
  } catch (e) {
    console.warn('⚠️  Telegram callback:', e.message);
    tg('sendMessage', { chat_id: chatId(), text: `⚠️ [${cliente}] Falhou: ${e.message}` }).catch(() => {});
  }
}

// ── Long polling ───────────────────────────────────────────────────
async function loopUpdates() {
  while (rodando) {
    try {
      const updates = await tg('getUpdates', {
        offset,
        timeout: POLL_TIMEOUT_S,
        allowed_updates: ['callback_query'],
      });
      for (const up of updates) {
        offset = up.update_id + 1;
        if (up.callback_query) await tratarCallback(up.callback_query);
      }
    } catch (e) {
      console.warn('⚠️  Telegram polling:', e.message);
      await new Promise(r => setTimeout(r, 10_000));
    }
  }
}

function iniciarTelegramBot(opts = {}) {
  if (opts.apiBase) apiBase = opts.apiBase;
  if (!botConfigurado()) return false;
  if (rodando) return true;
  rodando = true;
  loopUpdates();
  console.log('🤖 Telegram bot ativo — aprovação de propostas pelo chat');
  return true;
}

function pararTelegramBot() { rodando = false; }

module.exports = { iniciarTelegramBot, pararTelegramBot, notificarPropostas, botConfigurado };
