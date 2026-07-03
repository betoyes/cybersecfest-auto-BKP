'use strict';

/**
 * CYBERSEC.CAST — Brand Design Tokens
 * Podcast executivo de cibersegurança — identidade visual independente do CybersecFEST.
 *
 * CybersecFEST  →  #14A8F4 (cyan)  | Ubuntu Bold / Montserrat | #02050A bg
 * CYBERSEC.CAST →  #6366f1 (indigo) | Space Grotesk / Montserrat / Space Mono | #07060f bg
 *
 * Font hierarchy:
 *   display / headlines → Space Grotesk (bold, uppercase)
 *   body / subtitle     → Montserrat (compartilhada com o FEST — decisão 03 jul 2026; antes era Inter)
 *   tags / eyebrow      → Space Mono (mono uppercase tracking)
 */

const BRAND = {
  id: 'cyberseccast',
  name: 'CYBERSEC.CAST',
  slug_prefix: 'cast-',
  artes_file: 'artes-cast.json',
  temas_file: '_brands/cyberseccast/temas.json',
  logo_asset: 'logo-cast.png',

  colors: {
    // CAST website CSS vars (hosts.html, temporada.html, midia-kit2.html)
    bg: '#07060f',
    bg_dark: '#040308',
    accent: '#6366f1',          // indigo-500
    accent_secondary: '#8b5cf6', // violet-500
    indigo_400: '#818cf8',
    indigo_300: '#a5b4fc',
    violet_600: '#7c3aed',
    violet_400: '#a78bfa',
    violet_300: '#c4b5fd',
    signal: '#37d5ff',           // live/broadcast accent
    text_primary: '#f0eeff',
    text_secondary: '#9b97c4',
    glow: 'rgba(99,102,241,0.35)',
    border: 'rgba(99,102,241,0.22)',
    gradient_text: 'linear-gradient(135deg, #c5cae9 0%, #818cf8 38%, #a78bfa 72%, #c4b5fd 100%)',
  },

  fonts: {
    display: 'Space Grotesk',
    display_weight: 700,
    body: 'Montserrat',
    body_weight: 400,
    mono: 'Space Mono',
    mono_weight: 400,
    google_fonts_url: 'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&family=Space+Grotesk:wght@600;700;800&family=Space+Mono:wght@400;700&display=swap',
  },

  /**
   * Substituições de tokens aplicadas pelo brand-renderer.js
   * em cima do HTML gerado pelo renderLayout() do CybersecFEST.
   * Ordem importa: strings mais específicas primeiro, fallback genérico no final.
   *
   * Mapeamento de fontes (layouts.js usa):
   *   Ubuntu Bold → headlines (.headline, .quote-open, .quote-close)
   *   Montserrat w400 → subtitle body (.subtitle) — MANTIDA no CAST (corpo compartilhado com FEST)
   *   Montserrat w600 → spotlight/eyebrow tags (.sp) → Space Mono
   *   Montserrat w700 → small uppercase tags (.tag-h, .tag-i, etc.) → Space Mono
   */
  token_replacements: [
    // Google Fonts URL → fontes CAST (Montserrat corpo + Space Grotesk + Space Mono)
    [
      'https://fonts.googleapis.com/css2?family=Ubuntu:wght@700&family=Montserrat:wght@400;600&display=swap',
      'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&family=Space+Grotesk:wght@600;700;800&family=Space+Mono:wght@400;700&display=swap',
    ],
    // rgba acento CybersecFEST (#14A8F4) → CAST indigo (#6366f1)
    ['rgba(20,168,244,', 'rgba(99,102,241,'],
    ['rgba(20, 168, 244,', 'rgba(99,102,241,'],
    // cores sólidas
    ['#14A8F4', '#6366f1'],
    ['#14a8f4', '#6366f1'],
    ['#02050A', '#07060f'],
    ['#02050a', '#07060f'],
    // ── Fontes: substituições específicas (ordem importa) ──
    // Montserrat w400 (subtitle body) fica Montserrat — corpo compartilhado, sem replacement
    // Montserrat w600 (sp/eyebrow tags, uppercase) → Space Mono
    ["'Montserrat',sans-serif;font-weight:600", "'Space Mono',monospace;font-weight:400"],
    // Montserrat w700 (tiny uppercase tags) → Space Mono
    ["'Montserrat',sans-serif;font-weight:700", "'Space Mono',monospace;font-weight:700"],
    // Ubuntu (headlines, display) → Space Grotesk
    ["'Ubuntu',sans-serif", "'Space Grotesk',sans-serif"],
    ["'Ubuntu'", "'Space Grotesk'"],
    ['Ubuntu', 'Space Grotesk'],
  ],

  // Ref para image prompt
  refs_dir: 'assets/referencias-cast',

  // Tipo de conteúdo padrão por dia da semana (0=dom … 6=sáb)
  tipo_por_dia: {
    1: 'episodio',
    3: 'convidado',
    5: 'insight',
    default: 'episodio',
  },
};

module.exports = BRAND;
