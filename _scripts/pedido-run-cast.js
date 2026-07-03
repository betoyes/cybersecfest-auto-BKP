'use strict';

/**
 * Runner de pedido do CYBERSEC.CAST.
 * Mesmo fluxo do pedido-run.js, mas com:
 * - Tipos CAST: episodio | convidado | insight
 * - Temas de _brands/cyberseccast/temas.json
 * - Store isolado via propostas-store-cast.js
 * - consumirBancoCast do aprovar-propostas-cast.js
 */

require('./load-env.js');

const fs   = require('fs');
const path = require('path');

const { criarLotePropostasCast } = require('./gerar-propostas-cast.js');
const { consumirBancoCast, getEstadoPropostasCast } = require('./aprovar-propostas-cast.js');
const { getLoteAguardando, countBanco, loadStore, saveStore } = require('./utils/propostas-store-cast.js');

const TEMAS_PATH = path.join(__dirname, '../_brands/cyberseccast/temas.json');

function tipoPostDoDia(dataBRT = new Date()) {
  const dia = dataBRT.getDay();
  if (dia === 1) return 'episodio';
  if (dia === 3) return 'convidado';
  if (dia === 5) return 'insight';
  return 'episodio';
}

function lerTemasCast() {
  return JSON.parse(fs.readFileSync(TEMAS_PATH, 'utf8'));
}

/**
 * Fluxo editorial CAST v1:
 * 1. Se banco tem texto aprovado → fase 2 (visual)
 * 2. Se lote pendente → retorna sem duplicar
 * 3. Senão → gera 3 propostas (fase 1)
 */
async function executarPedidoCast(opts = {}) {
  // Tipo: explícito > inferido do briefing > calendário do dia
  const tipoPost = opts.tipoPost || await (async () => {
    const doDia = tipoPostDoDia(new Date(Date.now() - 3 * 60 * 60 * 1000));
    const briefingLivre = String(opts.tema || opts.temaLivre || '').trim();
    if (!briefingLivre) return doDia;
    let tipos = [];
    try {
      const tpd = require('../_brands/cyberseccast/brand.js').tipo_por_dia || {};
      tipos = [...new Set(Object.entries(tpd).filter(([k]) => k !== 'default').map(([, v]) => v))];
    } catch { /* usa fallback */ }
    const { inferirTipo } = require('./utils/inferir-tipo.js');
    return inferirTipo(briefingLivre, tipos.length > 1 ? tipos : ['episodio', 'convidado', 'insight'], doDia);
  })();
  const objetivo = opts.objetivo || 'audiencia';
  const temas    = lerTemasCast();

  // 1 — Consumir banco (se não forçando propostas)
  if (!opts.forcarPropostas && !opts.pularBanco) {
    const doBanco = await consumirBancoCast();
    if (doBanco) {
      return {
        modo:      'visual_banco',
        slug:      doBanco.slug,
        layout:    doBanco.layout,
        tipoPost,
        fromBanco: true,
      };
    }
  }

  const { data, sha } = await loadStore();
  const pendente = getLoteAguardando(data);
  // Lote pendente só bloqueia se for do mesmo objetivo; objetivos diferentes geram novo lote
  const pendenteCompativel = pendente && (pendente.objetivo || 'audiencia') === objetivo;
  if (pendenteCompativel && !opts.descartarPendente) {
    return {
      modo:       'aguardando_aprovacao',
      loteId:     pendente.id,
      lote:       pendente,
      tipoPost,
      bancoCount: countBanco(data),
    };
  }
  // Descarta lote pendente incompatível antes de gerar novo
  if (pendente && !pendenteCompativel) {
    const loteRef = (data.lotes || []).find(l => l.id === pendente.id);
    if (loteRef) {
      loteRef.status = 'rejeitado';
      await saveStore(data, sha);
    }
    console.log(`ℹ️  CAST: lote pendente ${pendente.id} (objetivo: ${pendente.objetivo || 'audiencia'}) descartado — novo pedido com objetivo: ${objetivo}`);
  }

  // 2 — Fase 1: 3 propostas editoriais CAST
  const lote = await criarLotePropostasCast({
    tipoPost,
    objetivo,
    tema: opts.tema?.trim() || '',
    temas,
  });

  return {
    modo:       'propostas',
    loteId:     lote.id,
    lote,
    tipoPost,
    bancoCount: countBanco(data),
  };
}

module.exports = {
  executarPedidoCast,
  tipoPostDoDia,
  getEstadoPropostasCast,
};
