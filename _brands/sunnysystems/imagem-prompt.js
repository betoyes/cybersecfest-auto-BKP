'use strict';

/**
 * SUNNY SYSTEMS — Image Prompt Builder
 *
 * Regras de imagem:
 * • SEM PESSOAS por padrão — apenas quando pessoa/convidado for explicitamente citado
 * • Identidade visual: Âmbar #FBB414, fundo #0f0f0f
 * • Estilo: técnico, sofisticado, abstrato, elementos gráficos, LUT cinematográfico
 * • Cenas conectadas ao tema do post (FinOps, observabilidade, plataforma, etc.)
 */

const STYLE_REF_INSTRUCTION = [
  'SUNNY SYSTEMS VISUAL REFERENCES — match their AMBER/GOLDEN TONALITY AND TECH INFRASTRUCTURE MOOD.',
  'MOOD BOARD ONLY — do NOT copy composition or layout from references.',
  'Create an ORIGINAL image as described in the text prompt.',
  '',
  'Extract from SUNNY SYSTEMS references:',
  '  • Amber #FBB414 as key accent light (data streams, interface highlights, edge glows)',
  '  • Deep dark background #0f0f0f with selective amber illumination',
  '  • Cinematic contrast — technical sophistication, vibrant amber accents, premium feel',
  '  • Technology elements: data grids, network nodes, abstract cloud representations, dynamic flows',
  '',
  'Output: PURE PHOTOGRAPHY or ABSTRACT GRAPHIC, zero text, zero logos.',
].join('\n');

/**
 * Detecta se a cena deve incluir uma pessoa.
 * Só inclui se a arte mencionar explicitamente uma pessoa/convidado.
 */
function detectPerson(arte = '') {
  const text = arte.toLowerCase();
  // Palavras que indicam pessoa específica solicitada
  const personTriggers = /\b(convidado|pessoa|retrato|portrait|executivo|líder|especialista)\b/;
  return personTriggers.test(text);
}

/**
 * Constrói o prompt de imagem SUNNY SYSTEMS.
 *
 * @param {object} arte
 * @param {string} arte.tipo         — tipo de arte ou cena
 * @param {string} arte.layout       — layout de imagem
 * @param {string} [arte.descricao]  — instrução explícita do usuário
 */
// Cenas temáticas quando o usuário não deu instrução visual explícita
const TEMA_SCENE = {
  observabilidade: 'Abstract visualization of monitoring data: glowing amber metric dashboards, log streams, trace graphs, deep dark background — no people, no text in scene',
  finops:          'Abstract visualization of cloud cost optimization: amber-lit server racks with financial data flows, infrastructure maps, resource allocation graphs — no people, no text in scene',
  platform_engineering: 'Abstract internal developer platform: glowing amber pipelines, CI/CD flow diagrams, infrastructure-as-code grids, dark tech environment — no people, no text in scene',
  devsecops:       'Abstract security and DevOps convergence: amber-lit code streams, security scanning visualizations, automated pipeline flows, dark cinematic — no people, no text in scene',
  ia:              'Abstract AI engineering infrastructure: amber neural network nodes, LLM inference pipelines, vector embeddings visualization, dark dramatic — no people, no text in scene',
  produto:         'Abstract SaaS product interface: amber-lit software dashboard, clean data visualization, sophisticated UI abstractions — no people, no text in scene',
  comunidade:      'Abstract tech community stage: amber spotlight on empty stage, tech conference environment, dramatic dark atmosphere — no people, no text in scene',
  autoridade:      'Abstract enterprise technology leadership: amber-lit complex infrastructure panorama, layered systems, dynamic data flows — no people, no text in scene',
};

const LAYOUT_COMPOSITION_HINTS = {
  A: 'Full-bleed subject, bold abstract element or human figure centered — fills frame edge-to-edge',
  B: 'Abstract texture or gradient, no specific focal subject, atmospheric',
  C: 'Centered composition, depth of field, professional studio atmosphere',
  D: 'Split composition — subject or element on the right half, left half open for text',
  G: 'Minimal and clean, dark background with subtle texture, single accent light source',
  H: 'High-contrast graphic, strong diagonal lines or geometric shapes',
  J: 'Wide cinematic composition, landscape orientation feel within vertical frame',
  M: 'Tight focus on single element, bokeh background, macro-style depth',
  N: 'Layered depth — foreground element with blurred midground and background',
};

function buildImagemPrompt({ tipo = 'autoridade', layout = 'A', contexto_visual = '', descricao = '', tema = '', headline = '', subtitulo = '', instrucao = '' } = {}) {
  const desc = (instrucao || contexto_visual || descricao).trim();
  const wantPerson = detectPerson(desc);

  // cena explícita tem prioridade; senão deriva do conteúdo do post
  let scene;
  if (desc) {
    scene = `${desc} — ensure layout composition rules are respected`;
  } else if (headline || tema) {
    // usa o conteúdo do post como base para o conceito visual
    const concept = [headline, subtitulo, tema].filter(Boolean).join(' — ');
    const baseScene = TEMA_SCENE[tipo] || TEMA_SCENE.autoridade;
    scene = `Visual metaphor for this concept: "${concept}". Style reference: ${baseScene}`;
  } else {
    scene = TEMA_SCENE[tipo] || TEMA_SCENE.autoridade;
  }

  const noPeopleProhibition = !wantPerson
    ? [
        '• NO PEOPLE — no faces, no bodies, no hands, no silhouettes of human figures',
        '• NO portraits, no executives, no guests — technology and infrastructure ONLY',
      ]
    : [];

  return [
    '=== MANDATORY BACKGROUND PLATE RULES (VIOLATION = INVALID OUTPUT) ===',
    'Output: PURE PHOTOGRAPHY or CINEMATIC ABSTRACT IMAGE — NOT a designed poster, NOT a social graphic with text.',
    '',
    `LAYOUT ${layout} — IMAGE COMPOSITION CONTRACT:`,
    // Zonas de exclusão canônicas do layout (onde o HTML põe texto/logo) —
    // fonte única em _scripts/utils/imagem-prompt.js, cobre A–Q.
    ...(() => {
      try {
        const { getLayoutImageRules } = require('../../_scripts/utils/imagem-prompt.js');
        const r = getLayoutImageRules(layout);
        return [
          `• Subject placement (MANDATORY): ${r.focusEn}`,
          ...r.clearZones.map(z => `• CLEAR ZONE: ${z}`),
        ];
      } catch { return ['• CLEAR ZONE (text band): top and bottom 20%']; }
    })(),
    ...(LAYOUT_COMPOSITION_HINTS[String(layout).toUpperCase()] ? [`• Mood/style of the subject: ${LAYOUT_COMPOSITION_HINTS[String(layout).toUpperCase()]}`] : []),
    '• Visual focus (REQUIRED): technology and operations sophistication',
    '',
    'SCENE (visual content only):',
    scene,
    '',
    'GLOBAL STYLE (non-negotiable):',
    '• Dark cinematic technology photography — photorealistic OR stylized abstract, premium atmosphere',
    '• Cinematic LUT: deep blacks with selective amber/golden highlights, filmic contrast',
    '• Amber #FBB414 for ALL light sources in the scene',
    '• Dramatic shadows — this is NOT a bright or colorful image',
    '• ORIGINAL composition — creative, elegant, graphic design sensibility',
    '',
    'ABSOLUTE PROHIBITIONS (ZERO TOLERANCE):',
    '• NO text, letters, words, numbers, typography, headlines, subtitles, captions of any kind',
    '• NO logos, watermarks, brand names, UI elements, buttons, labels, signs',
    '• NO marketing copy, quotes, hashtags, or readable content',
    ...noPeopleProhibition,
    '',
    'The HTML overlay will contain ALL text and branding. This image is a silent cinematic background only.',
  ].join('\n');
}

module.exports = {
  buildImagemPrompt,
  detectPerson,
  STYLE_REF_INSTRUCTION,
};