'use strict';

// Autopilot editorial — planeja pautas em lote e dispara pedidos sozinho.
// O plano fica em plano-editorial.json (raiz). Quando a data de um item
// chega, o autopilot faz o POST de pedido do cliente; as propostas geradas
// seguem o fluxo normal (galeria + notificação/aprovação via Telegram).
//
// Fluxo: POST /api/autopilot/planejar → LLM distribui pautas nos próximos
// dias → agendador interno (5 min) dispara 1 pedido por tick quando vence.

const fs   = require('fs');
const path = require('path');
const { atomicWriteFileSync } = require('./atomic-write.js');

const ROOT         = path.join(__dirname, '..', '..');
const PLANO_FILE   = path.join(ROOT, 'plano-editorial.json');
const INTERVALO_MS = 5 * 60_000;
const MAX_TENTATIVAS = 3;

const TIPOS_FIXOS = {
  fest: ['evento', 'blog', 'patrocinador', 'palestrante'],
  cast: ['episodio', 'convidado', 'insight'],
};

let apiBase = 'http://127.0.0.1:8765';
let verificando = false;

function ymd(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function lerPlano() {
  try { return JSON.parse(fs.readFileSync(PLANO_FILE, 'utf8')); } catch { return []; }
}

function salvarPlano(itens) {
  atomicWriteFileSync(PLANO_FILE, JSON.stringify(itens, null, 2) + '\n');
}

function clientesDisponiveis() {
  const clientes = ['fest', 'cast'];
  try {
    JSON.parse(fs.readFileSync(path.join(ROOT, '_clients.json'), 'utf8'))
      .filter(c => c.ativo).forEach(c => clientes.push(c.slug));
  } catch { /* sem clientes dinâmicos */ }
  return clientes;
}

function tiposDoCliente(cliente) {
  if (TIPOS_FIXOS[cliente]) return TIPOS_FIXOS[cliente];
  try {
    const tpd = require(path.join(ROOT, '_brands', cliente, 'brand.js')).tipo_por_dia || {};
    const tipos = [...new Set(Object.entries(tpd).filter(([k]) => k !== 'default').map(([, v]) => v))];
    if (tipos.length) return tipos;
  } catch { /* sem brand */ }
  return ['autoridade'];
}

function bancoDoCliente(cliente) {
  if (cliente === 'fest') return path.join(ROOT, 'artes.json');
  if (cliente === 'cast') return path.join(ROOT, 'artes-cast.json');
  return path.join(ROOT, `artes-${cliente}.json`);
}

function headlinesRecentes(cliente, max = 8) {
  try {
    return JSON.parse(fs.readFileSync(bancoDoCliente(cliente), 'utf8'))
      .slice(0, max)
      .map(a => (a.headline || '').replace(/<[^>]+>/g, ' ').trim())
      .filter(Boolean);
  } catch { return []; }
}

// ── Geração do plano via LLM ───────────────────────────────────────
async function gerarPlano({ cliente, dias = 7, quantidade = 3 }) {
  if (!clientesDisponiveis().includes(cliente)) {
    throw new Error(`cliente desconhecido: ${cliente}`);
  }
  quantidade = Math.min(Math.max(parseInt(quantidade, 10) || 3, 1), 15);
  dias       = Math.min(Math.max(parseInt(dias, 10) || 7, 1), 60);

  const tipos    = tiposDoCliente(cliente);
  const recentes = headlinesRecentes(cliente);
  const hoje     = ymd();

  const prompt = `Você é o planejador editorial da marca "${cliente}".
Distribua ${quantidade} pautas de posts para Instagram nos próximos ${dias} dias a partir de ${hoje} (inclusive amanhã), priorizando dias úteis e espaçamento uniforme.

Tipos editoriais disponíveis (alterne entre eles): ${tipos.join(', ')}

Posts recentes (NÃO repita estes temas/ângulos):
${recentes.map(h => `- ${h}`).join('\n') || '- (nenhum ainda)'}

Responda APENAS com JSON válido:
{
  "itens": [
    { "data": "YYYY-MM-DD", "tipo": "um dos tipos disponíveis", "briefing": "pauta em 1-2 frases, específica e acionável, no idioma português" }
  ]
}`;

  const { generateText } = require('./llm.js');
  const raw   = await generateText(prompt, '', 0.9, 1500);
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('LLM não retornou JSON de plano');

  const parsed = JSON.parse(match[0]);
  const validos = (parsed.itens || [])
    .filter(i => /^\d{4}-\d{2}-\d{2}$/.test(i.data || '') && (i.briefing || '').trim())
    .slice(0, quantidade)
    .map((i, n) => ({
      id:        `plano-${Date.now()}-${n}`,
      cliente,
      data:      i.data,
      tipo:      tipos.includes(i.tipo) ? i.tipo : tipos[0],
      briefing:  String(i.briefing).trim(),
      status:    'planejado',
      criado_em: new Date().toISOString(),
    }));

  if (!validos.length) throw new Error('LLM não gerou itens válidos de plano');

  const plano = [...lerPlano(), ...validos];
  salvarPlano(plano);
  console.log(`⚡ Autopilot: ${validos.length} pautas planejadas para ${cliente}`);
  return validos;
}

// ── Disparo de pedidos vencidos ────────────────────────────────────
function rotaPedido(cliente) {
  if (cliente === 'fest') return '/api/pedido';
  return `/api/${cliente}/pedido`;
}

function corpoPedido(cliente, item) {
  if (cliente === 'fest' || cliente === 'cast') {
    return { tema: item.briefing, tipoPost: item.tipo, forcarPropostas: true };
  }
  return { tema: item.briefing, tipo: item.tipo };
}

// Dispara no máximo 1 pedido por verificação (LLM + imagem são pesados).
async function verificarPlano() {
  if (verificando) return null;
  verificando = true;
  try {
    const plano = lerPlano();
    const hoje  = ymd();
    const item  = plano.find(i => i.status === 'planejado' && i.data <= hoje);
    if (!item) return null;

    try {
      const r = await fetch(`${apiBase}${rotaPedido(item.cliente)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpoPedido(item.cliente, item)),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || data.ok === false) throw new Error(data.erro || `HTTP ${r.status}`);

      item.status    = 'gerado';
      item.gerado_em = new Date().toISOString();
      console.log(`⚡ Autopilot: pedido disparado — [${item.cliente}] ${item.briefing.slice(0, 60)}`);
    } catch (e) {
      item.tentativas = (item.tentativas || 0) + 1;
      item.erro       = e.message;
      if (item.tentativas >= MAX_TENTATIVAS) item.status = 'erro';
      console.warn(`⚠️  Autopilot: pedido falhou (${item.tentativas}/${MAX_TENTATIVAS}) — ${e.message}`);
    }

    salvarPlano(plano);
    return item;
  } finally {
    verificando = false;
  }
}

function removerItem(id) {
  const plano  = lerPlano();
  const restam = plano.filter(i => i.id !== id);
  if (restam.length === plano.length) return false;
  salvarPlano(restam);
  return true;
}

function iniciarAutopilot(opts = {}) {
  if (opts.apiBase) apiBase = opts.apiBase;
  const timer = setInterval(() => {
    verificarPlano().catch(e => console.warn('⚠️  Autopilot:', e.message));
  }, INTERVALO_MS);
  timer.unref();
  return true;
}

module.exports = { gerarPlano, verificarPlano, lerPlano, removerItem, iniciarAutopilot, clientesDisponiveis };
