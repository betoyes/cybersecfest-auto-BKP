'use strict';

module.exports = function setupCastRoutes({ ROOT, ARTES_TTL, setBusy, clearBusy, json, readBody, log, LAYOUT_BG_POS, readArtes }) {
  const fs   = require('fs');
  const path = require('path');

  const CAST_BRAND = require('../../_brands/cyberseccast/brand.js');
  const { buildCastImagePrompt, CAST_STYLE_REF_INSTRUCTION } = require('../../_brands/cyberseccast/imagem-prompt.js');
  const { getReferencePartsForGenerationCast } = require('../utils/reference-images.js');
  const { renderLayoutForBrand }  = require('../utils/brand-renderer.js');
  const { extractEditorState }    = require('../utils/editor-state.js');
  const { wrapWithEditor }        = require('../utils/editor-wrap.js');
  const { validateLayout }        = require('../utils/imagem-prompt.js');
  const { imgVersDir, readImgVersoes, writeImgVersoes, saveImgVersion } = require('../utils/img-versoes.js');
  const { atomicWriteFileSync } = require('../utils/atomic-write.js');

  // Lazy: evita falha de inicialização em testes sem API keys
  function getGenerateImage() { return require('../utils/llm.js').generateImage; }
  function getThumb()         { return require('../utils/thumb-composto.js').gerarThumbComposto; }
  function getPedidoCast()    { return require('../pedido-run-cast.js'); }
  function getAprovarCast()   { return require('../aprovar-propostas-cast.js'); }
  function getCampanhaCast()  { return require('../gerar-campanha-cast.js').criarLoteCampanhaCast; }

  const CAST_ARTES_FILE = path.join(ROOT, 'artes-cast.json');
  let castArtesCache    = null;
  let castArtesCacheAt  = 0;

  function readArtesCast() {
    const now = Date.now();
    if (castArtesCache && now - castArtesCacheAt < ARTES_TTL) return castArtesCache;
    if (!fs.existsSync(CAST_ARTES_FILE)) { castArtesCache = []; castArtesCacheAt = now; return []; }
    castArtesCache   = JSON.parse(fs.readFileSync(CAST_ARTES_FILE, 'utf8'));
    castArtesCacheAt = now;
    return castArtesCache;
  }

  function writeArtesCast(artes) {
    atomicWriteFileSync(CAST_ARTES_FILE, JSON.stringify(artes, null, 2) + '\n');
    castArtesCache   = artes;
    castArtesCacheAt = Date.now();
  }

  function invalidateArtesCast() { castArtesCache = null; }

  function readCastEditorState(slug) {
    const stateFile = path.join(ROOT, 'artes', slug, 'state.json');
    if (fs.existsSync(stateFile)) {
      try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { /* corrupto */ }
    }
    const arteLegado = path.join(ROOT, 'artes', slug, 'arte.html');
    if (fs.existsSync(arteLegado)) return extractEditorState(fs.readFileSync(arteLegado, 'utf8'));
    return null;
  }

  function writeCastEditorState(slug, state) {
    const dir = path.join(ROOT, 'artes', slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state));
  }

  const SUBJECT_POS_MAP = { left: { x: 20, y: 50 }, center: { x: 50, y: 50 }, right: { x: 80, y: 50 } };

  async function detectSmartBgPos(imgBuffer, layout) {
    try {
      const { detectSubjectPosition } = require('../utils/llm.js');
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000));
      const pos = await Promise.race([detectSubjectPosition(imgBuffer), timeout]);
      const mapped = SUBJECT_POS_MAP[pos];
      if (mapped) { log.info(`CAST crop inteligente: sujeito ${pos} → x:${mapped.x}`); return mapped; }
    } catch (e) { log.info(`CAST crop inteligente: fallback LAYOUT_BG_POS (${e.message})`); }
    return null;
  }

  function buildArteHtmlCast(slug, arte, imgBuffer, _artePath, resetBgPos = false, bgPosOverride = null) {
    const layout      = (arte.layout || 'C').toUpperCase();
    validateLayout(layout);
    const imageBase64 = imgBuffer.toString('base64');
    let editorState   = readCastEditorState(slug);
    if (resetBgPos) {
      const pos   = bgPosOverride || LAYOUT_BG_POS[layout] || { x: 50, y: 50 };
      editorState = { ...(editorState || {}), x: pos.x, y: pos.y, z: 100 };
    }
    const simpleHtml = renderLayoutForBrand(slug, {
      layout,
      imageBase64,
      headline:        arte.headline,
      subtitulo:       arte.subtitulo || '',
      palavrasAzuis:   arte.palavras_azuis || '',
      nomePalestrante: arte.nome_palestrante || '',
      cargoEmpresa:    arte.cargo_empresa || '',
    }, CAST_BRAND);
    return { html: wrapWithEditor(simpleHtml, { layout, headline: arte.headline, slug, editorState, back: '../../cast/' }), layout };
  }

  // GET /api/cast/artes
  async function handleCastArtesList(_req, res) {
    try { json(res, 200, { ok: true, artes: readArtesCast() }); }
    catch (e) { json(res, 500, { ok: false, erro: e.message }); }
  }

  // POST /api/cast/arte/criar
  async function handleCastCriarArte(req, res) {
    if (!setBusy(res)) return;
    try {
      const payload = await readBody(req);
      if (!payload) return json(res, 400, { ok: false, erro: 'JSON inválido' });

      const slug   = `cast-${Date.now()}`;
      const layout = String(payload.layout || 'C').toUpperCase();
      validateLayout(layout);

      const arte = {
        slug,
        tipo:            payload.tipo || 'episodio',
        layout,
        headline:        String(payload.headline || 'NOVA ARTE CAST').trim(),
        subtitulo:       String(payload.subtitulo || '').trim(),
        palavras_azuis:  String(payload.palavras_azuis || '').trim(),
        contexto_visual: String(payload.contexto_visual || '').trim(),
        legenda:         String(payload.legenda || '').trim(),
        criado_em:       new Date().toISOString(),
        brand:           'cyberseccast',
      };

      const prompt   = buildCastImagePrompt({ tipo: arte.tipo, layout, userScene: arte.contexto_visual || undefined, contextoVisual: arte.contexto_visual || '', slug });
      log.info(`CAST — Criar arte: ${slug} [${layout}]`);

      const castRefs = getReferencePartsForGenerationCast({ max: 3 });
      if (castRefs.paths.length) log.info(`CAST refs: ${castRefs.paths.map(p => path.basename(p)).join(', ')}`);

      const imgBuffer = await getGenerateImage()(prompt, { tipo: arte.tipo, layout, useReferences: false, _referenceParts: castRefs.parts, _styleInstruction: castRefs.parts.length ? CAST_STYLE_REF_INSTRUCTION : null });

      const slugDir   = path.join(ROOT, 'artes', slug);
      const artePath  = path.join(slugDir, 'arte.html');
      const thumbPath = path.join(slugDir, 'thumb.png');
      const fundoPath = path.join(slugDir, 'fundo.png');

      fs.mkdirSync(slugDir, { recursive: true });
      fs.writeFileSync(fundoPath, imgBuffer);
      const smartPos = await detectSmartBgPos(imgBuffer, layout);
      const { html } = buildArteHtmlCast(slug, arte, imgBuffer, artePath, true, smartPos);
      fs.writeFileSync(artePath, html);
      getThumb()(artePath, thumbPath).catch(e => log.warn('thumb CAST criar:', e.message));

      const artes = readArtesCast();
      artes.unshift(arte);
      writeArtesCast(artes);

      log.info(`CAST arte criada: ${slug}`);
      json(res, 200, { ok: true, slug, arte, thumb: `/artes/${slug}/thumb.png?t=${Date.now()}` });
    } catch (e) {
      if (e.statusCode === 413) return json(res, 413, { ok: false, erro: 'Payload muito grande' });
      log.error('Criar arte CAST:', e.message);
      json(res, 500, { ok: false, erro: e.message });
    } finally { clearBusy(); }
  }

  // POST /api/cast/arte/salvar
  async function handleCastSalvarArte(req, res) {
    if (!setBusy(res)) return;
    try {
      const payload = await readBody(req);
      if (!payload) return json(res, 400, { ok: false, erro: 'JSON inválido' });

      const slug  = String(payload.slug || '').trim();
      const state = payload.state;
      const hasState      = state && typeof state === 'object';
      const hasPublicado  = typeof payload.publicado === 'boolean';
      const hasPublicarEm = payload.publicar_em !== undefined;
      if (!slug || (!hasState && !hasPublicado && !hasPublicarEm)) {
        return json(res, 400, { ok: false, erro: 'slug e (state, publicado ou publicar_em) são obrigatórios' });
      }
      if (!/^[\w-]+$/.test(slug)) return json(res, 400, { ok: false, erro: 'slug inválido' });
      const subtitleRaw      = typeof payload.subtitle === 'string' ? payload.subtitle : null;
      const headlineRaw      = typeof payload.headline === 'string' ? payload.headline : null;
      const palavrasAzuisRaw = typeof payload.palavras_azuis === 'string' ? payload.palavras_azuis : null;

      const slugDir   = path.join(ROOT, 'artes', slug);
      const fundoPath = path.join(slugDir, 'fundo.png');
      const thumbPath = path.join(slugDir, 'thumb.png');
      if (!fs.existsSync(fundoPath)) return json(res, 404, { ok: false, erro: `Arte não encontrada: ${slug}` });

      if (hasState) writeCastEditorState(slug, state);

      if (subtitleRaw !== null || headlineRaw !== null || palavrasAzuisRaw !== null || hasPublicado || hasPublicarEm) {
        const artes = readArtesCast();
        const idx   = artes.findIndex(a => a.slug === slug);
        if (idx >= 0) {
          if (subtitleRaw !== null)      artes[idx].subtitulo      = subtitleRaw;
          if (headlineRaw !== null)      artes[idx].headline       = headlineRaw;
          if (palavrasAzuisRaw !== null) artes[idx].palavras_azuis = palavrasAzuisRaw;
          if (hasPublicado) {
            artes[idx].publicado    = payload.publicado;
            artes[idx].publicado_em = payload.publicado ? new Date().toISOString() : null;
          }
          if (hasPublicarEm) {
            // aceita ISO string ou null para cancelar agendamento
            artes[idx].publicar_em = payload.publicar_em || null;
            if (payload.publicar_em) log.info(`📅 Arte ${slug} agendada para ${payload.publicar_em}`);
          }
          writeArtesCast(artes);
        }
      }

      let thumbOk = false;
      if (hasState) try {
        const artes = readArtesCast();
        const arte  = artes.find(a => a.slug === slug);
        if (arte) {
          const imgBuffer = fs.readFileSync(fundoPath);
          const artePath  = path.join(slugDir, 'arte.html');
          const { html }  = buildArteHtmlCast(slug, arte, imgBuffer, artePath, false);
          fs.writeFileSync(artePath, html);
          await getThumb()(artePath, thumbPath);
          thumbOk = true;
        }
      } catch { /* thumb não é crítico */ }

      log.info(`CAST state salvo: ${slug}${thumbOk ? ' + thumb' : ''}`);
      json(res, 200, { ok: true, slug, thumb: thumbOk });
    } catch (e) {
      if (e.statusCode === 413) return json(res, 413, { ok: false, erro: 'Payload muito grande' });
      log.error('Salvar arte CAST:', e.message);
      json(res, 500, { ok: false, erro: e.message });
    } finally { clearBusy(); }
  }

  // POST /api/cast/arte/imagem/mudar
  async function handleCastMudarImagem(req, res) {
    // Lê body antes do setBusy para ter o slug e usar lock por slug
    let payload;
    try { payload = await readBody(req); } catch (e) {
      if (e.statusCode === 413) return json(res, 413, { ok: false, erro: 'Payload muito grande' });
      return json(res, 400, { ok: false, erro: 'Erro ao ler payload' });
    }
    const slug      = String(payload?.slug || '').trim();
    const instrucao = String(payload?.instrucao || '').trim();
    const variar    = Boolean(payload?.variar);
    if (!slug || !/^[\w-]+$/.test(slug)) return json(res, 400, { ok: false, erro: 'slug inválido' });
    if (!variar && !instrucao) return json(res, 400, { ok: false, erro: 'instrucao é obrigatória' });
    if (!setBusy(res, slug)) return;
    try {

      const artes = readArtesCast();
      const arte  = artes.find(a => a.slug === slug);
      if (!arte) return json(res, 404, { ok: false, erro: `Arte CAST não encontrada: ${slug}` });

      const layout    = (arte.layout || 'C').toUpperCase();
      const slugDir   = path.join(ROOT, 'artes', slug);
      const artePath  = path.join(slugDir, 'arte.html');
      const thumbPath = path.join(slugDir, 'thumb.png');
      const fundoPath = path.join(slugDir, 'fundo.png');

      if (!fs.existsSync(artePath)) return json(res, 404, { ok: false, erro: 'arte.html não encontrada' });

      const versoesBefore = readImgVersoes(slug);
      if (versoesBefore.versoes.length === 0) {
        if (fs.existsSync(fundoPath)) {
          saveImgVersion(slug, fundoPath, thumbPath, 'Original');
        } else {
          try {
            const html = fs.readFileSync(artePath, 'utf8');
            const m = html.match(/id="art-bg"[^>]*background-image:\s*url\(['"]?data:image\/[^;]+;base64,([^'")\s]+)/);
            if (m?.[1]) {
              fs.mkdirSync(slugDir, { recursive: true });
              fs.writeFileSync(fundoPath, Buffer.from(m[1], 'base64'));
              saveImgVersion(slug, fundoPath, thumbPath, 'Original');
              log.info(`CAST imagem original extraída: ${slug}`);
            }
          } catch (ex) { log.warn(`CAST não foi possível extrair imagem original de ${slug}:`, ex.message); }
        }
      }

      let imgBuffer;
      if (variar) {
        const currentState = readCastEditorState(slug) || {};
        const existingSeed = Number.isInteger(currentState.seed) && currentState.seed > 0 ? currentState.seed : null;
        const scene  = instrucao || arte.contexto_visual || arte.headline || '';
        const prompt = buildCastImagePrompt({ tipo: arte.tipo || 'episodio', layout, userScene: scene, contextoVisual: scene, slug });
        log.info(`CAST variar cena: ${slug} (seed ${existingSeed ?? 'novo'})`);
        const { generateImageGptImage1WithSeed } = require('../utils/llm.js');
        const result = await generateImageGptImage1WithSeed(prompt, existingSeed);
        imgBuffer = result.buffer;
        writeCastEditorState(slug, { ...currentState, seed: result.seed });
      } else {
        const prompt   = buildCastImagePrompt({ tipo: arte.tipo || 'episodio', layout, userScene: instrucao, contextoVisual: instrucao, slug });
        log.info(`CAST mudar imagem: ${slug} — ${instrucao}`);
        const castRefs = getReferencePartsForGenerationCast({ max: 3 });
        if (castRefs.paths.length) log.info(`CAST refs: ${castRefs.paths.map(p => path.basename(p)).join(', ')}`);
        imgBuffer = await getGenerateImage()(prompt, { tipo: arte.tipo || 'episodio', layout, useReferences: false, _referenceParts: castRefs.parts, _styleInstruction: castRefs.parts.length ? CAST_STYLE_REF_INSTRUCTION : null });
      }

      fs.mkdirSync(slugDir, { recursive: true });
      fs.writeFileSync(fundoPath, imgBuffer);
      log.info(`CAST fundo.png atualizado (${Math.round(imgBuffer.length / 1024)} KB)`);

      const smartPos = await detectSmartBgPos(imgBuffer, layout);
      const { html } = buildArteHtmlCast(slug, arte, imgBuffer, artePath, true, smartPos);
      fs.writeFileSync(artePath, html);
      await getThumb()(artePath, thumbPath);
      const { data: versoesAfter } = saveImgVersion(slug, fundoPath, thumbPath, (instrucao || 'variação').slice(0, 80));

      json(res, 200, { ok: true, slug, thumb: `/artes/${slug}/thumb.png?t=${Date.now()}`, versoes: versoesAfter });
    } catch (e) {
      if (e.statusCode === 413) return json(res, 413, { ok: false, erro: 'Payload muito grande' });
      log.error('CAST mudar imagem falhou:', e.message);
      json(res, 500, { ok: false, erro: e.message });
    } finally { clearBusy(slug); }
  }

  // GET /api/cast/arte/imagem/versoes
  async function handleCastImgVersoesGet(_req, res, searchParams) {
    const slug = String(searchParams.get('slug') || '').trim();
    if (!slug) return json(res, 400, { ok: false, erro: 'slug obrigatório' });
    json(res, 200, { ok: true, ...readImgVersoes(slug) });
  }

  // POST /api/cast/arte/imagem/versao/ativar
  async function handleCastAtivarImgVersao(req, res) {
    if (!setBusy(res)) return;
    try {
      const payload = await readBody(req);
      const slug    = String(payload?.slug || '').trim();
      const id      = Number(payload?.id);
      if (!slug || !/^[\w-]+$/.test(slug)) return json(res, 400, { ok: false, erro: 'slug inválido' });
      if (!id) return json(res, 400, { ok: false, erro: 'id obrigatório' });

      const data  = readImgVersoes(slug);
      const ver   = data.versoes.find(v => v.id === id);
      if (!ver) return json(res, 404, { ok: false, erro: `Versão ${id} não encontrada` });

      const vFundo = path.join(imgVersDir(slug), `v${id}`, 'fundo.png');
      if (!fs.existsSync(vFundo)) return json(res, 404, { ok: false, erro: `fundo.png da versão ${id} não disponível` });

      const artes = readArtesCast();
      const arte  = artes.find(a => a.slug === slug);
      if (!arte) return json(res, 404, { ok: false, erro: 'Arte CAST não encontrada' });

      const artePath  = path.join(ROOT, 'artes', slug, 'arte.html');
      const thumbPath = path.join(ROOT, 'artes', slug, 'thumb.png');
      const fundoPath = path.join(ROOT, 'artes', slug, 'fundo.png');

      const imgBuffer = fs.readFileSync(vFundo);
      fs.writeFileSync(fundoPath, imgBuffer);
      const { html } = buildArteHtmlCast(slug, arte, imgBuffer, artePath, true);
      fs.writeFileSync(artePath, html);
      await getThumb()(artePath, thumbPath);

      data.ativa = id;
      writeImgVersoes(slug, data);
      log.info(`CAST imagem ativada: ${slug} → v${id}`);
      json(res, 200, { ok: true, slug, thumb: `/artes/${slug}/thumb.png?t=${Date.now()}`, versoes: data });
    } catch (e) {
      log.error('CAST ativar versão:', e.message);
      json(res, 500, { ok: false, erro: e.message });
    } finally { clearBusy(); }
  }

  // GET /artes/cast-*/arte.html — renderiza dinamicamente
  async function handleCastArteHtmlDynamic(req, res, slug) {
    try {
      const artes = readArtesCast();
      const arte  = artes.find(a => a.slug === slug);
      if (!arte) { res.writeHead(404); return res.end('Arte CAST não encontrada'); }

      const fundoPath = path.join(ROOT, 'artes', slug, 'fundo.png');
      if (!fs.existsSync(fundoPath)) {
        const arteLegado = path.join(ROOT, 'artes', slug, 'arte.html');
        if (fs.existsSync(arteLegado)) {
          const data = fs.readFileSync(arteLegado);
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
          return res.end(data);
        }
        res.writeHead(404); return res.end('fundo.png não encontrado');
      }

      const imgBuffer = fs.readFileSync(fundoPath);
      const artePath  = path.join(ROOT, 'artes', slug, 'arte.html');
      const { html }  = buildArteHtmlCast(slug, arte, imgBuffer, artePath, false);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache, no-store, must-revalidate' });
      res.end(html);
    } catch (e) {
      log.error('CAST render dinâmico:', e.message);
      res.writeHead(500); res.end('Erro ao renderizar arte');
    }
  }

  // GET /artes/{slug}/arte.html — renderização dinâmica para artes FEST
  async function handleFestArteHtmlDynamic(_req, res, slug) {
    try {
      const arte = readArtes().find(a => a.slug === slug);
      if (!arte) { res.writeHead(404); return res.end('Arte FEST não encontrada'); }

      const fundoPath = path.join(ROOT, 'artes', slug, 'fundo.png');
      if (!fs.existsSync(fundoPath)) {
        const arteLegado = path.join(ROOT, 'artes', slug, 'arte.html');
        if (fs.existsSync(arteLegado)) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
          return res.end(fs.readFileSync(arteLegado));
        }
        res.writeHead(404); return res.end('fundo.png não encontrado');
      }

      const editorState = readCastEditorState(slug);
      const fundoB64    = fs.readFileSync(fundoPath).toString('base64');
      const simpleHtml  = renderLayoutForBrand(slug, { ...arte, imageBase64: fundoB64 });
      const html        = wrapWithEditor(simpleHtml, {
        slug, layout: arte.layout, editorState,
        save: '/api/arte/salvar', back: '/fest/',
      });

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache, no-store, must-revalidate' });
      res.end(html);
    } catch (e) {
      log.error('FEST render dinâmico:', e.message);
      res.writeHead(500); res.end('Erro ao renderizar arte');
    }
  }

  // POST /api/arte/reaplicar + /api/arte/exportar (FEST)
  async function handleFestReaplicar(_req, res) {
    try {
      const artes = readArtes();
      let ok = 0, semThumb = 0, erros = 0;
      for (const arte of artes) {
        try {
          const slug      = arte.slug;
          const arteDir   = path.join(ROOT, 'artes', slug);
          const fundoPath = path.join(arteDir, 'fundo.png');
          const hasFundo  = fs.existsSync(fundoPath);
          const fundoB64  = hasFundo ? fs.readFileSync(fundoPath).toString('base64') : '';
          const simpleHtml = renderLayoutForBrand(slug, { ...arte, imageBase64: fundoB64 });
          const fullHtml   = wrapWithEditor(simpleHtml, { slug, layout: arte.layout, save: '/api/arte/salvar', back: '/fest/' });
          fs.writeFileSync(path.join(arteDir, 'arte.html'), fullHtml);
          if (hasFundo) {
            await getThumb()(`http://localhost:8765/artes/${slug}/arte.html`, path.join(arteDir, 'thumb.png'));
          } else {
            semThumb++;
          }
          ok++;
        } catch (e) { erros++; log.error(`FEST reaplicar ${arte.slug}: ${e.message}`); }
      }
      json(res, 200, { ok: true, reaplicados: ok, sem_thumb: semThumb, erros });
    } catch (e) { json(res, 500, { ok: false, error: e.message }); }
  }

  // POST /api/cast/exportar
  async function handleCastExportar(_req, res) {
    try {
      const artes = readArtesCast();
      let ok = 0, erros = 0;
      for (const arte of artes) {
        const slug = arte.slug;
        if (!slug) continue;
        const slugDir   = path.join(ROOT, 'artes', slug);
        const fundoPath = path.join(slugDir, 'fundo.png');
        const artePath  = path.join(slugDir, 'arte.html');
        if (!fs.existsSync(fundoPath)) { erros++; continue; }
        try {
          const imgBuffer = fs.readFileSync(fundoPath);
          const { html }  = buildArteHtmlCast(slug, arte, imgBuffer, artePath, false);
          fs.writeFileSync(artePath, html);
          ok++;
        } catch (e) { log.warn(`CAST exportar: ${slug} — ${e.message}`); erros++; }
      }
      json(res, 200, { ok: true, exportados: ok, erros });
    } catch (e) {
      log.error('CAST exportar:', e.message);
      json(res, 500, { ok: false, erro: e.message });
    }
  }

  // POST /api/cast/arte/reaplicar
  async function handleCastReaplicar(_req, res) {
    if (!setBusy(res)) return;
    try {
      const artes = readArtesCast();
      let ok = 0, erros = 0;
      for (const arte of artes) {
        const slug = arte.slug;
        if (!slug) continue;
        const slugDir   = path.join(ROOT, 'artes', slug);
        const artePath  = path.join(slugDir, 'arte.html');
        const fundoPath = path.join(slugDir, 'fundo.png');
        const thumbPath = path.join(slugDir, 'thumb.png');
        if (!fs.existsSync(fundoPath)) { log.warn(`CAST reaplicar: fundo.png ausente em ${slug} — pulando`); erros++; continue; }
        try {
          const imgBuffer = fs.readFileSync(fundoPath);
          const { html }  = buildArteHtmlCast(slug, arte, imgBuffer, artePath, false);
          fs.writeFileSync(artePath, html);
          try { await getThumb()(artePath, thumbPath); } catch { /* não crítico */ }
          ok++;
          log.info(`CAST reaplicar: ${slug} [${arte.layout || 'C'}] ✓`);
        } catch (e) { log.warn(`CAST reaplicar: ${slug} falhou — ${e.message}`); erros++; }
      }
      invalidateArtesCast();
      json(res, 200, { ok: true, total: artes.length, reaplicados: ok, erros });
    } catch (e) {
      log.error('CAST reaplicar:', e.message);
      json(res, 500, { ok: false, erro: e.message });
    } finally { clearBusy(); }
  }

  // POST /api/cast/arte/deletar
  async function handleCastDeletarArte(req, res) {
    const payload = await readBody(req);
    if (!payload) return json(res, 400, { ok: false, erro: 'JSON inválido' });
    const slug = String(payload.slug || '').trim();
    if (!slug) return json(res, 400, { ok: false, erro: 'slug obrigatório' });
    try {
      const slugDir = path.join(ROOT, 'artes', slug);
      if (fs.existsSync(slugDir)) fs.rmSync(slugDir, { recursive: true, force: true });
      const artes = readArtesCast().filter(a => a.slug !== slug);
      writeArtesCast(artes);
      invalidateArtesCast();
      log.info(`CAST arte deletada: ${slug}`);
      json(res, 200, { ok: true, slug });
    } catch (e) {
      log.error('CAST deletar arte:', e.message);
      json(res, 500, { ok: false, erro: e.message });
    }
  }

  // POST /api/cast/pedido
  async function handleCastPedido(req, res) {
    if (!setBusy(res)) return;
    try {
      const payload = await readBody(req);
      if (!payload) return json(res, 400, { ok: false, erro: 'JSON inválido' });
      const resultado = await getPedidoCast().executarPedidoCast({
        tema:              String(payload.tema || '').trim(),
        objetivo:          payload.objetivo || 'audiencia',
        tipoPost:          payload.tipoPost || null,
        forcarPropostas:   !!payload.forcarPropostas,
        pularBanco:        !!payload.pularBanco,
        descartarPendente: !!payload.descartarPendente,
      });
      invalidateArtesCast();
      if (resultado.modo === 'propostas' && resultado.lote) {
        try { require('../utils/telegram-bot.js').notificarPropostas('cast', resultado.lote, 'cast'); } catch { /* opcional */ }
      }
      json(res, 200, { ok: true, ...resultado });
    } catch (e) {
      if (e.statusCode === 413) return json(res, 413, { ok: false, erro: 'Payload muito grande' });
      log.error('CAST pedido:', e.message);
      json(res, 500, { ok: false, erro: e.message });
    } finally { clearBusy(); }
  }

  // GET /api/cast/propostas
  async function handleCastPropostasGet(_req, res) {
    try { json(res, 200, { ok: true, ...(await getPedidoCast().getEstadoPropostasCast()) }); }
    catch (e) { json(res, 500, { ok: false, erro: e.message }); }
  }

  // POST /api/cast/propostas/aprovar
  async function handleCastAprovar(req, res) {
    if (!setBusy(res)) return;
    try {
      const payload = await readBody(req);
      if (!payload) return json(res, 400, { ok: false, erro: 'JSON inválido' });
      const { loteId, principalId, bancoIds, edicoes } = payload;
      if (!loteId || !principalId) return json(res, 400, { ok: false, erro: 'loteId e principalId são obrigatórios' });
      const resultado = await getAprovarCast().aprovarLoteCast({ loteId, principalId, bancoIds: bancoIds || [], edicoes: edicoes || {} });
      invalidateArtesCast();
      json(res, 200, { ok: true, ...resultado });
    } catch (e) {
      if (e.statusCode === 413) return json(res, 413, { ok: false, erro: 'Payload muito grande' });
      log.error('CAST aprovar:', e.message);
      json(res, 500, { ok: false, erro: e.message });
    } finally { clearBusy(); }
  }

  // POST /api/cast/propostas/rejeitar
  async function handleCastRejeitar(req, res) {
    if (!setBusy(res)) return;
    try {
      const payload = await readBody(req);
      if (!payload?.loteId) return json(res, 400, { ok: false, erro: 'loteId obrigatório' });
      await getAprovarCast().rejeitarLoteCast(payload.loteId);
      json(res, 200, { ok: true });
    } catch (e) {
      log.error('CAST rejeitar:', e.message);
      json(res, 500, { ok: false, erro: e.message });
    } finally { clearBusy(); }
  }

  // POST /api/cast/banco/consumir
  async function handleCastConsumirBanco(_req, res) {
    if (!setBusy(res)) return;
    try {
      const resultado = await getAprovarCast().consumirBancoCast();
      invalidateArtesCast();
      if (!resultado) return json(res, 200, { ok: true, modo: 'banco_vazio' });
      json(res, 200, { ok: true, modo: 'visual_banco', ...resultado });
    } catch (e) {
      log.error('CAST banco consumir:', e.message);
      json(res, 500, { ok: false, erro: e.message });
    } finally { clearBusy(); }
  }

  // POST /api/cast/campanha
  async function handleCastCampanha(req, res) {
    if (!setBusy(res)) return;
    try {
      const payload = await readBody(req);
      if (!payload) return json(res, 400, { ok: false, erro: 'JSON inválido' });
      const { objetivo = 'engajamento', quantidade = 5, tema = '' } = payload;
      const temas = JSON.parse(fs.readFileSync(path.join(ROOT, '_brands/cyberseccast/temas.json'), 'utf8'));
      const lote  = await getCampanhaCast()({ objetivo, quantidade, tema, temas });
      json(res, 200, { ok: true, lote });
    } catch (e) {
      log.error('CAST campanha:', e.message);
      json(res, 500, { ok: false, erro: e.message });
    } finally { clearBusy(); }
  }

  // POST /api/cast/arte/duplicar
  async function handleCastDuplicarArte(req, res) {
    if (!setBusy(res)) return;
    try {
      const payload   = await readBody(req);
      const slugOrig  = String(payload?.slug || '').trim();
      const instrucao = String(payload?.instrucao || '').trim();
      if (!slugOrig || !/^[\w-]+$/.test(slugOrig)) return json(res, 400, { ok: false, erro: 'slug inválido' });

      const artes = readArtesCast();
      const orig  = artes.find(a => a.slug === slugOrig);
      if (!orig) return json(res, 404, { ok: false, erro: `Arte não encontrada: ${slugOrig}` });

      const slug  = `cast-${Date.now()}`;
      const arte  = {
        slug,
        tipo:            orig.tipo,
        layout:          orig.layout,
        headline:        orig.headline,
        subtitulo:       orig.subtitulo || '',
        palavras_azuis:  orig.palavras_azuis || '',
        contexto_visual: instrucao || orig.contexto_visual || '',
        legenda:         orig.legenda || '',
        criado_em:       new Date().toISOString(),
        brand:           'cyberseccast',
      };

      const prompt   = buildCastImagePrompt({ tipo: arte.tipo, layout: arte.layout, userScene: arte.contexto_visual || undefined, contextoVisual: arte.contexto_visual || '', slug });
      log.info(`CAST — Duplicar arte: ${slugOrig} → ${slug}`);

      const castRefs  = getReferencePartsForGenerationCast({ max: 3 });
      const imgBuffer = await getGenerateImage()(prompt, { tipo: arte.tipo, layout: arte.layout, useReferences: false, _referenceParts: castRefs.parts, _styleInstruction: castRefs.parts.length ? CAST_STYLE_REF_INSTRUCTION : null });

      const slugDir   = path.join(ROOT, 'artes', slug);
      const artePath  = path.join(slugDir, 'arte.html');
      const thumbPath = path.join(slugDir, 'thumb.png');
      const fundoPath = path.join(slugDir, 'fundo.png');

      fs.mkdirSync(slugDir, { recursive: true });
      fs.writeFileSync(fundoPath, imgBuffer);
      const smartPos = await detectSmartBgPos(imgBuffer, arte.layout || 'C');
      const { html } = buildArteHtmlCast(slug, arte, imgBuffer, artePath, true, smartPos);
      fs.writeFileSync(artePath, html);
      getThumb()(artePath, thumbPath).catch(e => log.warn('thumb CAST duplicar:', e.message));

      artes.unshift(arte);
      writeArtesCast(artes);

      log.info(`CAST arte duplicada: ${slug}`);
      json(res, 200, { ok: true, slug, arte, thumb: `/artes/${slug}/thumb.png?t=${Date.now()}` });
    } catch (e) {
      log.error('CAST duplicar arte:', e.message);
      json(res, 500, { ok: false, erro: e.message });
    } finally { clearBusy(); }
  }

  // POST /api/cast/arte/preview — read-only, nunca escreve em disco
  async function handleCastPreview(req, res) {
    try {
      const payload = await readBody(req);
      const slug    = String(payload?.slug || '').trim();
      const state   = payload?.state;
      if (!slug || !/^[\w-]+$/.test(slug) || !state || typeof state !== 'object') {
        return json(res, 400, { ok: false, erro: 'slug e state obrigatórios' });
      }

      const artes = readArtesCast();
      const arte  = artes.find(a => a.slug === slug);
      if (!arte) return json(res, 404, { ok: false, erro: `Arte CAST não encontrada: ${slug}` });

      const fundoPath = path.join(ROOT, 'artes', slug, 'fundo.png');
      if (!fs.existsSync(fundoPath)) return json(res, 404, { ok: false, erro: 'fundo.png não encontrado' });

      const imgBuffer  = fs.readFileSync(fundoPath);
      const layout     = (arte.layout || 'C').toUpperCase();
      validateLayout(layout);
      const simpleHtml = renderLayoutForBrand(slug, {
        layout,
        imageBase64:     imgBuffer.toString('base64'),
        headline:        arte.headline,
        subtitulo:       arte.subtitulo || '',
        palavrasAzuis:   arte.palavras_azuis || '',
        nomePalestrante: arte.nome_palestrante || '',
        cargoEmpresa:    arte.cargo_empresa || '',
      }, CAST_BRAND);
      const html = wrapWithEditor(simpleHtml, { layout, headline: arte.headline, slug, editorState: state, back: '../../cast/' });

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache, no-store' });
      res.end(html);
    } catch (e) {
      log.error('CAST preview:', e.message);
      res.writeHead(500); res.end('Erro ao gerar preview');
    }
  }

  // Render simples (sem editor) de uma proposta pendente — preview antes de aprovar.
  function renderPropostaPreview(res, proposta, brand) {
    const layout = (proposta.layout_sugerido || proposta.layout || 'C').toUpperCase();
    const simpleHtml = renderLayoutForBrand('preview-proposta', {
      layout:          /^[A-Q]$/.test(layout) ? layout : 'C',
      imageBase64:     '',
      headline:        proposta.headline || '',
      subtitulo:       proposta.subtitulo || '',
      palavrasAzuis:   proposta.palavras_azuis || '',
      nomePalestrante: '',
      cargoEmpresa:    '',
    }, brand);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(simpleHtml);
  }

  function acharProposta(data, loteId, id) {
    const lote = (data.lotes || []).find(l => l.id === loteId)
      || (data.lotes || []).find(l => l.status === 'aguardando_aprovacao');
    return lote?.propostas?.find(p => p.id === id) || null;
  }

  // GET /api/cast/propostas/preview?loteId=&id=
  async function handleCastPropostaPreview(_req, res, searchParams) {
    try {
      const { loadStore } = require('../utils/propostas-store-cast.js');
      const { data } = await loadStore();
      const proposta = acharProposta(data, String(searchParams.get('loteId') || ''), String(searchParams.get('id') || ''));
      if (!proposta) { res.writeHead(404); return res.end('Proposta não encontrada'); }
      renderPropostaPreview(res, proposta, CAST_BRAND);
    } catch (e) {
      log.error('CAST preview proposta:', e.message);
      res.writeHead(500); res.end('Erro ao gerar preview');
    }
  }

  // GET /api/propostas/preview?loteId=&id= (FEST)
  async function handleFestPropostaPreview(_req, res, searchParams) {
    try {
      const { loadStore } = require('../utils/propostas-store.js');
      const { data } = await loadStore();
      const proposta = acharProposta(data, String(searchParams.get('loteId') || ''), String(searchParams.get('id') || ''));
      if (!proposta) { res.writeHead(404); return res.end('Proposta não encontrada'); }
      renderPropostaPreview(res, proposta, null); // brand null → identidade FEST
    } catch (e) {
      log.error('FEST preview proposta:', e.message);
      res.writeHead(500); res.end('Erro ao gerar preview');
    }
  }

  // GET /api/cast/exportar/zip
  async function handleCastExportarZip(_req, res) {
    try {
      const { criarZipStream } = require('../utils/zip.js');
      const artes = readArtesCast();
      if (!artes.length) return json(res, 404, { ok: false, erro: 'Nenhuma arte CAST' });

      const archive = criarZipStream();
      res.writeHead(200, {
        'Content-Type':        'application/zip',
        'Content-Disposition': `attachment; filename="cast-artes-${new Date().toISOString().slice(0,10)}.zip"`,
      });

      archive.pipe(res);

      for (const arte of artes) {
        const slug    = arte.slug;
        const mes     = (arte.criado_em || arte.created_at || '').slice(0, 7) || 'sem-data';
        const prefix  = `${mes}/${slug}`;
        const thumbP    = path.join(ROOT, 'artes', slug, 'thumb.png');
        const arteHtmlP = path.join(ROOT, 'artes', slug, 'arte.html');
        if (fs.existsSync(thumbP))    archive.file(thumbP,    { name: `${prefix}/thumb.png` });
        if (fs.existsSync(arteHtmlP)) archive.file(arteHtmlP, { name: `${prefix}/arte.html` });
        if (arte.legenda) {
          archive.append(arte.legenda, { name: `${prefix}/legenda.txt` });
        }
      }

      await archive.finalize();
      log.info(`CAST ZIP exportado: ${artes.length} artes`);
    } catch (e) {
      log.error('CAST exportar ZIP:', e.message);
      if (!res.headersSent) json(res, 500, { ok: false, erro: e.message });
    }
  }

  return {
    handleCastArtesList,
    handleCastCriarArte,
    handleCastSalvarArte,
    handleCastMudarImagem,
    handleCastImgVersoesGet,
    handleCastAtivarImgVersao,
    handleCastArteHtmlDynamic,
    handleFestArteHtmlDynamic,
    handleFestReaplicar,
    handleCastExportar,
    handleCastReaplicar,
    handleCastDeletarArte,
    handleCastPedido,
    handleCastPropostasGet,
    handleCastAprovar,
    handleCastRejeitar,
    handleCastConsumirBanco,
    handleCastCampanha,
    handleCastDuplicarArte,
    handleCastExportarZip,
    handleCastPreview,
    handleCastPropostaPreview,
    handleFestPropostaPreview,
    invalidateArtesCast,
  };
};
