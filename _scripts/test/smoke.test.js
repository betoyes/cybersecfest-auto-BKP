'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { renderLayout } = require('../utils/layouts.js');
const {
  MAX_HEADLINE_WORDS,
  enforceHeadlineText,
  prepareHeadlineForLayout,
  normalizePalavrasAzuis,
  enforceHeadlineCopy,
  wordCount,
} = require('../utils/headline-rules.js');
const {
  VALID_LAYOUTS,
  validateLayout,
  getLayoutImageRules,
} = require('../utils/imagem-prompt.js');
const {
  resolveCtaPill,
  ctaPillBlock,
  ctaPillOptional,
  LAYOUT_E_DEFAULT,
} = require('../utils/cta-pill.js');
const { pickNextLayout } = require('../utils/layout-rotacao.js');
const {
  isTemplateSlug,
  layoutFromTemplateSlug,
  readPadroes,
} = require('../utils/template-padroes.js');

const ROOT = path.join(__dirname, '../..');
const BASE_PARAMS = {
  imageBase64: 'dGVzdA==',
  headline: 'O encontro que<br>redefine<br>cyber no Brasil',
  subtitulo: 'C-Levels, decisores e estratégia em um só lugar.',
  palavrasAzuis: 'CYBER, BRASIL',
};

describe('headline-rules.js', () => {
  it('plainHeadline preserva contagem com <br>', () => {
    const hl = 'Quem lidera<br>decide agora<br>o futuro<br>da cyber<br>no Brasil';
    assert.equal(wordCount(hl), 10);
    assert.equal(normalizePalavrasAzuis(hl, 'lidera, futuro'), 'lidera, futuro');
  });

  it('trunca headline acima de 10 palavras', () => {
    const { headline, warnings } = enforceHeadlineText(
      'O Reduto Secreto Onde Líderes Realmente Conversam Sempre Agora Hoje Mesmo'
    );
    assert.equal(headline.split(/\s+/).length, MAX_HEADLINE_WORDS);
    assert.ok(warnings.length > 0);
  });

  it('substitui palavra fora da headline por termos reais', () => {
    const pa = normalizePalavrasAzuis(
      'O Reduto Secreto Onde Líderes Realmente Conversam',
      'ELITE'
    );
    assert.match(pa, /Realmente|Conversam|Reduto|Líderes/);
    assert.doesNotMatch(pa, /ELITE/i);
  });

  it('mantém palavras que existem na headline', () => {
    const pa = normalizePalavrasAzuis('Você gerencia risco. Ou só reage a ele?', 'GERENCIA RISCO');
    assert.match(pa, /gerencia/i);
    assert.match(pa, /risco/i);
  });

  it('quebra headline longa no Layout C', () => {
    const hl = prepareHeadlineForLayout(
      'O Reduto Secreto Onde Líderes Realmente Conversam',
      'C'
    );
    assert.match(hl, /<br>/);
  });

  it('renderLayout(C) aplica quebra e destaque azul', () => {
    const html = renderLayout('C', {
      ...BASE_PARAMS,
      headline: 'O Reduto Secreto Onde Líderes Realmente Conversam',
      palavrasAzuis: 'Realmente, Conversam',
      tipoPost: 'blog',
    });
    assert.doesNotMatch(html, /\.headline-c\{[^}]*white-space:\s*nowrap/);
    assert.match(html, /<br>/);
    assert.match(html, /#14A8F4/);
  });

  it('enforceHeadlineCopy integra texto + layout + palavras azuis', () => {
    const r = enforceHeadlineCopy({
      headline: 'O Reduto Secreto Onde Líderes Realmente Conversam Sempre Agora Hoje Mesmo',
      palavrasAzuis: 'ELITE',
      layout: 'C',
    });
    assert.match(r.headline, /<br>/);
    assert.doesNotMatch(r.palavrasAzuis, /ELITE/i);
    assert.ok(r.warnings.length > 0);
  });
});

describe('layouts.js — Layout C headline', () => {
  it('renderLayout(C) não usa nowrap no título', () => {
    const html = renderLayout('C', {
      ...BASE_PARAMS,
      headline: 'O Reduto Secreto Onde Líderes Realmente Conversam',
      tipoPost: 'blog',
    });
    assert.doesNotMatch(html, /\.headline-c\{[^}]*white-space:\s*nowrap/);
  });
});

describe('layouts.js — render A–Q', () => {
  for (const L of VALID_LAYOUTS) {
    it(`renderLayout(${L}) produz HTML com ids do editor`, () => {
      const html = renderLayout(L, { ...BASE_PARAMS, tipoPost: 'blog' });
      assert.match(html, /id="el-logo"/);
      assert.match(html, /id="el-title"/);
      assert.match(html, /id="el-eco"|class="eco-row"|class="eco-col"/);
      assert.match(html, /540px/);
    });
  }
});

describe('imagem-prompt.js', () => {
  it('VALID_LAYOUTS tem 17 letras A–Q', () => {
    assert.equal(VALID_LAYOUTS.length, 17);
    assert.deepEqual(VALID_LAYOUTS, 'ABCDEFGHIJKLMNOPQ'.split(''));
  });

  it('cada layout tem regras de imagem', () => {
    for (const L of VALID_LAYOUTS) {
      const rules = getLayoutImageRules(L);
      assert.ok(rules.focusId, `${L} sem focusId`);
      assert.ok(rules.clearZones?.length, `${L} sem clearZones`);
    }
  });

  it('rejeita layout inválido', () => {
    assert.throws(() => validateLayout('Z'), /Layout inválido/);
  });
});

describe('cta-pill.js', () => {
  it('Layout E usa default INSCRIÇÕES ABERTAS', () => {
    assert.equal(resolveCtaPill({ layout: 'E' }), LAYOUT_E_DEFAULT);
    const html = ctaPillBlock({ layout: 'E' });
    assert.match(html, /INSCRIÇÕES ABERTAS/);
    assert.match(html, /id="el-cta"/);
  });

  it('cta customizado substitui default no E', () => {
    const html = ctaPillBlock({ layout: 'E', ctaVisual: 'VAGAS LIMITADAS' });
    assert.match(html, /VAGAS LIMITADAS/);
    assert.doesNotMatch(html, /INSCRIÇÕES ABERTAS/);
  });

  it('ctaPillOptional vazio sem cta explícito em J', () => {
    assert.equal(ctaPillOptional({ layout: 'J' }), '');
  });

  it('ctaPillOptional renderiza com cta_visual', () => {
    const html = ctaPillOptional({ layout: 'J', ctaVisual: 'GARANTA SEU LUGAR' });
    assert.match(html, /GARANTA SEU LUGAR/);
  });
});

describe('layout-rotacao.js', () => {
  it('pickNextLayout esgota pool sem repetir no ciclo', () => {
    const pool = ['C', 'M', 'N'];
    let ciclos = {};
    const usados = [];
    for (let i = 0; i < 3; i++) {
      const { layout, layoutCiclos } = pickNextLayout('blog', {
        rotacaoLayouts: { blog: pool },
        layoutCiclos: ciclos,
        historicoRecente: [],
      });
      ciclos = layoutCiclos;
      assert.ok(pool.includes(layout));
      assert.ok(!usados.includes(layout), `repetiu ${layout} no mesmo ciclo`);
      usados.push(layout);
    }
    const last = pickNextLayout('blog', {
      rotacaoLayouts: { blog: pool },
      layoutCiclos: ciclos,
      historicoRecente: [],
    });
    assert.ok(last.meta.novoCiclo || last.layout);
  });
});

describe('template-padroes.js', () => {
  it('reconhece slugs template-a … template-q', () => {
    assert.ok(isTemplateSlug('template-o'));
    assert.equal(layoutFromTemplateSlug('template-q'), 'Q');
    assert.equal(layoutFromTemplateSlug('blog-123'), null);
  });

  it('layout-padroes.json cobre A–Q aprovados', () => {
    const padroes = readPadroes();
    for (const L of 'ABCDEFGHIJKLMNOPQ'.split('')) {
      assert.equal(padroes.layouts?.[L]?.aprovado, true, `Layout ${L} não aprovado`);
    }
  });
});

describe('formatos.js', () => {
  const { resolveFormato, listFormatos, wrapCanvasInner } = require('../utils/formatos.js');

  it('lista feed_vertical, quadrado e stories', () => {
    const ids = listFormatos().map(f => f.id);
    assert.ok(ids.includes('feed_vertical'));
    assert.ok(ids.includes('feed_quadrado'));
    assert.ok(ids.includes('stories'));
  });

  it('stories tem altura 960 preview', () => {
    const f = resolveFormato('stories');
    assert.equal(f.h, 960);
    assert.equal(f.exportH, 1920);
  });

  it('wrapCanvasInner envolve conteúdo', () => {
    const html = wrapCanvasInner('<div id="el-logo"></div>', 'feed_quadrado');
    assert.match(html, /art-canvas-inner/);
  });
});

describe('campanha-presets.js', () => {
  const { planoTiposCampanha, getCampanhaPreset, ctaParaTipo } = require('../utils/campanha-presets.js');

  it('plano de inscrições alterna tipos', () => {
    const tipos = planoTiposCampanha('inscricoes', 5);
    assert.equal(tipos.length, 5);
    assert.ok(tipos.includes('evento'));
  });

  it('CTA de patrocinador', () => {
    assert.equal(ctaParaTipo('patrocinador', 'patrocinadores'), 'SEJA PATROCINADOR');
  });

  it('preset agenda existe', () => {
    assert.equal(getCampanhaPreset('agenda').label, 'Agenda');
  });
});

describe('routes/cast.js — factory', () => {
  const castFactory = require('../routes/cast.js');

  it('factory exporta função', () => {
    assert.equal(typeof castFactory, 'function');
  });

  it('factory devolve todos os handlers', () => {
    const HANDLERS = [
      'handleCastArtesList', 'handleCastCriarArte', 'handleCastSalvarArte',
      'handleCastMudarImagem', 'handleCastImgVersoesGet', 'handleCastAtivarImgVersao',
      'handleCastArteHtmlDynamic', 'handleFestReaplicar', 'handleCastExportar',
      'handleCastReaplicar', 'handleCastDeletarArte', 'handleCastPedido',
      'handleCastPropostasGet', 'handleCastAprovar', 'handleCastRejeitar',
      'handleCastConsumirBanco', 'handleCastCampanha', 'invalidateArtesCast',
    ];
    const noop = () => {};
    const fakeLog = { info: noop, warn: noop, error: noop };
    const handlers = castFactory({
      ROOT, ARTES_TTL: 10000,
      setBusy: () => true, clearBusy: noop,
      json: noop, readBody: async () => ({}),
      log: fakeLog, LAYOUT_BG_POS: {}, readArtes: () => [],
    });
    for (const name of HANDLERS) {
      assert.equal(typeof handlers[name], 'function', `handler faltando: ${name}`);
    }
  });
});

describe('utils/img-versoes.js', () => {
  const { imgVersDir, readImgVersoes } = require('../utils/img-versoes.js');
  const tmpSlug = `test-slug-${Date.now()}`;

  it('imgVersDir retorna path correto', () => {
    const p = imgVersDir(tmpSlug);
    assert.ok(p.includes('img-versoes'), 'path deve conter img-versoes');
    assert.ok(p.includes(tmpSlug));
  });

  it('readImgVersoes retorna estrutura vazia quando não existe', () => {
    const data = readImgVersoes(tmpSlug);
    assert.deepEqual(data, { ativa: null, versoes: [] });
  });
});

describe('galeria-templates manifest', () => {
  it('manifest lista 17 templates com arte.html', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'galeria-templates/manifest.json'), 'utf8')
    );
    assert.equal(manifest.artes.length, 17);
    for (const L of VALID_LAYOUTS) {
      const slug = `template-${L.toLowerCase()}`;
      const arte = manifest.artes.find(a => a.slug === slug);
      assert.ok(arte, `falta ${slug}`);
      assert.equal(arte.layout, L);
      assert.ok(fs.existsSync(path.join(ROOT, arte.html_path)), `${arte.html_path} ausente`);
    }
  });
});

describe('atomic-write.js', () => {
  const os = require('os');
  const { atomicWriteFileSync } = require('../utils/atomic-write.js');

  it('escreve conteúdo, sobrescreve e não deixa arquivo temporário', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-'));
    const f = path.join(dir, 'dados.json');
    atomicWriteFileSync(f, '{"ok":true}');
    assert.equal(fs.readFileSync(f, 'utf8'), '{"ok":true}');
    atomicWriteFileSync(f, '{"ok":false}');
    assert.equal(fs.readFileSync(f, 'utf8'), '{"ok":false}');
    assert.deepEqual(fs.readdirSync(dir), ['dados.json']);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('agendador.js', () => {
  const os = require('os');
  const { verificarAgendamentos } = require('../utils/agendador.js');

  it('publica apenas artes com publicar_em no passado', () => {
    const dir   = fs.mkdtempSync(path.join(os.tmpdir(), 'agendador-'));
    const banco = path.join(dir, 'artes-test.json');
    fs.writeFileSync(banco, JSON.stringify([
      { slug: 'a1', publicar_em: '2020-01-01T00:00:00.000Z' },
      { slug: 'a2', publicar_em: '2099-01-01T00:00:00.000Z' },
      { slug: 'a3', publicado: true, publicar_em: null },
    ]));

    const n = verificarAgendamentos([banco]);

    assert.equal(n, 1);
    const artes = JSON.parse(fs.readFileSync(banco, 'utf8'));
    assert.equal(artes[0].publicado, true);
    assert.ok(artes[0].publicado_em, 'publicado_em deve ser preenchido');
    assert.equal(artes[0].publicar_em, null);
    assert.ok(!artes[1].publicado, 'agendamento futuro não deve publicar');
    assert.equal(artes[1].publicar_em, '2099-01-01T00:00:00.000Z');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('ignora banco inexistente ou corrompido sem lançar', () => {
    const dir   = fs.mkdtempSync(path.join(os.tmpdir(), 'agendador-'));
    const ruim  = path.join(dir, 'artes-ruim.json');
    fs.writeFileSync(ruim, '{corrompido');
    assert.equal(verificarAgendamentos([ruim, path.join(dir, 'nao-existe.json')]), 0);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
