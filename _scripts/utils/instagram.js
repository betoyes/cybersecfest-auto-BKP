'use strict';

// Publicação real no Instagram via Graph API (conta business/creator).
// Requer no _scripts/.env:
//   IG_USER_ID          — id da conta Instagram Business (não é o @username)
//   IG_ACCESS_TOKEN     — token de longa duração com instagram_content_publish
//   IG_PUBLIC_BASE_URL  — URL pública onde /artes/{slug}/thumb.png está acessível
//                         (ex.: deploy Vercel — a Graph API só aceita image_url público)
// Sem as três vars é no-op silencioso, igual ao Telegram.

const GRAPH_BASE       = 'https://graph.facebook.com/v21.0';
const POLL_TENTATIVAS  = 10;
const POLL_INTERVAL_MS = 3000;
const CAPTION_MAX      = 2200;

function igConfigurado() {
  return Boolean(process.env.IG_USER_ID && process.env.IG_ACCESS_TOKEN && process.env.IG_PUBLIC_BASE_URL);
}

async function graphPost(pathname, params) {
  const body = new URLSearchParams({ ...params, access_token: process.env.IG_ACCESS_TOKEN });
  const r = await fetch(`${GRAPH_BASE}/${pathname}`, { method: 'POST', body });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) {
    throw new Error(`Graph API ${pathname}: ${data.error?.message || r.status}`);
  }
  return data;
}

async function graphGet(pathname, params) {
  const qs = new URLSearchParams({ ...params, access_token: process.env.IG_ACCESS_TOKEN });
  const r = await fetch(`${GRAPH_BASE}/${pathname}?${qs}`);
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) {
    throw new Error(`Graph API ${pathname}: ${data.error?.message || r.status}`);
  }
  return data;
}

function montarCaption(arte) {
  const headline = (arte.headline || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').trim();
  const legenda  = (arte.legenda || '').trim();
  const caption  = legenda || headline;
  return caption.slice(0, CAPTION_MAX);
}

async function aguardarContainer(creationId) {
  for (let i = 0; i < POLL_TENTATIVAS; i++) {
    const { status_code: status } = await graphGet(creationId, { fields: 'status_code' });
    if (status === 'FINISHED') return;
    if (status === 'ERROR') throw new Error('container de mídia falhou no processamento');
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error('timeout aguardando processamento do container de mídia');
}

/**
 * Publica a arte no feed do Instagram. Retorna o media id publicado,
 * ou null se o Instagram não estiver configurado.
 * A thumb precisa já estar acessível em IG_PUBLIC_BASE_URL (deploy feito).
 */
async function publicarNoInstagram(arte) {
  if (!igConfigurado()) return null;

  const base     = process.env.IG_PUBLIC_BASE_URL.replace(/\/+$/, '');
  const imageUrl = `${base}/artes/${arte.slug}/thumb.png`;
  const userId   = process.env.IG_USER_ID;

  const container = await graphPost(`${userId}/media`, {
    image_url: imageUrl,
    caption:   montarCaption(arte),
  });

  await aguardarContainer(container.id);

  const publicado = await graphPost(`${userId}/media_publish`, { creation_id: container.id });
  console.log(`📸 Instagram: publicado ${arte.slug} (media ${publicado.id})`);
  return publicado.id;
}

module.exports = { publicarNoInstagram, igConfigurado };
