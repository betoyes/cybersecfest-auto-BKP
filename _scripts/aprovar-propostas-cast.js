'use strict';

/**
 * Aprovação de propostas do CYBERSEC.CAST.
 * Mesmo fluxo do aprovar-propostas.js, mas usa:
 * - propostas-store-cast.js (propostas-cast.json)
 * - gerarArteCast em vez de gerarArte
 */

require('./load-env.js');

const { gerarArteCast } = require('./gerador-artes-cast.js');
const {
  loadStore, saveStore, newId, findProposta, getBancoOrdenado, countBanco, BANCO_MAX,
} = require('./utils/propostas-store-cast.js');

function aplicarEdicoes(proposta, edicoes = {}) {
  if (!edicoes || typeof edicoes !== 'object') return { ...proposta };
  const out = { ...proposta };
  for (const k of ['headline', 'subtitulo', 'palavras_azuis', 'contexto_visual', 'legenda', 'angulo', 'cta_visual']) {
    if (edicoes[k] != null && String(edicoes[k]).trim()) out[k] = String(edicoes[k]).trim();
  }
  return out;
}

function propostaParaArtePayload(proposta, tipoPost, opts = {}) {
  const layoutSugerido = /^[A-Q]$/i.test(proposta.layout_sugerido || '') ? String(proposta.layout_sugerido).toUpperCase() : null;
  return {
    tipoPost: proposta.tipo_post || tipoPost,
    headline:       proposta.headline,
    subtitulo:      proposta.subtitulo,
    palavrasAzuis:  proposta.palavras_azuis,
    contextoVisual: proposta.contexto_visual,
    legendaAprovada: proposta.legenda,
    publicacao:     opts.publicacao || 'normal',
    propostaId:     proposta.id,
    angulo:         proposta.angulo,
    ctaVisual:      proposta.cta_visual,
    // layout_sugerido do LLM é apenas informativo — a rotação (pickCastLayout)
    // decide, para garantir variedade visual sem repetição.
    layoutOverride: opts.forcarLayout || null,
    layoutSugeridoLlm: layoutSugerido,
  };
}

function itemBancoFromProposta(proposta, lote) {
  return {
    id: newId('cast-banco'),
    status: 'aprovado_texto',
    tipo_post: proposta.tipo_post || lote.tipo_post,
    angulo:         proposta.angulo,
    headline:       proposta.headline,
    subtitulo:      proposta.subtitulo,
    palavras_azuis: proposta.palavras_azuis,
    legenda:        proposta.legenda,
    contexto_visual:proposta.contexto_visual,
    cta_visual:     proposta.cta_visual || '',
    layout_sugerido:proposta.layout_sugerido || null,
    aprovado_em:    new Date().toISOString(),
    origem_lote:    lote.id,
  };
}

/**
 * Aprova lote CAST: gera arte para a proposta principal, manda outras pro banco.
 */
async function aprovarLoteCast(opts) {
  const { loteId, principalId, bancoIds = [], edicoes = {} } = opts;
  const { data, sha } = await loadStore();

  const lote = (data.lotes || []).find(l => l.id === loteId);
  if (!lote) throw new Error('Lote CAST não encontrado');
  if (lote.status !== 'aguardando_aprovacao') throw new Error('Lote CAST já foi processado');

  const found = findProposta(data, loteId, principalId);
  if (!found) throw new Error('Proposta CAST principal não encontrada');

  const principal = aplicarEdicoes(found.proposta, edicoes[principalId]);
  const idsUsados = new Set([principalId]);

  console.log(`\n✅ CAST — Aprovando lote ${loteId}`);
  console.log(`   Principal: ${principal.angulo} → gerando arte...`);

  const resultado = await gerarArteCast(propostaParaArtePayload(principal, lote.tipo_post, { publicacao: 'normal' }));

  const bancoNovos = [];
  for (const bid of bancoIds) {
    if (bid === principalId || idsUsados.has(bid)) continue;
    const f = findProposta(data, loteId, bid);
    if (!f) continue;
    const prop = aplicarEdicoes(f.proposta, edicoes[bid]);
    idsUsados.add(bid);
    if (countBanco(data) + bancoNovos.length >= BANCO_MAX) {
      console.warn(`⚠️  CAST banco cheio — ignorando ${prop.angulo}`);
      continue;
    }
    bancoNovos.push(itemBancoFromProposta(prop, lote));
    console.log(`   Banco CAST: ${prop.angulo}`);
  }

  data.banco = [...(data.banco || []), ...bancoNovos];
  lote.status        = 'concluido';
  lote.concluido_em  = new Date().toISOString();
  lote.principal_id  = principalId;
  lote.slug_gerado   = resultado.slug;

  await saveStore(data, sha);

  return {
    slug: resultado.slug,
    layout: resultado.layout,
    bancoAdicionados: bancoNovos.length,
    bancoTotal: countBanco(data),
  };
}

async function rejeitarLoteCast(loteId) {
  const { data, sha } = await loadStore();
  const lote = (data.lotes || []).find(l => l.id === loteId);
  if (!lote) throw new Error('Lote CAST não encontrado');
  lote.status = 'rejeitado';
  lote.rejeitado_em = new Date().toISOString();
  await saveStore(data, sha);
  return { ok: true };
}

async function consumirBancoCast() {
  const { data, sha } = await loadStore();
  const fila = getBancoOrdenado(data);
  if (!fila.length) return null;

  const item = fila[0];
  data.banco = data.banco.filter(b => b.id !== item.id);
  await saveStore(data, sha);

  console.log(`\n📦 CAST — Consumindo banco: ${item.angulo} (${item.id})`);

  const resultado = await gerarArteCast({
    tipoPost:        item.tipo_post,
    headline:        item.headline,
    subtitulo:       item.subtitulo,
    palavrasAzuis:   item.palavras_azuis,
    contextoVisual:  item.contexto_visual,
    legendaAprovada: item.legenda,
    publicacao:      'normal',
    propostaId:      item.id,
    angulo:          item.angulo,
    ctaVisual:       item.cta_visual,
    layoutOverride:  null, // rotação decide (layout_sugerido do LLM é informativo)
  });

  return { ...resultado, fromBanco: true, bancoId: item.id };
}

async function getEstadoPropostasCast() {
  const { data } = await loadStore();
  return {
    lotePendente: (data.lotes || []).find(l => l.status === 'aguardando_aprovacao') || null,
    banco: getBancoOrdenado(data),
    bancoCount: countBanco(data),
    bancoMax: BANCO_MAX,
  };
}

module.exports = {
  aprovarLoteCast,
  rejeitarLoteCast,
  consumirBancoCast,
  getEstadoPropostasCast,
};
