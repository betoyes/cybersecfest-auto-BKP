'use strict';

// Dev local sempre grava no disco — antes de carregar storage
process.env.LOCAL_MODE = process.env.LOCAL_MODE || '1';
require('./load-env.js');

const http = require('http');
const fs   = require('fs');
const path = require('path');
const log  = require('./utils/log.js');
const { executarPedido, getEstadoPropostas } = require('./pedido-run.js');
const { aprovarLote, rejeitarLote, consumirBanco } = require('./aprovar-propostas.js');
const { upsertEditorState, extractEditorState } = require('./utils/editor-state.js');
const { gerarThumbComposto } = require('./utils/thumb-composto.js');
const { resolveArtePaths, promoteTemplatePadrao, isTemplateSlug } = require('./utils/template-padroes.js');
const { generateImage } = require('./utils/llm.js');
const { buildImagePrompt, validateLayout } = require('./utils/imagem-prompt.js');
const { renderLayout } = require('./utils/layouts.js');
const { wrapWithEditor } = require('./utils/editor-wrap.js');
const { atomicWriteFileSync } = require('./utils/atomic-write.js');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 8765);
const HOST = '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.webp': 'image/webp',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.zip':  'application/zip',
};

// --- fila de geração por slug ---
// Permite operações paralelas em slugs diferentes.
// Operações sem slug usam '__global' como chave (comportamento anterior).
const generationQueue = new Map();

function setBusy(res, slug = '__global') {
  if (generationQueue.has(slug)) {
    json(res, 409, { ok: false, erro: slug === '__global' ? 'Operação em andamento. Aguarde.' : 'Geração em andamento para este post.' });
    return false;
  }
  generationQueue.set(slug, 'generating');
  return true;
}

function clearBusy(slug = '__global') { generationQueue.delete(slug); }

// Slugs de motion com pedido recém-criado aguardando o worker iniciar
const motionPending = new Set();

// --- cache de artes.json ---
let artesCache = null;
let artesCacheAt = 0;
const ARTES_TTL = 10_000;

function readArtes() {
  const now = Date.now();
  if (artesCache && now - artesCacheAt < ARTES_TTL) return artesCache;
  artesCache = JSON.parse(fs.readFileSync(path.join(ROOT, 'artes.json'), 'utf8'));
  artesCacheAt = now;
  return artesCache;
}

function invalidateArtes() { artesCache = null; }

// ----------------------------------------

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function readBody(req, maxBytes = 2 * 1024 * 1024) {
  let body = '';
  let total = 0;
  for await (const chunk of req) {
    total += Buffer.byteLength(chunk);
    if (total > maxBytes) {
      req.destroy();
      const err = new Error('Payload too large');
      err.statusCode = 413;
      throw err;
    }
    body += chunk;
  }
  try {
    return JSON.parse(body || '{}');
  } catch {
    return null;
  }
}

function resolveStaticPath(urlPath) {
  let rel = urlPath === '/' ? 'home.html' : urlPath.replace(/^\//, '').replace(/\/$/, '');

  if (!rel) rel = 'index.html';

  let file = path.join(ROOT, rel);

  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    file = path.join(file, 'index.html');
  } else if (!path.extname(rel)) {
    const indexCandidate = path.join(ROOT, rel, 'index.html');
    if (fs.existsSync(indexCandidate)) file = indexCandidate;
  }

  return file;
}

function serveStatic(req, res, urlPath) {
  const file = resolveStaticPath(urlPath);

  if (!file.startsWith(ROOT)) {
    res.writeHead(403); return res.end('Forbidden');
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404); return res.end('Not found');
    }
    const ext = path.extname(file).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    if (rel.startsWith('effects-preview/')) {
      headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
      headers.Pragma = 'no-cache';
      headers.Expires = '0';
    }
    res.writeHead(200, headers);
    res.end(data);
  });
}

async function handlePedido(req, res) {
  if (!setBusy(res)) return;
  try {
    const payload = await readBody(req);
    if (!payload) return json(res, 400, { ok: false, erro: 'JSON inválido' });

    log.info('Pedido:', payload.forcarPropostas ? 'forçar propostas' : 'fluxo normal', payload.tema?.slice(0, 40) || '');

    const resultado = await executarPedido({
      tipoPost:        payload.tipoPost,
      tema:            payload.tema,
      objetivo:        payload.objetivo || 'audiencia',
      forcarPropostas: !!payload.forcarPropostas,
      pularBanco:      !!payload.forcarPropostas,
    });

    log.info(`Pedido OK: modo=${resultado.modo}`);
    if (resultado.modo === 'propostas' && resultado.lote) {
      try { require('./utils/telegram-bot.js').notificarPropostas('fest', resultado.lote, 'fest'); } catch { /* opcional */ }
    }
    json(res, 200, { ok: true, ...resultado });
  } catch (e) {
    if (e.statusCode === 413) return json(res, 413, { ok: false, erro: 'Payload muito grande' });
    log.error('Pedido falhou:', e.message);
    json(res, 500, { ok: false, erro: e.message });
  } finally {
    clearBusy();
  }
}

async function handlePropostasGet(_req, res) {
  try {
    const estado = await getEstadoPropostas();
    json(res, 200, { ok: true, ...estado });
  } catch (e) {
    json(res, 500, { ok: false, erro: e.message });
  }
}

async function handleAprovar(req, res) {
  if (!setBusy(res)) return;
  try {
    const payload = await readBody(req);
    if (!payload?.loteId || !payload?.principalId) {
      return json(res, 400, { ok: false, erro: 'loteId e principalId são obrigatórios' });
    }
    const resultado = await aprovarLote({
      loteId:            payload.loteId,
      principalId:       payload.principalId,
      bancoIds:          payload.bancoIds || [],
      edicoes:           payload.edicoes || {},
      gerarBackupVisual: !!payload.gerarBackupVisual,
    });
    json(res, 200, { ok: true, modo: 'visual_aprovado', ...resultado });
  } catch (e) {
    if (e.statusCode === 413) return json(res, 413, { ok: false, erro: 'Payload muito grande' });
    json(res, 500, { ok: false, erro: e.message });
  } finally {
    clearBusy();
  }
}

async function handleRejeitar(req, res) {
  const payload = await readBody(req);
  if (!payload?.loteId) return json(res, 400, { ok: false, erro: 'loteId obrigatório' });
  try {
    await rejeitarLote(payload.loteId);
    json(res, 200, { ok: true });
  } catch (e) {
    json(res, 500, { ok: false, erro: e.message });
  }
}

async function handleConsumirBanco(_req, res) {
  if (!setBusy(res)) return;
  try {
    const resultado = await consumirBanco({ gerarBackupVisual: false });
    if (!resultado) return json(res, 404, { ok: false, erro: 'Banco vazio' });
    json(res, 200, { ok: true, modo: 'visual_banco', ...resultado });
  } catch (e) {
    json(res, 500, { ok: false, erro: e.message });
  } finally {
    clearBusy();
  }
}

async function handleSalvarArte(req, res) {
  if (!setBusy(res)) return;
  try {
    const payload = await readBody(req);
    if (!payload) return json(res, 400, { ok: false, erro: 'JSON inválido' });

    const slug = String(payload.slug || '').trim();
    const state = payload.state;
    if (!slug || !state || typeof state !== 'object') {
      return json(res, 400, { ok: false, erro: 'slug e state são obrigatórios' });
    }
    if (!/^[\w-]+$/.test(slug)) {
      return json(res, 400, { ok: false, erro: 'slug inválido' });
    }

    const { artePath, thumbPath, isTemplate, layout } = resolveArtePaths(slug);
    if (!fs.existsSync(artePath)) {
      return json(res, 404, { ok: false, erro: `Arte não encontrada: ${slug}` });
    }

    const html = fs.readFileSync(artePath, 'utf8');
    const updated = upsertEditorState(html, state);
    fs.writeFileSync(artePath, updated);

    // Persistir textos editados no banco (templates não fazem parte de artes.json)
    const subtitleRaw = typeof payload.subtitle       === 'string' ? payload.subtitle       : null;
    const headlineRaw = typeof payload.headline       === 'string' ? payload.headline       : null;
    const palavrasRaw = typeof payload.palavras_azuis === 'string' ? payload.palavras_azuis : null;
    if (!isTemplate && (subtitleRaw !== null || headlineRaw !== null || palavrasRaw !== null)) {
      const artes = readArtes();
      const idx   = artes.findIndex(a => a.slug === slug);
      if (idx >= 0) {
        if (subtitleRaw !== null) artes[idx].subtitulo      = subtitleRaw;
        if (headlineRaw !== null) artes[idx].headline       = headlineRaw;
        if (palavrasRaw !== null) artes[idx].palavras_azuis = palavrasRaw;
        atomicWriteFileSync(path.join(ROOT, 'artes.json'), JSON.stringify(artes, null, 2) + '\n');
        invalidateArtes();
      }
    }

    let thumbOk = false;
    let thumbAviso = null;
    try {
      await gerarThumbComposto(artePath, thumbPath);
      thumbOk = true;
    } catch (e) {
      thumbAviso = e.message;
    }

    let padraoInfo = null;
    if (isTemplate) {
      padraoInfo = promoteTemplatePadrao(slug, state);
    }

    log.info(`Editor salvo: ${slug}${thumbOk ? ' + thumb' : ''}${isTemplate ? ' · padrão layout ' + layout : ''}`);
    json(res, 200, {
      ok: true,
      slug,
      thumb: thumbOk,
      thumbAviso,
      padrao: !!isTemplate,
      layout: layout || undefined,
      message: isTemplate
        ? `Layout ${layout} salvo como padrão da galeria de templates.`
        : undefined,
    });
  } catch (e) {
    if (e.statusCode === 413) return json(res, 413, { ok: false, erro: 'Payload muito grande' });
    log.error('Salvar arte:', e.message);
    json(res, 500, { ok: false, erro: e.message });
  } finally {
    clearBusy();
  }
}

// POST /api/clientes/criar — onboarding de cliente novo a partir de briefing JSON.
// Executa onboarding-cliente.js (gera _brands/, _agents/, galeria, banco) e
// o fs.watch de _clients.json recarrega as rotas automaticamente.
async function handleCriarCliente(req, res) {
  if (!setBusy(res, '__onboarding')) return;
  try {
    const briefing = await readBody(req);
    if (!briefing) return json(res, 400, { ok: false, erro: 'JSON inválido' });

    const slug = String(briefing.slug || '').trim().toLowerCase();
    const nome = String(briefing.nome || '').trim();
    if (!slug || !nome) return json(res, 400, { ok: false, erro: 'slug e nome são obrigatórios' });
    if (!/^[a-z0-9-]{2,30}$/.test(slug)) {
      return json(res, 400, { ok: false, erro: 'slug inválido — use apenas letras minúsculas, números e hífen (2-30 chars)' });
    }
    if (['fest', 'cast', 'api', 'artes', 'assets', 'calendario'].includes(slug)) {
      return json(res, 400, { ok: false, erro: `slug reservado: ${slug}` });
    }
    if (fs.existsSync(path.join(ROOT, '_brands', slug))) {
      return json(res, 409, { ok: false, erro: `Cliente já existe: ${slug}` });
    }

    const os = require('os');
    const tmpBriefing = path.join(os.tmpdir(), `briefing-${slug}-${Date.now()}.json`);
    fs.writeFileSync(tmpBriefing, JSON.stringify({ ...briefing, slug, nome }, null, 2));

    log.info(`Onboarding iniciado: ${nome} (${slug})`);
    const { execFile } = require('child_process');
    const saida = await new Promise((resolve, reject) => {
      execFile('node', ['onboarding-cliente.js', '--briefing', tmpBriefing],
        { cwd: __dirname, timeout: 5 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 },
        (err, stdout, stderr) => {
          fs.unlink(tmpBriefing, () => {});
          if (err) return reject(new Error(`onboarding falhou: ${err.message}\n${(stderr || stdout || '').slice(-800)}`));
          resolve(stdout);
        });
    });

    log.info(`Onboarding concluído: ${slug}`);
    json(res, 200, { ok: true, slug, galeria: `/${slug}/`, log: saida.split('\n').slice(-12).join('\n') });
  } catch (e) {
    log.error('Criar cliente:', e.message);
    json(res, 500, { ok: false, erro: e.message });
  } finally {
    clearBusy('__onboarding');
  }
}

async function handleCampanha(req, res) {
  if (!setBusy(res)) return;
  try {
    const payload = await readBody(req);
    if (!payload) return json(res, 400, { ok: false, erro: 'JSON inválido' });

    const { getJSON } = require('./utils/storage.js');
    const { criarLoteCampanha } = require('./gerar-campanha.js');
    const temasFile = await getJSON('temas.json');
    if (!temasFile) throw new Error('temas.json não encontrado');

    const lote = await criarLoteCampanha({
      objetivo:  payload.objetivo  || 'inscricoes',
      quantidade: payload.quantidade || 5,
      tema:      payload.tema?.trim() || '',
      temas:     temasFile.data,
    });

    json(res, 200, { ok: true, modo: 'campanha', lote });
  } catch (e) {
    if (e.statusCode === 413) return json(res, 413, { ok: false, erro: 'Payload muito grande' });
    json(res, 500, { ok: false, erro: e.message });
  } finally {
    clearBusy();
  }
}

async function handleCampanhaExport(req, res, query) {
  const loteId = query.get('loteId') || '';
  if (!loteId) return json(res, 400, { ok: false, erro: 'loteId obrigatório' });

  try {
    const { loadStore } = require('./utils/propostas-store.js');
    const { exportCampanhaPack } = require('./utils/export-campanha-pack.js');
    const { data } = await loadStore();
    const lote = (data.lotes || []).find(l => l.id === loteId);
    if (!lote) return json(res, 404, { ok: false, erro: 'Lote não encontrado' });

    const zipPath = exportCampanhaPack(lote, ROOT);
    const rel = path.relative(ROOT, zipPath).split(path.sep).join('/');
    json(res, 200, { ok: true, url: `/${rel}`, path: rel, filename: path.basename(zipPath) });
  } catch (e) {
    json(res, 500, { ok: false, erro: e.message });
  }
}

async function handleCalendario(_req, res) {
  try {
    const { getJSON } = require('./utils/storage.js');
    const temasFile = await getJSON('temas.json');
    if (!temasFile) return json(res, 404, { ok: false, erro: 'temas.json não encontrado' });
    const cal = temasFile.data.calendario_editorial || {};
    json(res, 200, { ok: true, calendario: cal, historico: (temasFile.data.historico_recente || []).slice(-8) });
  } catch (e) {
    json(res, 500, { ok: false, erro: e.message });
  }
}

// ── Versões de imagem ────────────────────────────────────────────
const { imgVersDir, readImgVersoes, writeImgVersoes, saveImgVersion } = require('./utils/img-versoes.js');

// background-position padrão por layout — alinhado ao focusId do LAYOUT_IMAGE_RULES
const LAYOUT_BG_POS = {
  A: { x: 75, y: 40 },  // direita, levemente acima
  B: { x: 15, y: 50 },  // esquerda
  C: { x: 85, y: 50 },  // direita
  D: { x: 50, y: 50 },  // centro
  E: { x: 80, y: 50 },  // direita
  F: { x: 80, y: 50 },  // direita
  G: { x: 50, y: 30 },  // centro, topo (magazine cover)
  H: { x: 50, y: 35 },  // centro-superior
  I: { x: 20, y: 50 },  // esquerda
  J: { x: 50, y: 50 },  // centro entre horizontais
  K: { x: 50, y: 50 },  // centro entre verticais
  L: { x: 50, y: 50 },  // centro entre zonas
  M: { x: 75, y: 40 },  // direita, acima
  N: { x: 80, y: 30 },  // direita, topo
  O: { x: 50, y: 65 },  // centro-inferior (spotlight)
  P: { x: 50, y: 35 },  // centro-superior
  Q: { x: 50, y: 50 },  // laterais — centralizado no total
};

function buildArteHtml(slug, arte, imgBuffer, artePath, resetBgPos = false) {
  const layout = (arte.layout || (arte.tipo === 'evento' ? 'E' : arte.tipo === 'patrocinador' ? 'F' : 'C')).toUpperCase();
  validateLayout(layout);
  const imageBase64 = imgBuffer.toString('base64');
  let editorState = fs.existsSync(artePath) ? extractEditorState(fs.readFileSync(artePath, 'utf8')) : null;
  // Ao trocar a imagem, reseta posição/zoom para o padrão do layout mas preserva ajustes de texto/elementos
  if (resetBgPos) {
    const pos = LAYOUT_BG_POS[layout] || { x: 50, y: 50 };
    editorState = { ...(editorState || {}), x: pos.x, y: pos.y, z: 100 };
  }
  const simpleHtml  = renderLayout(layout, {
    imageBase64,
    headline:        arte.headline,
    subtitulo:       arte.subtitulo || '',
    palavrasAzuis:   arte.palavras_azuis || '',
    nomePalestrante: arte.nome_palestrante || '',
    cargoEmpresa:    arte.cargo_empresa || '',
  });
  return { html: wrapWithEditor(simpleHtml, { layout, headline: arte.headline, slug, editorState }), layout };
}

async function handleMudarImagem(req, res) {
  if (!setBusy(res)) return;
  try {
    const payload = await readBody(req);
    const slug = String(payload?.slug || '').trim();
    const instrucao = String(payload?.instrucao || '').trim();

    if (!slug || !/^[\w-]+$/.test(slug)) return json(res, 400, { ok: false, erro: 'slug inválido' });
    if (!instrucao) return json(res, 400, { ok: false, erro: 'instrucao é obrigatória' });

    const artes = readArtes();
    const arte = artes.find(a => a.slug === slug);
    if (!arte) return json(res, 404, { ok: false, erro: `Arte não encontrada: ${slug}` });

    const { artePath, thumbPath } = resolveArtePaths(slug);
    if (!fs.existsSync(artePath)) return json(res, 404, { ok: false, erro: 'arte.html não encontrada' });

    const layout = (arte.layout || (arte.tipo === 'evento' ? 'E' : arte.tipo === 'patrocinador' ? 'F' : 'C')).toUpperCase();
    validateLayout(layout);

    const slugDir   = path.join(ROOT, 'artes', slug);
    const fundoPath = path.join(slugDir, 'fundo.png');

    // Salvar versão atual — extrai imagem do arte.html se fundo.png não existe
    const versoesBefore = readImgVersoes(slug);
    if (versoesBefore.versoes.length === 0) {
      let savedOriginal = false;
      if (fs.existsSync(fundoPath)) {
        saveImgVersion(slug, fundoPath, thumbPath, 'Original');
        savedOriginal = true;
      } else {
        // Imagem embutida como base64 no arte.html — extrair antes de sobrescrever
        try {
          const html = fs.readFileSync(artePath, 'utf8');
          const m = html.match(/id="art-bg"[^>]*background-image:\s*url\(['"]?data:image\/[^;]+;base64,([^'")\s]+)/);
          if (m?.[1]) {
            fs.mkdirSync(slugDir, { recursive: true });
            fs.writeFileSync(fundoPath, Buffer.from(m[1], 'base64'));
            saveImgVersion(slug, fundoPath, thumbPath, 'Original');
            savedOriginal = true;
            log.info(`Imagem original extraída do arte.html e salva como v1 para ${slug}`);
          }
        } catch (ex) {
          log.warn(`Não foi possível extrair imagem original de ${slug}:`, ex.message);
        }
      }
      if (!savedOriginal) {
        // Salvar apenas o thumb como referência visual da versão original
        const vDir = path.join(imgVersDir(slug), 'v1');
        fs.mkdirSync(vDir, { recursive: true });
        if (fs.existsSync(thumbPath)) fs.copyFileSync(thumbPath, path.join(vDir, 'thumb.png'));
        const d = { ativa: 1, versoes: [{ id: 1, criada_em: new Date().toISOString(), label: 'Original' }] };
        writeImgVersoes(slug, d);
        log.info(`Thumb original salvo como v1 (sem fundo.png) para ${slug}`);
      }
    }

    // userScene injeta a instrução do usuário como SCENE, mantendo layout/estilo/marca intactos
    const prompt = buildImagePrompt({
      tipo:           arte.tipo,
      layout,
      contextoVisual: arte.contexto_visual || '',
      slug,
      cidade:         arte.cidade || 'BH',
      userScene:      instrucao,
    });
    log.info(`Mudar imagem: ${slug} — ${instrucao}`);

    const imgBuffer = await generateImage(prompt, {
      tipo:           arte.tipo,
      layout,
      contextoVisual: arte.contexto_visual || '',
      cidade:         arte.cidade || 'BH',
      useReferences:  false, // instrução do usuário é o sujeito — referências de estilo sobrescreveriam
    });

    fs.mkdirSync(slugDir, { recursive: true });
    fs.writeFileSync(fundoPath, imgBuffer);
    log.info(`fundo.png atualizado (${Math.round(imgBuffer.length / 1024)} KB)`);

    const { html } = buildArteHtml(slug, arte, imgBuffer, artePath, true);
    fs.writeFileSync(artePath, html);
    await gerarThumbComposto(artePath, thumbPath);
    log.info(`thumb regenerado: ${slug}`);

    // Salvar nova versão
    const { data: versoesAfter, id: novaId } = saveImgVersion(slug, fundoPath, thumbPath, instrucao.slice(0, 80));

    json(res, 200, {
      ok: true,
      slug,
      thumb: `/artes/${slug}/thumb.png?t=${Date.now()}`,
      versoes: versoesAfter,
    });
  } catch (e) {
    if (e.statusCode === 413) return json(res, 413, { ok: false, erro: 'Payload muito grande' });
    log.error('Mudar imagem falhou:', e.message);
    json(res, 500, { ok: false, erro: e.message });
  } finally {
    clearBusy();
  }
}

async function handleImgVersoesGet(req, res, searchParams) {
  const slug = String(searchParams.get('slug') || '').trim();
  if (!slug) return json(res, 400, { ok: false, erro: 'slug obrigatório' });
  const data = readImgVersoes(slug);
  json(res, 200, { ok: true, ...data });
}

async function handleAtivarImgVersao(req, res) {
  if (!setBusy(res)) return;
  try {
    const payload = await readBody(req);
    const slug = String(payload?.slug || '').trim();
    const id   = Number(payload?.id);

    if (!slug || !/^[\w-]+$/.test(slug)) return json(res, 400, { ok: false, erro: 'slug inválido' });
    if (!id) return json(res, 400, { ok: false, erro: 'id obrigatório' });

    const data = readImgVersoes(slug);
    const ver  = data.versoes.find(v => v.id === id);
    if (!ver) return json(res, 404, { ok: false, erro: `Versão ${id} não encontrada` });

    const vDir      = path.join(imgVersDir(slug), `v${id}`);
    const vFundo    = path.join(vDir, 'fundo.png');
    if (!fs.existsSync(vFundo)) return json(res, 404, { ok: false, erro: `Imagem da versão ${id} não disponível para restaurar (versão salva apenas como thumbnail)` });

    const artes  = readArtes();
    const arte   = artes.find(a => a.slug === slug);
    if (!arte) return json(res, 404, { ok: false, erro: 'Arte não encontrada' });

    const { artePath, thumbPath } = resolveArtePaths(slug);
    const slugDir   = path.join(ROOT, 'artes', slug);
    const fundoPath = path.join(slugDir, 'fundo.png');

    const imgBuffer = fs.readFileSync(vFundo);
    fs.writeFileSync(fundoPath, imgBuffer);

    const { html } = buildArteHtml(slug, arte, imgBuffer, artePath, true);
    fs.writeFileSync(artePath, html);
    await gerarThumbComposto(artePath, thumbPath);

    data.ativa = id;
    writeImgVersoes(slug, data);
    log.info(`Imagem ativada: ${slug} → v${id}`);

    json(res, 200, {
      ok: true,
      slug,
      thumb: `/artes/${slug}/thumb.png?t=${Date.now()}`,
      versoes: data,
    });
  } catch (e) {
    log.error('Ativar versão imagem falhou:', e.message);
    json(res, 500, { ok: false, erro: e.message });
  } finally {
    clearBusy();
  }
}

async function handleDeletarImgVersao(req, res) {
  try {
    const payload = await readBody(req);
    const slug = String(payload?.slug || '').trim();
    const id   = Number(payload?.id);

    if (!slug || !/^[\w-]+$/.test(slug)) return json(res, 400, { ok: false, erro: 'slug inválido' });
    if (!id) return json(res, 400, { ok: false, erro: 'id obrigatório' });

    const data = readImgVersoes(slug);
    if (data.versoes.length <= 1) return json(res, 400, { ok: false, erro: 'Não é possível deletar a única versão' });
    if (!data.versoes.find(v => v.id === id)) return json(res, 404, { ok: false, erro: `Versão ${id} não encontrada` });
    if (data.ativa === id) return json(res, 400, { ok: false, erro: 'Não é possível deletar a versão ativa. Ative outra primeiro.' });

    const vDir = path.join(imgVersDir(slug), `v${id}`);
    if (fs.existsSync(vDir)) fs.rmSync(vDir, { recursive: true, force: true });

    data.versoes = data.versoes.filter(v => v.id !== id);
    writeImgVersoes(slug, data);
    log.info(`Versão de imagem deletada: ${slug} v${id}`);

    json(res, 200, { ok: true, versoes: data });
  } catch (e) {
    log.error('Deletar versão imagem falhou:', e.message);
    json(res, 500, { ok: false, erro: e.message });
  }
}

async function handleDeletarArte(req, res) {
  const payload = await readBody(req);
  if (!payload) return json(res, 400, { ok: false, erro: 'JSON inválido' });

  const slug = String(payload.slug || '').trim();
  if (!slug) return json(res, 400, { ok: false, erro: 'slug obrigatório' });

  try {
    const { removerArte } = require('./utils/remover-arte.js');
    const resultado = await removerArte(slug);
    invalidateArtes();
    log.info(`Arte removida: ${slug}`);
    json(res, 200, { ok: true, ...resultado });
  } catch (e) {
    log.error('Deletar arte:', e.message);
    json(res, 500, { ok: false, erro: e.message });
  }
}

// ── Routes: Motion + CAST ─────────────────────────────────────────
const {
  handleMotionSelecionar, handleMotionAprovarMp4, handleMotionMp4Get,
  handleMotionDeletar, handleMotionVersoesGet, handleMotionPedidoPost,
  handleMotionPresetsGet, handleMotionPedidoGet,
} = require('./routes/motion.js')({ ROOT, json, readBody, log, motionPending });

const {
  handleCastArtesList, handleCastCriarArte, handleCastSalvarArte,
  handleCastMudarImagem, handleCastImgVersoesGet, handleCastAtivarImgVersao,
  handleCastArteHtmlDynamic, handleFestArteHtmlDynamic, handleFestReaplicar, handleCastExportar,
  handleCastReaplicar, handleCastDeletarArte, handleCastPedido,
  handleCastPropostasGet, handleCastAprovar, handleCastRejeitar,
  handleCastConsumirBanco, handleCastCampanha, handleCastDuplicarArte, handleCastExportarZip, handleCastPreview,
  handleCastPropostaPreview, handleFestPropostaPreview, invalidateArtesCast,
} = require('./routes/cast.js')({ ROOT, ARTES_TTL, setBusy, clearBusy, json, readBody, log, LAYOUT_BG_POS, readArtes });


// ── Clientes dinâmicos (_clients.json) ─────────────────────────────
const { loadClients, dispatchClient } = require('./utils/client-router.js');
const { iniciarAgendador } = require('./utils/agendador.js');
loadClients();
fs.watch(path.join(ROOT, '_clients.json'), { persistent: false }, () => {
  log.info('_clients.json alterado — recarregando clientes...');
  loadClients();
});

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  const urlPath = decodeURIComponent(url.pathname);

  if (req.method === 'POST' && urlPath === '/api/campanha') return handleCampanha(req, res);
  if (req.method === 'POST' && urlPath === '/api/pedido') return handlePedido(req, res);
  if (req.method === 'GET'  && urlPath === '/api/propostas') return handlePropostasGet(req, res);
  if (req.method === 'GET'  && urlPath === '/api/propostas/preview') return handleFestPropostaPreview(req, res, url.searchParams);
  if (req.method === 'POST' && urlPath === '/api/propostas/aprovar') return handleAprovar(req, res);
  if (req.method === 'POST' && urlPath === '/api/propostas/rejeitar') return handleRejeitar(req, res);
  if (req.method === 'POST' && urlPath === '/api/banco/consumir') return handleConsumirBanco(req, res);
  if (req.method === 'POST' && urlPath === '/api/arte/salvar') return handleSalvarArte(req, res);
  if (req.method === 'POST' && urlPath === '/api/arte/deletar') return handleDeletarArte(req, res);
  if (req.method === 'POST' && urlPath === '/api/arte/imagem/mudar') return handleMudarImagem(req, res);
  if (req.method === 'GET'  && urlPath === '/api/arte/imagem/versoes') return handleImgVersoesGet(req, res, url.searchParams);
  if (req.method === 'POST' && urlPath === '/api/arte/imagem/versao/ativar') return handleAtivarImgVersao(req, res);
  if (req.method === 'POST' && urlPath === '/api/arte/imagem/versao/deletar') return handleDeletarImgVersao(req, res);
  if (req.method === 'POST' && urlPath === '/api/motion/selecionar') return handleMotionSelecionar(req, res);
  if (req.method === 'POST' && urlPath === '/api/motion/aprovar-mp4') return handleMotionAprovarMp4(req, res);
  if (req.method === 'POST' && urlPath === '/api/motion/deletar') return handleMotionDeletar(req, res);
  if (req.method === 'POST' && urlPath === '/api/motion/pedido') return handleMotionPedidoPost(req, res);
  if (req.method === 'GET'  && urlPath === '/api/motion/versoes') return handleMotionVersoesGet(req, res, url.searchParams);
  if (req.method === 'GET'  && urlPath === '/api/motion/pedido') return handleMotionPedidoGet(req, res, url.searchParams);
  if (req.method === 'GET'  && urlPath === '/api/motion/mp4') return handleMotionMp4Get(req, res, url.searchParams);
  if (req.method === 'GET'  && urlPath === '/api/campanha/export') return handleCampanhaExport(req, res, url.searchParams);
  if (req.method === 'GET'  && urlPath === '/api/temas/calendario') return handleCalendario(req, res);
  if (req.method === 'GET'  && urlPath === '/api/status') {
    return json(res, 200, {
      ok: true,
      gerando: generationQueue.size > 0,
      queue: Object.fromEntries(generationQueue),
      fluxo: 'v2-propostas',
      build: '2026-06-23-arte-deletar',
      apis: ['pedido', 'campanha', 'campanha/export', 'propostas', 'aprovar', 'banco', 'arte/salvar', 'arte/deletar', 'motion/selecionar', 'motion/aprovar-mp4', 'motion/deletar', 'motion/mp4', 'motion/versoes', 'motion/pedido', 'motion/presets', 'template/padroes', 'temas/calendario'],
    });
  }

  // ── Autopilot editorial (plano de pautas em lote) ───────────────
  if (urlPath === '/api/autopilot/plano' && req.method === 'GET') {
    try {
      const { lerPlano, clientesDisponiveis } = require('./utils/autopilot.js');
      return json(res, 200, { ok: true, itens: lerPlano(), clientes: clientesDisponiveis() });
    } catch (e) { return json(res, 500, { ok: false, erro: e.message }); }
  }
  if (urlPath === '/api/autopilot/planejar' && req.method === 'POST') {
    return (async () => {
      if (!setBusy(res, '__autopilot')) return;
      try {
        const payload = await readBody(req);
        const cliente = String(payload?.cliente || '').trim();
        if (!cliente) return json(res, 400, { ok: false, erro: 'cliente obrigatório' });
        const { gerarPlano } = require('./utils/autopilot.js');
        const itens = await gerarPlano({ cliente, dias: payload.dias, quantidade: payload.quantidade });
        json(res, 200, { ok: true, itens });
      } catch (e) {
        log.error('Autopilot planejar:', e.message);
        json(res, 500, { ok: false, erro: e.message });
      } finally { clearBusy('__autopilot'); }
    })();
  }
  if (urlPath === '/api/autopilot/remover' && req.method === 'POST') {
    return (async () => {
      try {
        const payload = await readBody(req);
        const { removerItem } = require('./utils/autopilot.js');
        if (!removerItem(String(payload?.id || ''))) return json(res, 404, { ok: false, erro: 'item não encontrado' });
        json(res, 200, { ok: true });
      } catch (e) { json(res, 500, { ok: false, erro: e.message }); }
    })();
  }

  // ── Stats de geração LLM (custo, latência, falhas por modelo) ───
  if (req.method === 'GET' && urlPath === '/api/stats') {
    try {
      const { agregar } = require('./utils/gen-stats.js');
      return json(res, 200, { ok: true, ...agregar() });
    } catch (e) {
      return json(res, 500, { ok: false, erro: e.message });
    }
  }

  if (req.method === 'GET'  && urlPath === '/api/template/padroes') {
    try {
      const { readPadroes } = require('./utils/template-padroes.js');
      return json(res, 200, { ok: true, ...readPadroes() });
    } catch (e) {
      return json(res, 500, { ok: false, erro: e.message });
    }
  }

  // ── Busca global entre clientes ─────────────────────────────────
  if (req.method === 'GET' && urlPath === '/api/search') {
    const q = (url.searchParams.get('q') || '').toLowerCase().trim();
    if (!q || q.length < 2) return json(res, 400, { ok: false, erro: 'query muito curta' });

    let dinamicos = [];
    try {
      dinamicos = JSON.parse(fs.readFileSync(path.join(ROOT, '_clients.json'), 'utf8'))
        .filter(c => c.ativo)
        .map(c => ({ slug: c.slug, banco: path.join(ROOT, `artes-${c.slug}.json`) }));
    } catch { /* sem clientes dinâmicos */ }

    const clientes = [
      { slug: 'fest', banco: path.join(ROOT, 'artes.json') },
      { slug: 'cast', banco: path.join(ROOT, 'artes-cast.json') },
      ...dinamicos,
    ];

    const resultados = [];
    for (const { slug, banco } of clientes) {
      if (!fs.existsSync(banco)) continue;
      try {
        const artes = JSON.parse(fs.readFileSync(banco, 'utf8'));
        for (const a of artes) {
          const texto = [(a.headline || ''), (a.subtitulo || ''), (a.tema || '')].join(' ').toLowerCase();
          if (texto.includes(q)) {
            resultados.push({ cliente: slug, slug: a.slug, headline: a.headline, subtitulo: a.subtitulo, tipo: a.tipo, thumb: `/artes/${a.slug}/thumb.png` });
          }
        }
      } catch { /* banco corrompido ou ausente */ }
    }

    return json(res, 200, { ok: true, total: resultados.length, resultados });
  }

  // ── Onboarding de cliente pela UI ──────────────────────────────
  if (req.method === 'POST' && urlPath === '/api/clientes/criar') return handleCriarCliente(req, res);

  // ── Export Story 1080×1920 (qualquer cliente) ──────────────────
  if (req.method === 'GET' && urlPath === '/api/story.png') {
    const slug = (url.searchParams.get('slug') || '').trim();
    if (!/^[\w-]+$/.test(slug)) return json(res, 400, { ok: false, erro: 'slug inválido' });
    if (!fs.existsSync(path.join(ROOT, 'artes', slug))) return json(res, 404, { ok: false, erro: 'arte não encontrada' });
    if (!setBusy(res, `story-${slug}`)) return;
    (async () => {
      try {
        const { gerarStoryPng } = require('./utils/story-png.js');
        const out = path.join(ROOT, 'artes', slug, 'story.png');

        // layout da arte: procura em todos os bancos (fest, cast, dinâmicos)
        let layout = '';
        const bancos = ['artes.json', 'artes-cast.json'];
        try {
          JSON.parse(fs.readFileSync(path.join(ROOT, '_clients.json'), 'utf8'))
            .filter(c => c.ativo).forEach(c => bancos.push(`artes-${c.slug}.json`));
        } catch { /* sem clientes dinâmicos */ }
        for (const b of bancos) {
          try {
            const arte = JSON.parse(fs.readFileSync(path.join(ROOT, b), 'utf8')).find(a => a.slug === slug);
            if (arte) { layout = arte.layout || ''; break; }
          } catch { /* banco ausente */ }
        }

        const modo = ['stretch', 'frame'].includes(url.searchParams.get('modo')) ? url.searchParams.get('modo') : null;
        await gerarStoryPng(`http://${HOST}:${PORT}/artes/${slug}/arte.html`, out, { layout, modo });
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Content-Disposition': `attachment; filename="${slug}-story.png"`,
          'Cache-Control': 'no-store',
        });
        res.end(fs.readFileSync(out));
        log.info(`Story exportado: ${slug} (1080×1920)`);
      } catch (e) {
        log.error('Story export:', e.message);
        json(res, 500, { ok: false, erro: e.message });
      } finally {
        clearBusy(`story-${slug}`);
      }
    })();
    return;
  }

  // ── Calendário editorial: todas as artes de todos os clientes ──
  if (req.method === 'GET' && urlPath === '/api/calendario') {
    let dinamicos = [];
    try {
      dinamicos = JSON.parse(fs.readFileSync(path.join(ROOT, '_clients.json'), 'utf8'))
        .filter(c => c.ativo)
        .map(c => ({ slug: c.slug, banco: path.join(ROOT, `artes-${c.slug}.json`) }));
    } catch { /* sem clientes dinâmicos */ }

    const clientes = [
      { slug: 'fest', banco: path.join(ROOT, 'artes.json') },
      { slug: 'cast', banco: path.join(ROOT, 'artes-cast.json') },
      ...dinamicos,
    ];

    const artes = [];
    for (const { slug, banco } of clientes) {
      if (!fs.existsSync(banco)) continue;
      try {
        for (const a of JSON.parse(fs.readFileSync(banco, 'utf8'))) {
          artes.push({
            cliente:      slug,
            slug:         a.slug,
            headline:     (a.headline || '').replace(/<br\s*\/?>/gi, ' '),
            tipo:         a.tipo || a.tipo_post || '',
            criado_em:    a.criadoEm || a.created_at || null,
            publicado:    a.publicado === true,
            publicado_em: a.publicado_em || null,
            publicar_em:  a.publicar_em || null,
            thumb:        `/artes/${a.slug}/thumb.png`,
          });
        }
      } catch { /* banco corrompido ou ausente */ }
    }

    return json(res, 200, { ok: true, total: artes.length, artes });
  }

  // ── Clientes dinâmicos (/api/{slug}/*, /{slug}/, /artes/{slug}-*/) ──────────
  if (dispatchClient(req, res, urlPath)) return;

  // ── CYBERSEC.CAST routes (/api/cast/*) ──────────────────────────
  if (req.method === 'POST' && urlPath === '/api/cast/campanha') return handleCastCampanha(req, res);
  if (req.method === 'POST' && urlPath === '/api/cast/pedido') return handleCastPedido(req, res);
  if (req.method === 'GET'  && urlPath === '/api/cast/propostas') return handleCastPropostasGet(req, res);
  if (req.method === 'GET'  && urlPath === '/api/cast/propostas/preview') return handleCastPropostaPreview(req, res, url.searchParams);
  if (req.method === 'POST' && urlPath === '/api/cast/propostas/aprovar') return handleCastAprovar(req, res);
  if (req.method === 'POST' && urlPath === '/api/cast/propostas/rejeitar') return handleCastRejeitar(req, res);
  if (req.method === 'POST' && urlPath === '/api/cast/banco/consumir') return handleCastConsumirBanco(req, res);
  if (req.method === 'GET'  && urlPath === '/api/cast/artes') return handleCastArtesList(req, res);
  if (req.method === 'POST' && urlPath === '/api/cast/arte/criar') return handleCastCriarArte(req, res);
  if (req.method === 'POST' && urlPath === '/api/cast/arte/salvar') return handleCastSalvarArte(req, res);
  if (req.method === 'POST' && urlPath === '/api/cast/arte/deletar') return handleCastDeletarArte(req, res);
  if (req.method === 'POST' && urlPath === '/api/cast/arte/imagem/mudar') return handleCastMudarImagem(req, res);
  if (req.method === 'POST' && urlPath === '/api/cast/arte/reaplicar') return handleCastReaplicar(req, res);
  if (req.method === 'POST' && urlPath === '/api/cast/exportar') return handleCastExportar(req, res);
  if (req.method === 'POST' && urlPath === '/api/cast/arte/duplicar') return handleCastDuplicarArte(req, res);
  if (req.method === 'GET'  && urlPath === '/api/cast/exportar/zip') return handleCastExportarZip(req, res);
  if (req.method === 'POST' && urlPath === '/api/cast/arte/preview') return handleCastPreview(req, res);
  if (req.method === 'POST' && urlPath === '/api/arte/exportar') return handleFestExportar(req, res);
  if (req.method === 'POST' && urlPath === '/api/arte/reaplicar') return handleFestReaplicar(req, res);
  if (req.method === 'GET'  && urlPath === '/api/cast/arte/imagem/versoes') return handleCastImgVersoesGet(req, res, url.searchParams);
  if (req.method === 'POST' && urlPath === '/api/cast/arte/imagem/versao/ativar') return handleCastAtivarImgVersao(req, res);
  if (req.method === 'POST' && urlPath === '/api/cast/arte/imagem/versao/deletar') return handleDeletarImgVersao(req, res);
  if (req.method === 'GET'  && urlPath === '/api/cast/status') {
    return json(res, 200, { ok: true, brand: 'cyberseccast', fluxo: 'v2-propostas', gerando: generationQueue.size > 0, queue: Object.fromEntries(generationQueue), apis: ['cast/pedido', 'cast/campanha', 'cast/propostas', 'cast/banco/consumir', 'cast/arte/deletar', 'cast/temas/calendario'] });
  }
  if (req.method === 'GET'  && urlPath === '/api/cast/temas/calendario') {
    try {
      const temasPath = path.join(ROOT, '_brands/cyberseccast/temas.json');
      const temas = JSON.parse(fs.readFileSync(temasPath, 'utf8'));
      const cal = temas.calendario_editorial || {
        segunda: { tipo_post: 'episodio', observacao: 'Episódio da semana' },
        quarta:  { tipo_post: 'convidado', observacao: 'Apresentação de convidado' },
        sexta:   { tipo_post: 'insight', observacao: 'Post de insight executivo' },
      };
      return json(res, 200, { ok: true, calendario: cal, historico: (temas.historico_recente || []).slice(-8) });
    } catch (e) { return json(res, 500, { ok: false, erro: e.message }); }
  }

  // ── Modo híbrido: renderização dinâmica para artes FEST e CAST ───
  // Intercepta antes do serveStatic; qualquer mudança de código reflete automaticamente
  const festArteMatch = req.method === 'GET' && urlPath.match(/^\/artes\/((evento|blog|patrocinador|palestrante)-[\w-]+)\/arte\.html$/);
  if (festArteMatch) return handleFestArteHtmlDynamic(req, res, festArteMatch[1]);

  const castArteMatch = req.method === 'GET' && urlPath.match(/^\/artes\/(cast-[\w-]+)\/arte\.html$/);
  if (castArteMatch) return handleCastArteHtmlDynamic(req, res, castArteMatch[1]);

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405); return res.end('Method not allowed');
  }

  serveStatic(req, res, urlPath);
});

server.listen(PORT, HOST, () => {
  const local = ['1', 'true', 'yes'].includes(String(process.env.LOCAL_MODE || '').toLowerCase());
  log.info(`CybersecFEST Dev Server — http://${HOST}:${PORT}/ — modo: ${local ? 'LOCAL' : 'REMOTO'}`);
  iniciarAgendador(() => { invalidateArtes(); invalidateArtesCast(); });
  log.info('Agendador de publicação ativo (verifica publicar_em a cada 60s)');

  const { iniciarTelegramBot } = require('./utils/telegram-bot.js');
  if (iniciarTelegramBot({ apiBase: `http://${HOST}:${PORT}` })) {
    log.info('Telegram bot ativo — propostas aprováveis pelo chat');
  }

  const { iniciarAutopilot } = require('./utils/autopilot.js');
  if (iniciarAutopilot({ apiBase: `http://${HOST}:${PORT}` })) {
    log.info('Autopilot editorial ativo (verifica plano-editorial.json a cada 5min)');
  }
});
