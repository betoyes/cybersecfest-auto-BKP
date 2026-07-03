'use strict';

const { editorV3Script } = require('./editor-v3-script.js');
const { LAYOUT_NAMES } = require('./layout-names.js');
const { extractEditorState } = require('./editor-state.js');
const { getLayoutCss } = require('./layouts.js');
const { wrapCanvasInner, canvasAttrs, DEFAULT_FORMATO, listFormatos } = require('./formatos.js');

const EDITOR_CSS = `
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%;overflow:hidden;background:#02050a;font-family:'Montserrat',sans-serif;color:#F6F8FF;display:flex;flex-direction:column}
#topbar{flex-shrink:0;height:46px;background:#040411;border-bottom:1px solid rgba(20,168,244,.15);display:flex;align-items:center;gap:12px;padding:0 18px}
.tb-back{display:inline-flex;align-items:center;gap:6px;color:#14A8F4;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;text-decoration:none;background:rgba(20,168,244,.1);border:1px solid rgba(20,168,244,.22);padding:5px 13px;transition:all .15s}
.tb-back:hover{background:rgba(20,168,244,.2)}
.tb-title{flex:1;font-size:11px;color:rgba(255,255,255,.28);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tb-export{display:inline-flex;align-items:center;gap:6px;background:rgba(20,168,244,.15);border:1px solid rgba(20,168,244,.35);color:#14A8F4;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:6px 16px;cursor:pointer;font-family:inherit;transition:all .15s}
.tb-export:hover{background:rgba(20,168,244,.28)}
.tb-export.busy{opacity:.45;cursor:wait;pointer-events:none}
.tb-save{display:inline-flex;align-items:center;gap:6px;background:rgba(46,204,113,.12);border:1px solid rgba(46,204,113,.35);color:#2ecc71;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:6px 16px;cursor:pointer;font-family:inherit;transition:all .15s;margin-right:6px}
.tb-save:hover{background:rgba(46,204,113,.22)}
.tb-save.busy{opacity:.45;cursor:wait;pointer-events:none}
.tb-badge{font-size:9px;color:rgba(255,255,255,.18);letter-spacing:.06em;flex-shrink:0}
.tb-fmt{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);color:#F6F8FF;font-size:9px;font-weight:600;padding:5px 8px;font-family:inherit;cursor:pointer;max-width:140px}
#main-area{flex:1;display:flex;overflow:hidden}
.ep{width:260px;min-width:260px;background:#06060e;overflow-y:auto;display:flex;flex-direction:column;scrollbar-width:thin;scrollbar-color:rgba(20,168,244,.18) transparent}
#pl{border-right:1px solid rgba(255,255,255,.06)}
#pr{border-left:1px solid rgba(255,255,255,.06)}
.ep-hd{padding:11px 16px;font-size:8.5px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#14A8F4;border-bottom:1px solid rgba(255,255,255,.06);position:sticky;top:0;background:#06060e;z-index:1;display:flex;align-items:center;gap:7px}
.ep-s{padding:12px 16px;border-bottom:1px solid rgba(255,255,255,.04)}
.ep-st{font-size:7.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.2);margin-bottom:9px}
.ep-tag{display:inline-block;background:rgba(20,168,244,.08);border:1px solid rgba(20,168,244,.18);color:rgba(20,168,244,.6);font-size:8px;font-weight:700;letter-spacing:.07em;padding:2px 7px;text-transform:uppercase;margin-bottom:8px}
.ep-c{margin-bottom:9px}
.ep-c:last-child{margin-bottom:0}
.ep-l{display:flex;justify-content:space-between;align-items:center;font-size:9.5px;color:rgba(255,255,255,.36);margin-bottom:4px;font-weight:600}
.ep-l em{font-style:normal;color:rgba(20,168,244,.75);font-size:9px;font-weight:700}
input[type=range]{width:100%;accent-color:#14A8F4;cursor:pointer;height:3px}
.ep-tr{display:flex;align-items:center;justify-content:space-between}
.ep-tl{font-size:9.5px;color:rgba(255,255,255,.36);font-weight:600}
.ep-tog{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:rgba(255,255,255,.28);font-size:9px;font-weight:700;padding:3px 11px;cursor:pointer;font-family:inherit;transition:all .15s}
.ep-tog.on{background:rgba(20,168,244,.15);border-color:rgba(20,168,244,.38);color:#14A8F4}
.ep-cr{display:flex;gap:6px;align-items:center;margin-top:4px}
.ep-cr input[type=color]{width:30px;height:26px;border:1px solid rgba(255,255,255,.1);background:none;cursor:pointer;padding:1px;flex-shrink:0}
.ep-cr input[type=text]{flex:1;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);color:#F6F8FF;padding:4px 7px;font-size:11px;font-family:monospace;outline:none}
.ep-sel{width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);color:#F6F8FF;padding:5px 7px;font-size:10px;font-family:inherit;cursor:pointer;outline:none;margin-top:4px}
.ep-seg{display:flex;gap:3px;margin-top:4px}
.ep-sb{flex:1;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);color:rgba(255,255,255,.28);font-size:9.5px;font-weight:700;padding:5px 2px;cursor:pointer;font-family:inherit;text-align:center;transition:all .12s}
.ep-sb.on{background:rgba(20,168,244,.15);border-color:rgba(20,168,244,.38);color:#14A8F4}
.ep-rst{margin:12px 16px;width:calc(100% - 32px);padding:7px;background:transparent;border:1px solid rgba(255,255,255,.08);color:rgba(255,255,255,.28);font-size:9.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;cursor:pointer;font-family:inherit}
.hl-counter{margin-top:6px;padding:8px 10px;border-radius:6px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);font-size:9px;line-height:1.5}
.hl-counter .hl-stat{display:flex;justify-content:space-between;gap:8px;color:rgba(255,255,255,.42);font-weight:600}
.hl-counter .hl-stat em{font-style:normal;color:#14A8F4}
.hl-counter.ok{border-color:rgba(46,204,113,.28);background:rgba(46,204,113,.06)}
.hl-counter.warn{border-color:rgba(255,193,7,.35);background:rgba(255,193,7,.08)}
.hl-counter .hl-warn{color:#ffc107;font-size:8.5px;margin-top:5px;font-weight:600}
#ca{flex:1;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at center,#0d0d22 0%,#02050a 100%);overflow:auto;padding:28px}
#cw{display:flex;flex-direction:column;align-items:center}
.cl{font-size:7.5px;letter-spacing:.2em;color:rgba(20,168,244,.3);text-transform:uppercase;margin-bottom:10px;font-weight:600}
.ci{font-size:7.5px;letter-spacing:.1em;color:rgba(255,255,255,.15);text-align:center;margin-top:9px}
.art-canvas{position:relative;overflow:hidden;box-shadow:0 0 0 1px rgba(20,168,244,.12),0 24px 64px rgba(0,0,0,.8);flex-shrink:0;background:#02050A}
.art-canvas-inner{position:relative;overflow:hidden}
#art-bg{position:absolute;inset:0;background-size:cover;background-position:50% 50%;background-repeat:no-repeat;transition:background-position .08s,background-size .08s,opacity .08s;z-index:0}
#art-bg-img,.art-canvas img.bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0}
#art-overlay,.art-overlay,.art-canvas .ov{position:absolute;inset:0;z-index:1;pointer-events:none}
.art-content,.art-canvas .ct,.art-canvas .bc,.art-canvas .tb,.art-canvas .bb,.art-canvas .lc,.art-canvas .rc,.art-canvas .tc{z-index:2}
.headline,.hl{font-family:'Ubuntu',sans-serif;font-weight:700;color:#F6F8FF}
.subtitulo,.sb{font-family:'Montserrat',sans-serif;color:#D5D8ED}
.logo-cyberfest,.art-canvas .lg{z-index:2}
.ecosystem:not(.eco-panel){position:absolute;display:flex;align-items:center;gap:12px;z-index:2}
.ecosystem-center{left:0;right:0;justify-content:center;gap:18px}
.ecosystem:not(.eco-panel) img{height:33px;filter:brightness(0) invert(1);opacity:0.75}
.art-canvas .left-col,.art-canvas .right-panel,.art-canvas .right-panel-b,.art-canvas .right-img,.art-canvas .img-left,.art-canvas .img-left-b,.art-canvas .text-band,.art-canvas .img-band{z-index:2}
.cta-pill{z-index:2;position:relative}
.badge-layout{position:absolute;bottom:22px;right:14px;background:rgba(20,168,244,0.18);border:1px solid rgba(20,168,244,0.35);color:#14A8F4;font-family:'Montserrat',sans-serif;font-size:9px;font-weight:600;padding:3px 8px;border-radius:4px;letter-spacing:1px;z-index:3}
@media print{#topbar,#pl,#pr{display:none!important}#main-area{display:flex!important;align-items:center!important;justify-content:center!important}#ca{flex:1!important;background:none!important;padding:0!important}.cl,.ci,.badge-layout{display:none!important}}
html.embed body{display:block!important;height:100vh!important;overflow:hidden!important}
html.embed #topbar,html.embed .ep{display:none!important}
html.embed #main-area{height:100vh!important}
html.embed #ca{padding:0!important}
`;

const PANEL_LEFT = `
  <div class="ep" id="pl">
    <div class="ep-hd">🖼 Fundo</div>
    <div class="ep-s">
      <div class="ep-st">Imagem de Fundo</div>
      <div class="ep-c"><div class="ep-l">Posição ←→ <em id="vx">50%</em></div><input type="range" id="sx" min="0" max="100" value="50"></div>
      <div class="ep-c"><div class="ep-l">Posição ↑↓ <em id="vy">50%</em></div><input type="range" id="sy" min="0" max="100" value="50"></div>
      <div class="ep-c"><div class="ep-l">Zoom <em id="vz">cover</em></div><input type="range" id="sz" min="100" max="300" value="100"></div>
      <div class="ep-c"><div class="ep-l">Opacidade <em id="vbo">100%</em></div><input type="range" id="sbo" min="0" max="100" value="100"></div>
      <div class="ep-c"><div class="ep-l">Espelhar</div><div class="ep-seg"><button class="ep-sb" id="btnFlip" type="button">⇄ Flip</button></div></div>
      <div class="ep-c"><div class="ep-l">Saturação <em id="vsat">100%</em></div><input type="range" id="ssat" min="0" max="200" value="100"></div>
    </div>
    <div class="ep-s">
      <div class="ep-st">Overlay</div>
      <div class="ep-c"><div class="ep-l">Opacidade <em id="voo">100%</em></div><input type="range" id="soo" min="0" max="100" value="100"></div>
      <div class="ep-c"><div class="ep-l">Cor do canvas</div><div class="ep-cr"><input type="color" id="cpick" value="#02050A"><input type="text" id="chex" value="#02050A" maxlength="7"></div></div>
      <div class="ep-c"><div class="ep-l">Estilo</div><select id="ols" class="ep-sel"><option value="original">Original</option><option value="dark">Escuro</option><option value="light">Vinheta clara</option><option value="accent">Acento azul</option><option value="none">Sem overlay</option></select></div>
    </div>
    <div class="ep-s">
      <div class="ep-st">Tipografia Global</div>
      <div class="ep-c"><div class="ep-l">Peso (headline)</div><div class="ep-seg" id="fwseg"><button class="ep-sb" data-v="400">400</button><button class="ep-sb" data-v="500">500</button><button class="ep-sb on" data-v="700">700</button></div></div>
    </div>
    <button class="ep-rst" id="rstAll">↺ Resetar fundo</button>
    <div id="previewPane" class="ep-s" style="display:none">
      <div class="ep-st">Preview</div>
      <div style="width:100%;height:285px;overflow:hidden;background:#02050a;border:1px solid rgba(255,255,255,.08);position:relative">
        <iframe id="previewFrame" scrolling="no" sandbox="allow-scripts allow-same-origin" style="width:540px;height:675px;border:none;transform:scale(0.422);transform-origin:top left;position:absolute;top:0;left:0;pointer-events:none;transition:opacity .2s"></iframe>
      </div>
    </div>
  </div>`;

const PANEL_RIGHT = `
  <div class="ep" id="pr">
    <div class="ep-hd">✦ Elementos</div>
    <div class="ep-s">
      <div class="ep-tag">Logo CybersecFEST</div>
      <div class="ep-c"><div class="ep-l">Deslocar ←→ <em id="vlx">0px</em></div><input type="range" id="slx" min="-250" max="250" value="0"></div>
      <div class="ep-c"><div class="ep-l">Deslocar ↑↓ <em id="vly">0px</em></div><input type="range" id="sly" min="-250" max="250" value="0"></div>
      <div class="ep-c"><div class="ep-l">Escala <em id="vls">100%</em></div><input type="range" id="sls" min="40" max="200" value="100"></div>
      <div class="ep-c"><div class="ep-l">Opacidade <em id="vlo">100%</em></div><input type="range" id="slo" min="0" max="100" value="100"></div>
    </div>
    <div class="ep-s">
      <div class="ep-tag">Título</div>
      <div id="hl-counter" class="hl-counter" aria-live="polite">
        <div class="hl-stat"><span>Palavras</span><em id="hl-words">—</em></div>
        <div class="hl-stat"><span>Linhas</span><em id="hl-lines">—</em></div>
        <div class="hl-stat"><span>Azul</span><em id="hl-blue">—</em></div>
        <div class="hl-warn" id="hl-warn" hidden></div>
      </div>
      <div class="ep-c"><div class="ep-l">Alinhamento</div><div class="ep-seg" id="ttaseg"><button class="ep-sb" data-v="left">◀ Esq</button><button class="ep-sb on" data-v="center">Ctr</button><button class="ep-sb" data-v="right">Dir ▶</button></div></div>
      <div class="ep-c"><div class="ep-l">Deslocar ←→ <em id="vtx">0px</em></div><input type="range" id="stx" min="-250" max="250" value="0"></div>
      <div class="ep-c"><div class="ep-l">Deslocar ↑↓ <em id="vty">0px</em></div><input type="range" id="sty" min="-250" max="250" value="0"></div>
      <div class="ep-c"><div class="ep-l">Escala <em id="vts">100%</em></div><input type="range" id="sts" min="40" max="200" value="100"></div>
      <div class="ep-c"><div class="ep-l">Texto</div><textarea id="hlEdit" class="ep-sel" rows="3" style="resize:vertical;min-height:56px;line-height:1.5;font-size:10px;font-family:inherit" placeholder="Título..."></textarea></div>
      <div class="ep-c"><div class="ep-l">Palavras azuis</div><input type="text" id="hlBlue" class="ep-sel" placeholder="ex: MELHOR ANÚNCIO" style="font-size:10px;font-family:inherit;width:100%;box-sizing:border-box;"></div>
    </div>
    <div class="ep-s">
      <div class="ep-tag">Subtítulo</div>
      <div class="ep-c"><div class="ep-l">Alinhamento</div><div class="ep-seg" id="staseg"><button class="ep-sb" data-v="left">◀ Esq</button><button class="ep-sb on" data-v="center">Ctr</button><button class="ep-sb" data-v="right">Dir ▶</button></div></div>
      <div class="ep-c"><div class="ep-l">Deslocar ←→ <em id="vsx">0px</em></div><input type="range" id="ssx" min="-250" max="250" value="0"></div>
      <div class="ep-c"><div class="ep-l">Deslocar ↑↓ <em id="vsy">0px</em></div><input type="range" id="ssy" min="-250" max="250" value="0"></div>
      <div class="ep-c"><div class="ep-l">Texto</div><textarea id="subEdit" class="ep-sel" rows="3" style="resize:vertical;min-height:56px;line-height:1.5;font-size:10px;font-family:inherit" placeholder="Subtítulo..."></textarea></div>
    </div>
    <div class="ep-s" id="ctaSection">
      <div class="ep-tag">CTA Pill</div>
      <div class="ep-c"><div class="ep-l">Texto</div><input type="text" id="ctaTxt" class="ep-sel" maxlength="48" placeholder="INSCRIÇÕES ABERTAS" style="text-transform:uppercase"></div>
      <div class="ep-c"><div class="ep-l">Deslocar ←→ <em id="vcx">0px</em></div><input type="range" id="scx" min="-250" max="250" value="0"></div>
      <div class="ep-c"><div class="ep-l">Deslocar ↑↓ <em id="vcy">0px</em></div><input type="range" id="scy" min="-250" max="250" value="0"></div>
    </div>
    <div class="ep-s">
      <div class="ep-tag">Ícones / Ecossistema</div>
      <div class="ep-c"><div class="ep-l">Deslocar ←→ <em id="vex">0px</em></div><input type="range" id="sex" min="-250" max="250" value="0"></div>
      <div class="ep-c"><div class="ep-l">Deslocar ↑↓ <em id="vey">0px</em></div><input type="range" id="sey" min="-250" max="250" value="0"></div>
      <div class="ep-c"><div class="ep-l">Opacidade <em id="veo">75%</em></div><input type="range" id="seo" min="0" max="100" value="75"></div>
    </div>
    <button class="ep-rst" id="rstEl">↺ Resetar elementos</button>
  </div>`;

function extractBalancedDivInner(html, openRe) {
  const open = html.search(openRe);
  if (open < 0) return '';
  const start = html.indexOf('>', open) + 1;
  let depth = 1;
  let i = start;
  while (i < html.length && depth > 0) {
    const nextOpen  = html.indexOf('<div', i);
    const nextClose = html.indexOf('</div>', i);
    if (nextClose < 0) break;
    if (nextOpen >= 0 && nextOpen < nextClose) {
      depth += 1;
      i = nextOpen + 4;
    } else {
      depth -= 1;
      if (depth === 0) return html.slice(start, nextClose).trim();
      i = nextClose + 6;
    }
  }
  return '';
}

function extractCanvasInner(html) {
  return extractBalancedDivInner(html, /<div class="canvas">/i);
}

function extractLayoutCss(html) {
  const m = html.match(/<style>([\s\S]*?)<\/style>/i);
  if (!m) return '';
  const css = m[1];
  const canvasRule = css.match(/\.canvas\{[^}]*\}/);
  if (!canvasRule) return css.trim();
  const idx = css.indexOf(canvasRule[0]) + canvasRule[0].length;
  return css.slice(idx).trim();
}

function extractCanvasFromEditor(html) {
  const raw = extractBalancedDivInner(html, /<div class="art-canvas" id="the-canvas"[^>]*>/i);
  const m = raw.match(/<div class="art-canvas-inner"[^>]*>([\s\S]*)<\/div>\s*$/i);
  return m ? m[1].trim() : raw;
}

function resolveLayoutCss(html, layout) {
  const editorMatch = html.match(/\/\* Layout [A-Q] \*\/([\s\S]*?)(?:@media print|html\.embed)/i);
  if (editorMatch && editorMatch[1].trim()) return editorMatch[1].trim();
  const simple = extractLayoutCss(html);
  if (simple && /\.(hl|ct|bc|bb|lc)\{/.test(simple)) return simple;
  if (layout) return getLayoutCss(layout);
  return '';
}

function canvasLooksValid(inner, layout) {
  if (!inner || inner.length < 80) return false;
  if (!inner.includes('art-bg') && !inner.includes('class="bg"')) return false;
  const letter = String(layout || '').toUpperCase();
  if (['M', 'N', 'C', 'G'].includes(letter)
    && !inner.includes('class="ct"')
    && !inner.includes('art-content ct')
    && !inner.includes('class="bc"')) {
    return false;
  }
  return inner.includes('el-title') || inner.includes('class="hl"');
}

/** Normaliza canvas para estrutura compatível com editor v3 (referência) */
function normalizeCanvas(inner, layout) {
  let out = inner;

  // img.bg → #art-bg div
  out = out.replace(
    /<img class="bg" id="art-bg-img" src="([^"]+)"[^>]*>/,
    '<div id="art-bg" style="background-image:url(\'$1\')"></div>'
  );
  out = out.replace(
    /<img class="bg" src="([^"]+)"[^>]*>/,
    '<div id="art-bg" style="background-image:url(\'$1\')"></div>'
  );

  // overlay ids
  out = out.replace(/<div class="ov"( id="art-overlay")?><\/div>/, '<div id="art-overlay" class="art-overlay ov"></div>');
  if (!out.includes('id="art-overlay"')) {
    out = out.replace(/<div class="ov"><\/div>/, '<div id="art-overlay" class="art-overlay ov"></div>');
  }

  // IDs obrigatórios para painel Elementos (referência blog-1782058741657)
  if (!out.includes('id="el-logo"')) {
    out = out.replace(/<img(?=[^>]*class="[^"]*(?:logo-img|logo-cyberfest|lg)[^"]*")/g, '<img id="el-logo"');
  }
  if (!out.includes('id="el-title"')) {
    out = out.replace(/<h1 class="headline"/, '<h1 id="el-title" class="headline"');
  }
  if (!out.includes('id="el-sub"')) {
    out = out.replace(/<div class="subtitle"/, '<div id="el-sub" class="subtitle subtitulo"');
    out = out.replace(/<p class="subtitle"/, '<p id="el-sub" class="subtitle subtitulo"');
    out = out.replace(/<div class="sb"/, '<div id="el-sub" class="subtitulo sb"');
  }
  if (!out.includes('id="el-title"')) {
    out = out.replace(/<div class="hl"/, '<div id="el-title" class="headline hl"');
  }
  if (!out.includes('id="el-logo"')) {
    out = out.replace(/<img class="lg"/, '<img id="el-logo" class="logo-cyberfest lg"');
  }

  // art-content wrapper (layout C style)
  if (!out.includes('art-content') && out.includes('class="ct"')) {
    out = out.replace(/<div class="ct">/, '<div class="art-content ct">');
  }

  // ecosystem — achatar div inline legado (bug transform + height 0)
  out = out.replace(
    /<div id="el-eco" class="ecosystem"[^>]*>\s*<div style="[^"]*position:\s*absolute[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i,
    '<div id="el-eco" class="ecosystem">$1</div>'
  );
  out = out.replace(
    /<div style="position:absolute;bottom:(\d+)px;[^"]*display:\s*flex[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<\/body>|$)/i,
    (_, bottom, imgs) => {
      const center = /translateX\(-50%\)/.test(_) ? ' ecosystem-center' : '';
      const leftM  = _.match(/left:(\d+)px/);
      const style  = leftM && !center
        ? ` style="bottom:${bottom}px;left:${leftM[1]}px"`
        : ` style="bottom:${bottom}px"`;
      return `<div id="el-eco" class="ecosystem${center.trim()}"${style}>${imgs.trim()}</div>`;
    }
  );
  if (!out.includes('id="el-eco"')) {
    out = out.replace(
      /<div class="ecosystem([^"]*)"([^>]*)>([\s\S]*?)<\/div>/,
      '<div id="el-eco" class="ecosystem$1"$2>$3</div>'
    );
  }
  out = out.replace(/\sclass="ecosystem"\sclass="ecosystem"/g, ' class="ecosystem"');

  return out;
}

function annotateCanvas(inner, layout) {
  return normalizeCanvas(inner, layout);
}

// CSS de rediagramação Stories (safe areas + tipografia) — desativado via
// media="not all"; o editor liga trocando para media="all" no applyFormato.
function storyPolishCss(layout) {
  const { STORY_POLISH_BASE, LAYOUT_POLISH } = require('./story-png.js');
  return STORY_POLISH_BASE + (LAYOUT_POLISH[String(layout || '').toUpperCase()] || '');
}

function buildEditorHtml({ inner, layoutCss, layout, layoutN, title, back, slug, editorState, formato = DEFAULT_FORMATO, palavrasAzuis = '', saveUrl = null, previewUrl = '' }) {
  const css = layoutCss || (layout ? getLayoutCss(layout) : '');
  const stateBlock = editorState
    ? `<script type="application/json" id="editor-state">${JSON.stringify(editorState)}</script>\n`
    : '';
  const metaBlock = palavrasAzuis
    ? `<script type="application/json" id="arte-meta">${JSON.stringify({ palavras_azuis: palavrasAzuis })}</script>\n`
    : '';
  const fmt = canvasAttrs(formato);
  const fmtOptions = listFormatos().map(f =>
    `<option value="${f.id}"${f.id === fmt.id ? ' selected' : ''}>${f.label}</option>`
  ).join('');
  const canvasInner = wrapCanvasInner(inner, formato);
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CybersecFEST — ${title}</title>
<link href="https://fonts.googleapis.com/css2?family=Ubuntu:wght@700&family=Montserrat:wght@300;400;600&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/dom-to-image-more@3.3.1/dist/dom-to-image-more.min.js"><\/script>
<style>${EDITOR_CSS}
${css ? `\n/* Layout ${layout} */\n${css}` : ''}
</style>
<style id="story-polish" media="not all">${storyPolishCss(layout)}</style>
<script>if(location.search.includes('embed'))document.documentElement.classList.add('embed');<\/script>
</head>
<body>
<div id="topbar">
  <a class="tb-back" href="${back}">← Galeria</a>
  <span class="tb-title">${title}</span>
  <select id="fmtSel" class="tb-fmt" title="Formato de exportação">${fmtOptions}</select>
  <button class="tb-save" id="btnSave">💾 Salvar</button>
  <button class="tb-export" id="btnExport">⬇ Exportar PNG</button>
  <span class="tb-badge">Layout ${layout} · v3.1</span>
</div>
<div id="main-area">
${PANEL_LEFT}
  <div id="ca">
    <div id="cw">
      <div class="cl">${(slug||'').startsWith('cast-')?'CybersecCAST':'CybersecFEST'} · Layout ${layout} — ${layoutN} · <span id="fmtLabel">${fmt.label}</span></div>
      <div class="art-canvas" id="the-canvas" data-formato="${fmt.id}" data-export-w="${fmt.exportW}" data-export-h="${fmt.exportH}" style="width:${fmt.width}px;height:${fmt.height}px">${canvasInner}</div>
      <div class="ci" id="fmtDims">${fmt.exportW} × ${fmt.exportH} px</div>
    </div>
  </div>
${PANEL_RIGHT}
</div>
${stateBlock}${metaBlock}<script>${editorV3Script(slug, { saveUrl, previewUrl })}<\/script>
</body>
</html>`;
}

function wrapWithEditor(simpleHtml, { layout, headline, slug, editorState: stateOverride = null, back: backOverride = null, formato = DEFAULT_FORMATO, palavrasAzuis = '', save = null, previewUrl = '' }) {
  const layoutN = LAYOUT_NAMES[layout] || layout;
  const title   = (headline || 'Arte CybersecFEST').replace(/"/g, '&quot;').slice(0, 80);
  const isTemplate = /^template-[a-q]$/i.test(String(slug || ''));
  const back    = backOverride
    || (isTemplate ? '../../index.html' : `../../index.html#arte=${slug}`);
  const editorState = stateOverride ?? extractEditorState(simpleHtml);

  const isV3Complete = simpleHtml.includes('id="topbar"') && simpleHtml.includes('ep-tag')
    && simpleHtml.includes('btnSave') && simpleHtml.includes('ttaseg')
    && simpleHtml.includes('id="ctaSection"')
    && /\/\* Layout [A-Q] \*\//.test(simpleHtml);

  if (isV3Complete) {
    return simpleHtml;
  }

  if (simpleHtml.includes('id="topbar"')) {
    const canvas = extractCanvasFromEditor(simpleHtml);
    const layoutCss = resolveLayoutCss(simpleHtml, layout);
    if (canvasLooksValid(canvas, layout)) {
      const inner = normalizeCanvas(canvas, layout);
      return buildEditorHtml({ inner, layoutCss, layout, layoutN, title, back, slug, editorState, formato, palavrasAzuis, saveUrl: save, previewUrl });
    }
    // Canvas corrompido — caller deve re-renderizar via renderLayout
    return null;
  }

  const inner     = annotateCanvas(extractCanvasInner(simpleHtml), layout);
  const layoutCss = resolveLayoutCss(simpleHtml, layout);
  return buildEditorHtml({ inner, layoutCss, layout, layoutN, title, back, slug, editorState, formato, palavrasAzuis, saveUrl: save, previewUrl });
}

module.exports = { wrapWithEditor, normalizeCanvas, buildEditorHtml, extractCanvasFromEditor, resolveLayoutCss, canvasLooksValid };
