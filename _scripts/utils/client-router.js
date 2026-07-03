'use strict';

const path = require('path');
const fs   = require('fs');
const { renderLayoutForBrand } = require('./brand-renderer');
const { wrapWithEditor }       = require('./editor-wrap');
const { generateText }         = require('./llm');
const { atomicWriteFileSync }  = require('./atomic-write.js');
const { pickNextLayout }       = require('./layout-rotacao.js');

// Pool genérico para clientes sem rotacaoLayouts no brand.js — layouts
// full-bleed que funcionam para qualquer marca (e já têm polish de story).
const GENERIC_LAYOUT_POOL = ['C', 'E', 'F', 'M', 'N', 'L'];

const ROOT      = path.join(__dirname, '../..');
const ARTES_TTL = 10_000;
const SUBJECT_POS_MAP = { left: { x: 20, y: 50 }, center: { x: 50, y: 50 }, right: { x: 80, y: 50 } };

// Lock externo opcional — conectado via configureLock()
let _extSetBusy   = null;
let _extClearBusy = null;

function configureLock(setBusy, clearBusy) {
  _extSetBusy   = setBusy;
  _extClearBusy = clearBusy;
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  return new Promise(resolve => {
    let raw = '';
    req.on('data', c => raw += c);
    req.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve(null); } });
  });
}

class ClientRouter {
  constructor(slug) {
    this.slug       = slug;
    this.dbPath     = path.join(ROOT, `artes-${slug}.json`);
    this._busySlugs = new Set();

    const brandMod = require(path.join(ROOT, '_brands', slug, 'brand.js'));
    this.brand = brandMod.brand
      || brandMod[`${slug.toUpperCase().replace(/-/g, '_')}_BRAND`]
      || Object.values(brandMod).find(v => v && typeof v === 'object' && v.slug)
      || (brandMod.id && brandMod.colors ? brandMod : null);

    try {
      const imgMod = require(path.join(ROOT, '_brands', slug, 'imagem-prompt.js'));
      this.buildImagemPrompt = imgMod.buildImagemPrompt || null;
      this.styleRef          = imgMod.STYLE_REF_INSTRUCTION || null;
    } catch {
      this.buildImagemPrompt = null;
      this.styleRef          = null;
    }

    this._cache    = null;
    this._cacheAt  = 0;
    this._lote     = null;
    this._embCache = null;
    this._EMB_TTL  = 60_000;
    this._imgLock  = false;

    try {
      const sp = require(path.join(ROOT, '_agents', `${slug}-estrategista`, 'system-prompt.js'));
      this.getSystemPromptFn = sp.getSystemPrompt || null;
    } catch {
      this.getSystemPromptFn = null;
    }
  }

  _setBusy(slug) {
    if (this._busySlugs.has(slug)) return false;
    this._busySlugs.add(slug);
    if (_extSetBusy) _extSetBusy(slug);
    return true;
  }

  _clearBusy(slug) {
    this._busySlugs.delete(slug);
    if (_extClearBusy) _extClearBusy(slug);
  }

  readArtes() {
    const now = Date.now();
    if (this._cache && now - this._cacheAt < ARTES_TTL) return this._cache;
    if (!fs.existsSync(this.dbPath)) { this._cache = []; this._cacheAt = now; return []; }
    this._cache   = JSON.parse(fs.readFileSync(this.dbPath, 'utf8'));
    this._cacheAt = now;
    return this._cache;
  }

  writeArtes(artes) {
    atomicWriteFileSync(this.dbPath, JSON.stringify(artes, null, 2) + '\n');
    this._cache    = artes;
    this._cacheAt  = Date.now();
    this._embCache = null;
  }

  readEditorState(arteSlug) {
    const f = path.join(ROOT, 'artes', arteSlug, 'state.json');
    if (fs.existsSync(f)) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch {} }
    return null;
  }

  writeEditorState(arteSlug, state) {
    const dir = path.join(ROOT, 'artes', arteSlug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state));
  }

  buildArteHtml(arteSlug, arte, bgPosOverride = null) {
    const fundoPath = path.join(ROOT, 'artes', arteSlug, 'fundo.png');
    const imageB64  = fs.existsSync(fundoPath) ? fs.readFileSync(fundoPath).toString('base64') : '';

    let editorState = this.readEditorState(arteSlug);
    if (bgPosOverride) editorState = { ...(editorState || {}), x: bgPosOverride.x, y: bgPosOverride.y, z: 100 };

    const simpleHtml = renderLayoutForBrand(arteSlug, {
      layout:          (arte.layout || 'C').toUpperCase(),
      imageBase64:     imageB64,
      headline:        arte.headline        || '',
      subtitulo:       arte.subtitulo       || '',
      palavrasAzuis:   arte.palavras_azuis  || '',
      nomePalestrante: arte.nome_palestrante || '',
      cargoEmpresa:    arte.cargo_empresa   || '',
    }, this.brand);

    return wrapWithEditor(simpleHtml, {
      layout:     (arte.layout || 'C').toUpperCase(),
      slug:       arteSlug,
      editorState,
      save:       `/api/${this.slug}/arte/salvar`,
      previewUrl: `/api/${this.slug}/arte/preview`,
      back:       `/${this.slug}/`,
    });
  }

  _simpleArteHtml(arteSlug, arte) {
    const fundoPath = path.join(ROOT, 'artes', arteSlug, 'fundo.png');
    const imageB64  = fs.existsSync(fundoPath) ? fs.readFileSync(fundoPath).toString('base64') : '';
    return renderLayoutForBrand(arteSlug, {
      layout:          (arte.layout || 'C').toUpperCase(),
      imageBase64:     imageB64,
      headline:        arte.headline        || '',
      subtitulo:       arte.subtitulo       || '',
      palavrasAzuis:   arte.palavras_azuis  || '',
      nomePalestrante: arte.nome_palestrante || '',
      cargoEmpresa:    arte.cargo_empresa   || '',
    }, this.brand);
  }

  async _gerarImagem(arte, instrucao) {
    const { generateImage, validateImageQuality } = require('./llm');
    const prompt = this.buildImagemPrompt
      ? this.buildImagemPrompt({ ...arte, instrucao })
      : instrucao || `Imagem profissional, abstrata, para: ${arte.headline}`;
    const opts = { tipo: arte.tipo, layout: arte.layout, useReferences: false, _styleInstruction: this.styleRef };
    let buf = await generateImage(prompt, opts);
    const valid = await validateImageQuality(buf);
    if (!valid.ok) {
      console.warn(`⚠️ Imagem rejeitada (${valid.motivo}) — retentando...`);
      buf = await generateImage(prompt, opts);
      const valid2 = await validateImageQuality(buf);
      if (!valid2.ok) {
        console.warn(`⚠️ Retry também rejeitado (${valid2.motivo}) — usando mesmo assim`);
      }
    }
    return buf;
  }

  async _detectSmartBgPos(imgBuffer) {
    try {
      const { detectSubjectPosition } = require('./llm');
      const pos = await Promise.race([
        detectSubjectPosition(imgBuffer),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
      ]);
      return SUBJECT_POS_MAP[pos] || null;
    } catch {
      return null;
    }
  }

  async _getArteEmbeddings(artes) {
    const texts = artes
      .map(a => [(a.headline || ''), (a.subtitulo || '')].join(' ').replace(/<[^>]+>/g, ' ').trim())
      .filter(Boolean);
    const now = Date.now();
    if (this._embCache &&
        now - this._embCache.at < this._EMB_TTL &&
        JSON.stringify(texts) === JSON.stringify(this._embCache.texts)) {
      return this._embCache.embeddings;
    }
    const { getEmbedding } = require('./llm');
    const embeddings = await getEmbedding(texts);
    this._embCache = { texts, embeddings, at: now };
    return embeddings;
  }

  async _gerarThumb(artePath, thumbPath) {
    try {
      const { gerarThumbComposto } = require('./thumb-composto');
      await gerarThumbComposto(artePath, thumbPath);
    } catch { /* thumb não é crítico */ }
  }

  async handleArtesList(_req, res) {
    try {
      json(res, 200, { ok: true, artes: this.readArtes() });
    } catch (e) {
      json(res, 500, { ok: false, erro: e.message });
    }
  }

  async handleArteHtmlDynamic(_req, res, arteSlug) {
    try {
      const arte = this.readArtes().find(a => a.slug === arteSlug);
      if (!arte) { res.writeHead(404); return res.end('Arte não encontrada'); }

      const fundoPath = path.join(ROOT, 'artes', arteSlug, 'fundo.png');
      if (!fs.existsSync(fundoPath)) {
        const legado = path.join(ROOT, 'artes', arteSlug, 'arte.html');
        if (fs.existsSync(legado)) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
          return res.end(fs.readFileSync(legado));
        }
        res.writeHead(404); return res.end('fundo.png não encontrado');
      }

      const html = this.buildArteHtml(arteSlug, arte);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache, no-store, must-revalidate' });
      res.end(html);
    } catch (e) {
      res.writeHead(500); res.end(`Erro: ${e.message}`);
    }
  }

  async handleCriarArte(req, res) {
    try {
      const payload = await readBody(req);
      if (!payload) return json(res, 400, { ok: false, erro: 'JSON inválido' });

      const arteSlug = `${this.slug}-${Date.now()}`;
      if (!this._setBusy(arteSlug)) return json(res, 409, { ok: false, erro: 'Geração em andamento' });

      try {
        const layout = String(payload.layout || 'C').toUpperCase();
        const arte = {
          slug:            arteSlug,
          tipo:            payload.tipo            || 'post',
          layout,
          headline:        String(payload.headline        || 'NOVA ARTE').trim(),
          subtitulo:       String(payload.subtitulo       || '').trim(),
          palavras_azuis:  String(payload.palavras_azuis  || '').trim(),
          contexto_visual: String(payload.contexto_visual || '').trim(),
          legenda:         String(payload.legenda         || '').trim(),
          brand:           this.slug,
          criado_em:       new Date().toISOString(),
        };

        const imgBuffer = await this._gerarImagem(arte, arte.contexto_visual);
        const smartPos  = await this._detectSmartBgPos(imgBuffer);

        const arteDir   = path.join(ROOT, 'artes', arteSlug);
        const artePath  = path.join(arteDir, 'arte.html');
        const thumbPath = path.join(arteDir, 'thumb.png');
        const fundoPath = path.join(arteDir, 'fundo.png');

        fs.mkdirSync(arteDir, { recursive: true });
        fs.writeFileSync(fundoPath, imgBuffer);
        fs.writeFileSync(artePath, this.buildArteHtml(arteSlug, arte, smartPos));
        this._gerarThumb(artePath, thumbPath).catch(() => {});

        const artes = this.readArtes();
        artes.unshift(arte);
        this.writeArtes(artes);

        json(res, 200, { ok: true, slug: arteSlug, arte, thumb: `/artes/${arteSlug}/thumb.png?t=${Date.now()}` });
      } finally {
        this._clearBusy(arteSlug);
      }
    } catch (e) {
      json(res, 500, { ok: false, erro: e.message });
    }
  }

  async handleSalvarArte(req, res) {
    try {
      const payload  = await readBody(req);
      const arteSlug = String(payload?.slug  || '').trim();
      const state    = payload?.state;

      const hasState      = state && typeof state === 'object';
      const hasPublicado  = typeof payload?.publicado === 'boolean';
      const hasPublicarEm = payload?.publicar_em !== undefined;

      if (!arteSlug || (!hasState && !hasPublicado && !hasPublicarEm)) {
        return json(res, 400, { ok: false, erro: 'slug e (state, publicado ou publicar_em) são obrigatórios' });
      }

      const fundoPath = path.join(ROOT, 'artes', arteSlug, 'fundo.png');
      if (!fs.existsSync(fundoPath)) return json(res, 404, { ok: false, erro: 'Arte não encontrada' });

      if (hasState) this.writeEditorState(arteSlug, state);

      const subtitleRaw  = typeof payload.subtitle       === 'string' ? payload.subtitle       : null;
      const headlineRaw  = typeof payload.headline       === 'string' ? payload.headline       : null;
      const palavrasRaw  = typeof payload.palavras_azuis === 'string' ? payload.palavras_azuis : null;

      if (subtitleRaw !== null || headlineRaw !== null || palavrasRaw !== null || hasPublicado || hasPublicarEm) {
        const artes = this.readArtes();
        const idx   = artes.findIndex(a => a.slug === arteSlug);
        if (idx >= 0) {
          if (subtitleRaw !== null) artes[idx].subtitulo      = subtitleRaw;
          if (headlineRaw !== null) artes[idx].headline       = headlineRaw;
          if (palavrasRaw !== null) artes[idx].palavras_azuis = palavrasRaw;
          if (hasPublicado) {
            artes[idx].publicado    = payload.publicado;
            artes[idx].publicado_em = payload.publicado ? new Date().toISOString() : null;
          }
          if (hasPublicarEm) {
            // aceita ISO string ou null para cancelar agendamento
            artes[idx].publicar_em = payload.publicar_em || null;
            if (payload.publicar_em) {
              console.log(`📅 Arte ${arteSlug} agendada para ${payload.publicar_em}`);
            }
          }
          this.writeArtes(artes);
        }
      }

      let thumbOk = false;
      if (hasState) {
        try {
          const arte      = this.readArtes().find(a => a.slug === arteSlug);
          const artePath  = path.join(ROOT, 'artes', arteSlug, 'arte.html');
          const thumbPath = path.join(ROOT, 'artes', arteSlug, 'thumb.png');
          if (arte) {
            fs.writeFileSync(artePath, this.buildArteHtml(arteSlug, arte));
            await this._gerarThumb(artePath, thumbPath);
            thumbOk = true;
          }
        } catch { /* thumb não é crítico */ }
      }

      json(res, 200, { ok: true, slug: arteSlug, thumb: thumbOk ? `/artes/${arteSlug}/thumb.png?t=${Date.now()}` : null });
    } catch (e) {
      json(res, 500, { ok: false, erro: e.message });
    }
  }

  async handlePreview(req, res) {
    try {
      const payload  = await readBody(req);
      const arteSlug = String(payload?.slug || '').trim();
      const arte     = this.readArtes().find(a => a.slug === arteSlug);
      if (!arte) { res.writeHead(404); return res.end('Arte não encontrada'); }

      const html = this._simpleArteHtml(arteSlug, arte);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(html);
    } catch (e) {
      res.writeHead(500); res.end(`Erro: ${e.message}`);
    }
  }

  async handleDuplicarArte(req, res) {
    try {
      const payload  = await readBody(req);
      const arteSlug = String(payload?.slug || '').trim();
      if (!arteSlug) return json(res, 400, { ok: false, erro: 'slug obrigatório' });

      const artes = this.readArtes();
      const arte  = artes.find(a => a.slug === arteSlug);
      if (!arte) return json(res, 404, { ok: false, erro: 'Arte não encontrada' });

      const novoSlug = `${this.slug}-${Date.now()}`;
      const novaArte = { ...arte, slug: novoSlug, criadoEm: new Date().toISOString() };
      delete novaArte.recomendada;

      const novoDir   = path.join(ROOT, 'artes', novoSlug);
      const origemDir = path.join(ROOT, 'artes', arteSlug);
      fs.mkdirSync(novoDir, { recursive: true });

      const fundoOrigem = path.join(origemDir, 'fundo.png');
      if (fs.existsSync(fundoOrigem)) fs.copyFileSync(fundoOrigem, path.join(novoDir, 'fundo.png'));

      const stateOrigem = path.join(origemDir, 'state.json');
      if (fs.existsSync(stateOrigem)) fs.copyFileSync(stateOrigem, path.join(novoDir, 'state.json'));

      const artePath  = path.join(novoDir, 'arte.html');
      const thumbPath = path.join(novoDir, 'thumb.png');
      fs.writeFileSync(artePath, this.buildArteHtml(novoSlug, novaArte));
      this._gerarThumb(artePath, thumbPath).catch(() => {});

      artes.unshift(novaArte);
      this.writeArtes(artes);

      json(res, 200, { ok: true, slug: novoSlug, arte: novaArte, thumb: `/artes/${novoSlug}/thumb.png?t=${Date.now()}` });
    } catch (e) {
      json(res, 500, { ok: false, erro: e.message });
    }
  }

  async handleDeletarArte(req, res) {
    try {
      const payload  = await readBody(req);
      const arteSlug = String(payload?.slug || '').trim();
      if (!arteSlug) return json(res, 400, { ok: false, erro: 'slug obrigatório' });

      const artes    = this.readArtes();
      const filtered = artes.filter(a => a.slug !== arteSlug);
      if (filtered.length === artes.length) return json(res, 404, { ok: false, erro: 'Arte não encontrada' });

      this.writeArtes(filtered);
      const arteDir = path.join(ROOT, 'artes', arteSlug);
      if (fs.existsSync(arteDir)) fs.rmSync(arteDir, { recursive: true, force: true });

      json(res, 200, { ok: true, slug: arteSlug });
    } catch (e) {
      json(res, 500, { ok: false, erro: e.message });
    }
  }

  async handleMudarImagem(req, res) {
    if (this._imgLock) {
      return json(res, 429, { ok: false, erro: 'Geração de imagem em andamento. Aguarde.' });
    }
    this._imgLock = true;
    try {
      const payload   = await readBody(req);
      const arteSlug  = String(payload?.slug      || '').trim();
      const instrucao = String(payload?.instrucao || '').trim();
      const variar    = Boolean(payload?.variar);
      if (!arteSlug) return json(res, 400, { ok: false, erro: 'slug inválido' });
      if (!variar && !instrucao) return json(res, 400, { ok: false, erro: 'instrucao é obrigatória' });

      const arte = this.readArtes().find(a => a.slug === arteSlug);
      if (!arte) return json(res, 404, { ok: false, erro: 'Arte não encontrada' });

      if (!this._setBusy(arteSlug)) return json(res, 409, { ok: false, erro: 'Geração em andamento para esta arte' });

      try {
        let imgBuffer;
        if (variar) {
          const { generateImageGptImage1WithSeed } = require('./llm');
          const prevState = this.readEditorState(arteSlug) || {};
          const prevSeed  = typeof prevState.seed === 'number' ? prevState.seed : null;
          const prompt    = this.buildImagemPrompt
            ? this.buildImagemPrompt({ ...arte, instrucao })
            : instrucao || `Imagem profissional, abstrata, para: ${arte.headline}`;
          const result = await generateImageGptImage1WithSeed(prompt, prevSeed);
          imgBuffer = result.buffer;
          this.writeEditorState(arteSlug, { ...(prevState || {}), seed: result.seed });
        } else {
          imgBuffer = await this._gerarImagem(arte, instrucao);
        }

        const smartPos  = await this._detectSmartBgPos(imgBuffer);
        const arteDir   = path.join(ROOT, 'artes', arteSlug);
        const artePath  = path.join(arteDir, 'arte.html');
        const fundoPath = path.join(arteDir, 'fundo.png');
        const thumbPath = path.join(arteDir, 'thumb.png');

        fs.mkdirSync(arteDir, { recursive: true });
        fs.writeFileSync(fundoPath, imgBuffer);
        fs.writeFileSync(artePath, this.buildArteHtml(arteSlug, arte, smartPos));
        this._gerarThumb(artePath, thumbPath).catch(() => {});

        json(res, 200, { ok: true, slug: arteSlug, thumb: `/artes/${arteSlug}/thumb.png?t=${Date.now()}` });
      } finally {
        this._clearBusy(arteSlug);
      }
    } catch (e) {
      json(res, 500, { ok: false, erro: e.message });
    } finally {
      this._imgLock = false;
    }
  }

  async handleExportarZip(_req, res) {
    try {
      const { criarZipStream } = require('./zip.js');
      const artes   = this.readArtes();
      const archive = criarZipStream();

      res.writeHead(200, {
        'Content-Type':        'application/zip',
        'Content-Disposition': `attachment; filename="${this.slug}-artes.zip"`,
      });

      archive.pipe(res);

      for (const arte of artes) {
        const dir      = path.join(ROOT, 'artes', arte.slug);
        const thumb    = path.join(dir, 'thumb.png');
        const fundo    = path.join(dir, 'fundo.png');
        const arteHtml = path.join(dir, 'arte.html');
        if (fs.existsSync(thumb))    archive.file(thumb,    { name: `${arte.slug}/thumb.png` });
        if (fs.existsSync(fundo))    archive.file(fundo,    { name: `${arte.slug}/fundo.png` });
        if (fs.existsSync(arteHtml)) archive.file(arteHtml, { name: `${arte.slug}/arte.html` });
      }

      archive.append(JSON.stringify(artes, null, 2), { name: 'artes.json' });
      await archive.finalize();
    } catch (e) {
      if (!res.headersSent) json(res, 500, { ok: false, erro: e.message });
    }
  }

  // GET /artes/{slug}/slide-N.html — render simples de um slide do carrossel
  // (mesmo layout e fundo da capa, texto do slide no lugar do headline)
  handleSlideHtml(_req, res, arteSlug, n) {
    try {
      const arte  = this.readArtes().find(a => a.slug === arteSlug);
      const slide = arte?.slides?.[n - 1];
      if (!arte || !slide) { res.writeHead(404); return res.end('Slide não encontrado'); }

      const fundoPath = path.join(ROOT, 'artes', arteSlug, 'fundo.png');
      const imageB64  = fs.existsSync(fundoPath) ? fs.readFileSync(fundoPath).toString('base64') : '';

      const html = renderLayoutForBrand(arteSlug, {
        layout:          (arte.layout || 'C').toUpperCase(),
        imageBase64:     imageB64,
        headline:        slide.titulo || '',
        subtitulo:       slide.texto || '',
        palavrasAzuis:   '',
        nomePalestrante: '',
        cargoEmpresa:    '',
      }, this.brand);

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      // #the-canvas: alvo do screenshot do export (gerarThumbComposto)
      res.end(html.replace('class="canvas"', 'id="the-canvas" class="canvas"'));
    } catch (e) {
      res.writeHead(500); res.end(`Erro: ${e.message}`);
    }
  }

  // GET /api/{slug}/arte/carrossel.zip?slug= — PNGs de capa + slides + legenda
  async handleCarrosselZip(req, res) {
    const sp       = new URL(req.url || '', 'http://localhost').searchParams;
    const arteSlug = String(sp.get('slug') || '').trim();
    if (!/^[\w-]+$/.test(arteSlug)) return json(res, 400, { ok: false, erro: 'slug inválido' });

    const arte = this.readArtes().find(a => a.slug === arteSlug);
    if (!arte) return json(res, 404, { ok: false, erro: 'Arte não encontrada' });
    if (!arte.slides?.length) return json(res, 404, { ok: false, erro: 'Arte não tem slides de carrossel' });

    if (!this._setBusy(`carrossel-${arteSlug}`)) return json(res, 409, { ok: false, erro: 'Export em andamento' });
    let browser = null;
    try {
      const { launchBrowser } = require('./puppeteer-browser.js');
      const porta  = Number(process.env.PORT || 8765);
      const outDir = path.join(ROOT, 'artes', arteSlug, 'carrossel');
      fs.mkdirSync(outDir, { recursive: true });

      const arquivos = [];
      const capa = path.join(ROOT, 'artes', arteSlug, 'thumb.png');
      if (fs.existsSync(capa)) arquivos.push({ path: capa, name: '01-capa.png' });

      // um único browser para todos os slides — lançar Chrome por slide é lento
      browser = await launchBrowser();
      const page = await browser.newPage();
      await page.setViewport({ width: 620, height: 780, deviceScaleFactor: 2 });

      for (let i = 1; i <= arte.slides.length; i++) {
        const out = path.join(outDir, `slide-${i}.png`);
        await page.goto(`http://127.0.0.1:${porta}/artes/${arteSlug}/slide-${i}.html`, { waitUntil: 'networkidle0', timeout: 60000 });
        await page.waitForSelector('#the-canvas', { timeout: 15000 });
        await page.evaluate(() => document.fonts.ready);
        const canvas = await page.$('#the-canvas');
        await canvas.screenshot({ path: out, type: 'jpeg', quality: 88 });
        arquivos.push({ path: out, name: `${String(i + 1).padStart(2, '0')}-slide.png` });
      }
      await browser.close();
      browser = null;

      const { criarZipStream } = require('./zip.js');
      const archive = criarZipStream();
      res.writeHead(200, {
        'Content-Type':        'application/zip',
        'Content-Disposition': `attachment; filename="${arteSlug}-carrossel.zip"`,
      });
      archive.pipe(res);
      for (const a of arquivos) archive.file(a.path, { name: a.name });
      if (arte.legenda) archive.append(arte.legenda, { name: 'legenda.txt' });
      await archive.finalize();
    } catch (e) {
      if (!res.headersSent) json(res, 500, { ok: false, erro: e.message });
    } finally {
      if (browser) await browser.close().catch(() => {});
      this._clearBusy(`carrossel-${arteSlug}`);
    }
  }

  // Mesmo baralho da aprovação — calculado na criação do lote para que o
  // preview das propostas mostre exatamente o layout que a aprovação usará.
  _layoutDoBaralho(tipo) {
    const brandMod  = (() => { try { return require(path.join(ROOT, '_brands', this.slug, 'brand.js')); } catch { return {}; } })();
    const pool      = (brandMod.rotacaoLayouts && (brandMod.rotacaoLayouts[tipo] || brandMod.rotacaoLayouts.default)) || GENERIC_LAYOUT_POOL;
    const historico = this.readArtes().map(a => ({ tipo_post: a.tipo, layout: a.layout }));
    const { layout } = pickNextLayout(tipo, {
      rotacaoLayouts: { [tipo]: pool },
      historicoRecente: historico,
    });
    return layout;
  }

  // GET /api/{slug}/propostas/preview?i=N — render simples (sem editor) da
  // proposta pendente com a marca do cliente e o layout previsto do baralho.
  handlePropostaPreview(req, res) {
    try {
      const sp = new URL(req.url || '', 'http://localhost').searchParams;
      const i  = parseInt(sp.get('i'), 10) || 0;
      const proposta = this._lote?.propostas?.[i];
      if (!proposta) { res.writeHead(404); return res.end('Sem propostas pendentes'); }

      const html = renderLayoutForBrand(`preview-${this.slug}`, {
        layout:          this._lote.layoutPrevisto || 'C',
        imageBase64:     '',
        headline:        proposta.headline || '',
        subtitulo:       proposta.subtitulo || '',
        palavrasAzuis:   proposta.palavras_azuis || '',
        nomePalestrante: '',
        cargoEmpresa:    '',
      }, this.brand);

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
    } catch (e) {
      res.writeHead(500); res.end(`Erro: ${e.message}`);
    }
  }

  async handlePedido(req, res) {
    try {
      const body = await readBody(req);
      const tema = (body && body.tema || '').trim();
      if (!tema) return json(res, 400, { ok: false, erro: 'tema obrigatório' });

      // Tipo: explícito > inferido do briefing > tipo do dia (tipo_por_dia do brand)
      let tipo = (body && body.tipo || '').trim();
      if (!tipo) {
        let tpd = {};
        try { tpd = require(path.join(ROOT, '_brands', this.slug, 'brand.js')).tipo_por_dia || {}; } catch { /* sem brand */ }
        const tipos = [...new Set(Object.entries(tpd).filter(([k]) => k !== 'default').map(([, v]) => v))];
        const doDia = tpd[new Date().getDay()] || tpd.default || tipos[0] || 'autoridade';
        const { inferirTipo } = require('./inferir-tipo.js');
        tipo = tipos.length > 1 ? await inferirTipo(tema, tipos, doDia) : doDia;
      }
      if (!this.getSystemPromptFn) return json(res, 400, { ok: false, erro: 'agente estrategista não configurado' });

      const artesRecentes = this.readArtes().slice(0, 10);
      let feedbackBloco = '';
      if (artesRecentes.length) {
        feedbackBloco = '\n\nARTES RECENTES APROVADAS (evite repetir temas/ângulos):\n' +
          artesRecentes.slice(0, 5).map(a => `- "${(a.headline || '').replace(/<[^>]+>/g, '')}"`).join('\n');
      }

      const systemPrompt = this.getSystemPromptFn(tipo) + feedbackBloco;

      // "carrossel" no briefing ativa o modo multi-slide (capa + slides de conteúdo)
      const querCarrossel = /carross?el|carousel/i.test(tema);
      const campoSlides = querCarrossel
        ? `,
      "slides": [
        { "titulo": "Título curto do slide", "texto": "Texto de apoio do slide (1-2 frases)" }
      ]`
        : '';
      const regraSlides = querCarrossel
        ? '\n- slides: 3 a 5 slides de conteúdo do carrossel (a capa é o headline — não repita a capa; cada slide desenvolve um ponto)'
        : '';

      const userPrompt = `TEMA: ${tema}
TIPO DE CONTEÚDO: ${tipo}

Gere 3 propostas de post LinkedIn. Responda APENAS com JSON válido neste formato exato:
{
  "propostas": [
    {
      "headline": "Texto do headline (use <br> para quebrar linhas, máx 10 palavras por linha)",
      "palavras_azuis": "PALAVRA1 PALAVRA2",
      "subtitulo": "Complemento curto do headline (1 linha, pode ser vazio)",
      "legenda": "Texto completo do post LinkedIn. Inclua CTA sutil e hashtags ao final.",
      "cena_visual": "Scene description for AI image generation (in English, abstract or conceptual)",
      "layout": "C"${campoSlides}
    }
  ]
}

Regras:
- headline: curto, impactante, com <br> para quebras de linha
- palavras_azuis: 1-3 palavras do headline que ficarão em destaque, em MAIÚSCULAS
- legenda: 4-8 parágrafos curtos, tom da marca, com hashtags ao final
- cena_visual: cena ou abstração em inglês para geração de imagem de fundo
- layout: letra A-G sugerida (A=título grande, C=centralizado, G=minimalista)${regraSlides}
- Não invente dados. Não mencione produtos sem contexto.`;

      const raw = await generateText(userPrompt, systemPrompt, 0.88, 2048);
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('LLM não retornou JSON');
      const parsed = JSON.parse(match[0]);
      let propostas = (parsed.propostas || []).slice(0, 3);
      if (!propostas.length) throw new Error('Nenhuma proposta gerada');

      propostas[0].recomendada = true;

      try {
        const { marcarSimilares } = require('./similaridade');
        const { getEmbedding }    = require('./llm');
        const arteEmbs = await this._getArteEmbeddings(artesRecentes);
        propostas = await marcarSimilares(propostas, artesRecentes, getEmbedding, arteEmbs);
      } catch (e) { console.warn('⚠️  Similaridade:', e.message); }

      let layoutPrevisto = 'C';
      try { layoutPrevisto = this._layoutDoBaralho(tipo); } catch { /* usa fallback */ }

      this._lote = { id: `${this.slug}-${Date.now()}`, tipo, tema, propostas, layoutPrevisto, criadoEm: new Date().toISOString() };

      try { require('./telegram-bot.js').notificarPropostas(this.slug, this._lote, 'dinamico'); } catch { /* opcional */ }

      json(res, 200, { ok: true, modo: 'propostas', lote: this._lote });
    } catch (e) {
      json(res, 500, { ok: false, erro: e.message });
    }
  }

  handleGetPropostas(_req, res) {
    if (!this._lote) return json(res, 200, { ok: false, lote: null });
    json(res, 200, { ok: true, lote: this._lote });
  }

  async handleAprovarProposta(req, res) {
    if (this._imgLock) {
      return json(res, 429, { ok: false, erro: 'Geração de imagem em andamento. Aguarde.' });
    }
    this._imgLock = true;
    try {
      if (!this._lote) return json(res, 400, { ok: false, erro: 'sem propostas pendentes' });
      const body     = await readBody(req);
      const idx      = parseInt(body && body.idx, 10) || 0;
      const proposta = this._lote.propostas[idx];
      if (!proposta) return json(res, 400, { ok: false, erro: 'índice inválido' });

      const contextoVisual = ((body && body.contexto_visual) || proposta.cena_visual || proposta.contexto_visual || '').trim();
      const headlineRaw    = (proposta.headline || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').trim();

      // Layout: o baralho (rotação sem repetição) decide; a sugestão do LLM
      // não manda — só um layout explícito no body (forçado pelo usuário).
      const tipoLote      = this._lote.tipo;
      const layoutForcado = body && /^[A-Q]$/i.test(body.layout || '') ? String(body.layout).toUpperCase() : null;
      const layoutDeck    = this._lote.layoutPrevisto || this._layoutDoBaralho(tipoLote);

      const arteSlug = `${this.slug}-${Date.now()}`;
      const arte = {
        slug:            arteSlug,
        tipo:            this._lote.tipo,
        tema:            this._lote.tema || '',
        layout:          layoutForcado || layoutDeck,
        headline:        proposta.headline || headlineRaw,
        palavras_azuis:  proposta.palavras_azuis || '',
        subtitulo:       proposta.subtitulo || '',
        legenda:         proposta.legenda || '',
        contexto_visual: contextoVisual,
        criadoEm:        new Date().toISOString(),
      };

      // Carrossel: slides de conteúdo gerados junto com a proposta
      if (Array.isArray(proposta.slides) && proposta.slides.length) {
        arte.slides = proposta.slides.slice(0, 6)
          .map(s => ({ titulo: String(s.titulo || '').trim(), texto: String(s.texto || '').trim() }))
          .filter(s => s.titulo || s.texto);
        if (!arte.slides.length) delete arte.slides;
      }

      if (!this._setBusy(arteSlug)) return json(res, 409, { ok: false, erro: 'Geração em andamento' });

      try {
        const imgBuffer = await this._gerarImagem(arte, contextoVisual);
        const smartPos  = await this._detectSmartBgPos(imgBuffer);

        const arteDir   = path.join(ROOT, 'artes', arteSlug);
        const artePath  = path.join(arteDir, 'arte.html');
        const fundoPath = path.join(arteDir, 'fundo.png');
        const thumbPath = path.join(arteDir, 'thumb.png');

        fs.mkdirSync(arteDir, { recursive: true });
        fs.writeFileSync(fundoPath, imgBuffer);
        fs.writeFileSync(artePath, this.buildArteHtml(arteSlug, arte, smartPos));
        this._gerarThumb(artePath, thumbPath).catch(() => {});

        const artes = this.readArtes();
        artes.push(arte);
        this.writeArtes(artes);
        this._lote = null;

        json(res, 200, { ok: true, slug: arteSlug, thumb: `/artes/${arteSlug}/thumb.png?t=${Date.now()}`, arte });
      } finally {
        this._clearBusy(arteSlug);
      }
    } catch (e) {
      json(res, 500, { ok: false, erro: e.message });
    } finally {
      this._imgLock = false;
    }
  }

  handleRejeitarPropostas(_req, res) {
    this._lote = null;
    json(res, 200, { ok: true });
  }

  handleCalendario(_req, res) {
    const calendarioPath = path.join(ROOT, '_brands', this.slug, 'calendario.json');
    if (fs.existsSync(calendarioPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(calendarioPath, 'utf8'));
        return json(res, 200, { ok: true, ...data });
      } catch { /* JSON inválido — cai no fallback */ }
    }
    json(res, 200, { ok: false, erro: 'Calendário não configurado para este cliente' });
  }

  async handleReaplicar(_req, res) {
    try {
      const artes = this.readArtes();
      let ok = 0, erros = 0;
      for (const arte of artes) {
        try {
          const artePath = path.join(ROOT, 'artes', arte.slug, 'arte.html');
          fs.writeFileSync(artePath, this.buildArteHtml(arte.slug, arte));
          ok++;
        } catch { erros++; }
      }
      json(res, 200, { ok: true, total: artes.length, refeitos: ok, erros });
    } catch (e) {
      json(res, 500, { ok: false, erro: e.message });
    }
  }
}

const CLIENTS_MAP = new Map();

function loadClients() {
  const reg = path.join(ROOT, '_clients.json');
  if (!fs.existsSync(reg)) return;
  const clientes = JSON.parse(fs.readFileSync(reg, 'utf8'));
  for (const c of clientes.filter(c => c.ativo)) {
    try {
      CLIENTS_MAP.set(c.slug, new ClientRouter(c.slug));
      console.log(`[clients] carregado: ${c.slug}`);
    } catch (e) {
      console.warn(`[clients] falha ao carregar ${c.slug}: ${e.message}`);
    }
  }
}

function dispatchClient(req, res, urlPath) {
  for (const [slug, router] of CLIENTS_MAP) {
    const base = `/api/${slug}`;
    if (req.method === 'GET'  && urlPath === `${base}/artes`)               return router.handleArtesList(req, res),          true;
    if (req.method === 'POST' && urlPath === `${base}/arte/criar`)           return router.handleCriarArte(req, res),          true;
    if (req.method === 'POST' && urlPath === `${base}/arte/salvar`)          return router.handleSalvarArte(req, res),         true;
    if (req.method === 'POST' && urlPath === `${base}/arte/preview`)         return router.handlePreview(req, res),            true;
    if (req.method === 'POST' && urlPath === `${base}/arte/duplicar`)        return router.handleDuplicarArte(req, res),       true;
    if (req.method === 'POST' && urlPath === `${base}/arte/deletar`)         return router.handleDeletarArte(req, res),        true;
    if (req.method === 'POST' && urlPath === `${base}/arte/imagem/mudar`)    return router.handleMudarImagem(req, res),        true;
    if (req.method === 'POST' && urlPath === `${base}/reaplicar`)            return router.handleReaplicar(req, res),          true;
    if (req.method === 'GET'  && urlPath === `${base}/exportar-zip`)         return router.handleExportarZip(req, res),        true;
    if (req.method === 'GET'  && urlPath === `${base}/arte/carrossel.zip`)   return router.handleCarrosselZip(req, res),       true;
    if (req.method === 'POST' && urlPath === `${base}/pedido`)               return router.handlePedido(req, res),             true;
    if (req.method === 'GET'  && urlPath === `${base}/propostas`)            return router.handleGetPropostas(req, res),       true;
    if (req.method === 'GET'  && urlPath === `${base}/propostas/preview`)    return router.handlePropostaPreview(req, res),    true;
    if (req.method === 'POST' && urlPath === `${base}/propostas/aprovar`)    return router.handleAprovarProposta(req, res),    true;
    if (req.method === 'POST' && urlPath === `${base}/propostas/rejeitar`)   return router.handleRejeitarPropostas(req, res),  true;
    if (req.method === 'GET'  && urlPath === `${base}/temas/calendario`)     return router.handleCalendario(req, res),          true;
  }

  for (const [slug] of CLIENTS_MAP) {
    if (req.method === 'GET' && (urlPath === `/${slug}` || urlPath === `/${slug}/` || urlPath === `/${slug}/index.html`)) {
      const indexPath = path.join(ROOT, slug, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(fs.readFileSync(indexPath));
      } else {
        res.writeHead(404); res.end('Galeria não encontrada');
      }
      return true;
    }
    if (req.method === 'GET' && urlPath === `/artes-${slug}.json`) {
      const dbPath = path.join(ROOT, `artes-${slug}.json`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : '[]');
      return true;
    }
  }

  for (const [slug, router] of CLIENTS_MAP) {
    const m = req.method === 'GET' && urlPath.match(new RegExp(`^/artes/(${slug}-[\\w-]+)/arte\\.html$`));
    if (m) return router.handleArteHtmlDynamic(req, res, m[1]), true;

    const s = req.method === 'GET' && urlPath.match(new RegExp(`^/artes/(${slug}-[\\w-]+)/slide-(\\d+)\\.html$`));
    if (s) return router.handleSlideHtml(req, res, s[1], parseInt(s[2], 10)), true;
  }

  return false;
}

module.exports = { ClientRouter, loadClients, dispatchClient, CLIENTS_MAP, configureLock };
