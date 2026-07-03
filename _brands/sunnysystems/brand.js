'use strict';

/**
 * SUNNY SYSTEMS — Brand Design Tokens
 * Acento: #FBB414 (âmbar dourado do logo)
 * Fontes: Space Grotesk (headlines) / Inter (body)
 * Fundo: #0f0f0f
 */

const SUNNYSYSTEMS_BRAND = {
  id: 'sunnysystems',
  name: 'Sunny Systems',
  slug_prefix: 'sunny-',
  artes_file: 'artes-sunny.json',
  temas_file: '_brands/sunnysystems/temas.json',
  logo_asset: 'logo-sunny.png',

  colors: {
    bg: '#0f0f0f',
    bg_dark: '#0b0b0b',
    accent: '#FBB414',
    accent_secondary: '#F9C842',
    signal: '#FBB414',
    text_primary: '#f8fafc',
    text_secondary: '#e5e7eb',
    glow: 'rgba(251,180,20,0.35)',
    border: 'rgba(251,180,20,0.22)',
    gradient_text: 'linear-gradient(135deg, #FBB414 0%, #F9C842 50%, #FBB414 100%)',
  },

  fonts: {
    display: 'Space Grotesk',
    display_weight: 700,
    body: 'Inter',
    body_weight: 400,
    google_fonts_url: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@600;700;800&display=swap',
  },

  token_replacements: [
    // Google Fonts → Sunny Systems
    [
      'https://fonts.googleapis.com/css2?family=Ubuntu:wght@700&family=Montserrat:wght@400;600&display=swap',
      'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@600;700;800&display=swap',
    ],
    // acento FEST cyan → âmbar Sunny
    ['rgba(20,168,244,', 'rgba(251,180,20,'],
    ['rgba(20, 168, 244,', 'rgba(251,180,20,'],
    ['#14A8F4', '#FBB414'],
    ['#14a8f4', '#FBB414'],
    // fundo FEST → fundo Sunny
    ['#02050A', '#0f0f0f'],
    ['#02050a', '#0f0f0f'],
    // Fontes (ordem importa)
    ["'Montserrat',sans-serif;font-weight:400", "'Inter',sans-serif;font-weight:400"],
    ["'Montserrat',sans-serif;font-weight:600", "'Space Grotesk',sans-serif;font-weight:400"],
    ["'Montserrat',sans-serif;font-weight:700", "'Space Grotesk',sans-serif;font-weight:700"],
    ["'Ubuntu',sans-serif", "'Space Grotesk',sans-serif"],
    ["'Ubuntu'", "'Space Grotesk'"],
    ['Ubuntu', 'Space Grotesk'],
    ["'Montserrat'", "'Inter'"],
    ['Montserrat', 'Inter'],
  ],

  refs_dir: 'assets/referencias-sunny',

  // Pool de layouts — o baralho do client-router sorteia sem repetição.
  // 'default' vale para todos os tipos; chaves por tipo têm prioridade.
  rotacaoLayouts: {
    default: ['C', 'E', 'M', 'N', 'I', 'L'],
  },

  tipo_por_dia: {
    1: 'produto',
    3: 'diferencial',
    5: 'insight',
    default: 'produto',
  },
};

module.exports = SUNNYSYSTEMS_BRAND;