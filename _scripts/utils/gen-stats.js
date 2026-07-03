'use strict';

// Registro de gerações LLM (imagem + texto) — modelo usado, latência, custo
// estimado e falhas. Append-only JSONL em _tmp/stats-geracao.jsonl.
// Agregados servidos por GET /api/stats. Nunca quebra a geração: todo erro
// interno é engolido de propósito.

const fs   = require('fs');
const path = require('path');

const ROOT       = path.join(__dirname, '..', '..');
const STATS_FILE = path.join(ROOT, '_tmp', 'stats-geracao.jsonl');
const MAX_EVENTOS_LIDOS = 5000;

// Custo estimado em USD por imagem gerada
const CUSTO_IMAGEM_USD = {
  'gemini-3.1-flash-image-preview': 0.039,
  'gemini-2.5-flash-image':         0.039,
  'gpt-image-1':                    0.25,   // quality high, 1024x1536
  'dall-e-3':                       0.08,   // standard, 1024x1792
};

// Custo em USD por 1M tokens (entrada/saída)
const CUSTO_TEXTO_POR_1M = {
  'gpt-4o':           { in: 2.5, out: 10 },
  'gemini-2.0-flash': { in: 0.1, out: 0.4 },
};

function custoImagem(modelo) {
  return CUSTO_IMAGEM_USD[modelo] ?? 0;
}

function custoTexto(modelo, tokensIn = 0, tokensOut = 0) {
  const tabela = CUSTO_TEXTO_POR_1M[modelo];
  if (!tabela) return 0;
  return (tokensIn * tabela.in + tokensOut * tabela.out) / 1e6;
}

// evento: { recurso: 'imagem'|'texto', modelo, ok, ms, custo_usd?, erro? }
function registrar(evento) {
  try {
    fs.mkdirSync(path.dirname(STATS_FILE), { recursive: true });
    fs.appendFileSync(STATS_FILE, JSON.stringify({ ts: new Date().toISOString(), ...evento }) + '\n');
  } catch { /* stats nunca quebram a geração */ }
}

// Cronometra uma chamada de geração e registra sucesso/falha automaticamente.
async function medir(recurso, modelo, fn, extraCusto = null) {
  const inicio = Date.now();
  try {
    const resultado = await fn();
    const custo = extraCusto ? extraCusto(resultado) : custoImagem(modelo);
    registrar({ recurso, modelo, ok: true, ms: Date.now() - inicio, custo_usd: custo });
    return resultado;
  } catch (e) {
    registrar({ recurso, modelo, ok: false, ms: Date.now() - inicio, custo_usd: 0, erro: String(e.message || e).slice(0, 200) });
    throw e;
  }
}

function lerEventos() {
  try {
    if (!fs.existsSync(STATS_FILE)) return [];
    const linhas = fs.readFileSync(STATS_FILE, 'utf8').trim().split('\n');
    return linhas.slice(-MAX_EVENTOS_LIDOS).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function agregar() {
  const eventos = lerEventos();
  const porModelo = {};

  for (const e of eventos) {
    const chave = e.modelo || 'desconhecido';
    const m = porModelo[chave] = porModelo[chave] || {
      recurso: e.recurso, total: 0, ok: 0, falhas: 0, custo_usd: 0, _msTotal: 0,
    };
    m.total++;
    if (e.ok) m.ok++; else m.falhas++;
    m.custo_usd += e.custo_usd || 0;
    m._msTotal  += e.ms || 0;
  }

  let custoTotal = 0;
  for (const m of Object.values(porModelo)) {
    m.ms_medio      = m.total ? Math.round(m._msTotal / m.total) : 0;
    m.taxa_sucesso  = m.total ? Number((m.ok / m.total).toFixed(2)) : 0;
    m.custo_usd     = Number(m.custo_usd.toFixed(4));
    custoTotal     += m.custo_usd;
    delete m._msTotal;
  }

  const falhasRecentes = eventos.filter(e => !e.ok).slice(-10).reverse();

  return {
    total_eventos:   eventos.length,
    custo_total_usd: Number(custoTotal.toFixed(4)),
    por_modelo:      porModelo,
    falhas_recentes: falhasRecentes,
    ultimos:         eventos.slice(-15).reverse(),
  };
}

module.exports = { registrar, medir, agregar, custoImagem, custoTexto };
