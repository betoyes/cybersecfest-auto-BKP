'use strict';

require('./load-env.js');

const { getJSON } = require('./utils/storage.js');
const { generateText } = require('./utils/llm.js');
const { criarLotePropostas } = require('./gerar-propostas.js');
const { HEADLINE_PROMPT_BLOCK, enforceHeadlineText, normalizePalavrasAzuis } = require('./utils/headline-rules.js');
const { consumirBanco, getEstadoPropostas } = require('./aprovar-propostas.js');
const { getLoteAguardando, countBanco, loadStore, saveStore } = require('./utils/propostas-store.js');

function tipoPostDoDia(dataBRT = new Date()) {
  const dia = dataBRT.getDay();
  if (dia === 1) return 'blog';
  if (dia === 3) return 'palestrante';
  if (dia === 5) return 'evento';
  return 'blog';
}

async function gerarBriefing(tipoPost, temas, temaLivre = '') {
  const historico = (temas.historico_recente || [])
    .slice(-5)
    .map(h => `- ${h.tipo_post} (${h.data})`)
    .join('\n') || 'Nenhum ainda.';

  const temasGrade = temas.evento?.temas_grade?.join(', ') || 'IAM, PAM, DevSecOps, Cloud Security, LGPD, IA';
  const marcas     = temas.evento?.marcas_participantes?.slice(0, 6).join(', ') || 'Itaú, XP, Natura, Localiza, Gerdau, Stellantis';

  const system = `Você é copywriter sênior do CybersecFEST — A Principal Confraria de Cibersegurança do Brasil.
Tom: aspiracional, exclusivo, FOMO. O leitor deve sentir: "Se não estou lá, estou fora do mercado."
Público: CISOs, CIOs, CTOs, CEOs, VPs, Diretores.
PROIBIDO: começar com "O CybersecFEST", clichês (cadeados, hackers), tom técnico-acadêmico.`;

  const temaExtra = temaLivre
    ? `\nBRIEFING DO USUÁRIO (prioridade máxima — use como direção central):\n${temaLivre}\n`
    : '';

  const prompt = `Crie um briefing completo para post de ${tipoPost} do CybersecFEST 2026.
${temaExtra}
${HEADLINE_PROMPT_BLOCK}

CONTEXTO:
- 2 edições: BH (Novembro 2026) e SP (Outubro 2026)
- Marcas participantes: ${marcas}
- Temas da grade: ${temasGrade}
- Histórico recente (evitar repetir ângulos): ${historico}

RETORNE EXATAMENTE neste formato JSON (sem markdown, apenas JSON puro):
{
  "headline": "máx 10 palavras, impacto máximo; use <br> para até 5 linhas",
  "palavras_azuis": "1-3 palavras DA HEADLINE para destacar em azul, separadas por vírgula",
  "subtitulo": "máx 12 palavras, complementa com convite",
  "cta_visual": "opcional — pill CTA na arte (máx 4 palavras, UPPERCASE). Ex: INSCRIÇÕES ABERTAS, SEJA PATROCINADOR. Omita se não couber.",
  "contexto_visual": "cena aspiracional dark APENAS visual: quem, onde, atmosfera, iluminação — SEM texto, SEM palavras de headline, SEM clichês de hacking",
  "cidade": "BH e SP"
}`;

  const raw = await generateText(prompt, system, 0.85);
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('LLM não retornou JSON válido: ' + raw.slice(0, 200));

  const briefing = JSON.parse(match[0]);
  if (!briefing.headline) throw new Error('Briefing sem headline');
  const enforced = enforceHeadlineText(briefing.headline);
  briefing.headline = enforced.headline;
  briefing.palavras_azuis = normalizePalavrasAzuis(briefing.headline, briefing.palavras_azuis || '');
  enforced.warnings.forEach(w => console.log(`   ⚠️  briefing: ${w}`));
  return briefing;
}

/**
 * Fluxo editorial v2:
 * 1. Se banco tem texto aprovado → fase 2 (visual) e retorna
 * 2. Se lote pendente do MESMO objetivo → não gera duplicata
 * 3. Senão → gera 3 propostas de texto (fase 1)
 *
 * @param {object} opts
 * @param {string} [opts.objetivo] — 'audiencia' | 'patrocinadores' | 'convite' (default: 'audiencia')
 * @param {boolean} [opts.forcarPropostas] — ignora banco e gera propostas
 * @param {boolean} [opts.pularBanco] — não consome banco (só propostas)
 */
async function executarPedido(opts = {}) {
  const objetivo = opts.objetivo || 'audiencia';
  const override = process.env.TIPO_POST_OVERRIDE;
  // Tipo: explícito > override > inferido do briefing livre > calendário do dia
  const tipoPost = opts.tipoPost || override || await (async () => {
    const brt   = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const doDia = tipoPostDoDia(brt);
    const briefingLivre = String(opts.tema || opts.temaLivre || opts.briefing || '').trim();
    if (!briefingLivre) return doDia;
    const { inferirTipo } = require('./utils/inferir-tipo.js');
    return inferirTipo(briefingLivre, ['blog', 'evento', 'palestrante', 'patrocinador', 'cidade'], doDia);
  })();

  const temasFile = await getJSON('temas.json');
  if (!temasFile) throw new Error('temas.json não encontrado');
  const temas = temasFile.data;

  // 1 — Consumir banco (cron / pedido normal)
  if (!opts.forcarPropostas && !opts.pularBanco) {
    const doBanco = await consumirBanco();
    if (doBanco) {
      return {
        modo: 'visual_banco',
        slug: doBanco.slug,
        layout: doBanco.layout,
        tipoPost,
        fromBanco: true,
      };
    }
  }

  const { data, sha } = await loadStore();
  const pendente = getLoteAguardando(data);
  const pendenteCompativel = pendente && (pendente.objetivo || 'audiencia') === objetivo;
  if (pendenteCompativel && !opts.descartarPendente) {
    return {
      modo: 'aguardando_aprovacao',
      loteId: pendente.id,
      lote: pendente,
      tipoPost,
      bancoCount: countBanco(data),
    };
  }
  if (pendente && !pendenteCompativel) {
    const loteRef = (data.lotes || []).find(l => l.id === pendente.id);
    if (loteRef) {
      loteRef.status = 'rejeitado';
      await saveStore(data, sha);
    }
    console.log(`ℹ️  FEST: lote ${pendente.id} (${pendente.objetivo || 'audiencia'}) descartado — novo objetivo: ${objetivo}`);
  }

  // 2 — Fase 1: 3 rotas de texto
  const lote = await criarLotePropostas({
    tipoPost,
    tema: opts.tema?.trim() || '',
    temas,
    objetivo,
  });

  return {
    modo: 'propostas',
    loteId: lote.id,
    lote,
    tipoPost,
    bancoCount: countBanco(data),
  };
}

module.exports = {
  executarPedido,
  gerarBriefing,
  tipoPostDoDia,
  getEstadoPropostas,
};
