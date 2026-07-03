// Export Stories (1080×1920) — captura o #the-canvas do arte.html dinâmico.
//
// Dois modos:
//  - stretch (padrão): canvas vira 540×960 e o layout REDIAGRAMA — funciona
//    porque os layouts full-bleed (C/E/M/N/A...) usam containers inset:0 com
//    flex space-between e bg object-fit:cover. LAYOUT_POLISH refina cada um.
//  - frame: arte 4:5 intacta centralizada com o fundo desfocado nas bordas.
//    Fallback para layouts de posição fixa que não reflow (via FRAME_LAYOUTS
//    ou query ?modo=frame).
'use strict';

const { launchBrowser } = require('./puppeteer-browser.js');

// O editor-wrap serve o canvas como #the-canvas com tamanho inline, e dentro
// dele um .art-canvas-inner também com 540×675 inline — ambos precisam do
// override com !important para o layout reflow até 960.
const STRETCH_BASE =
  '#the-canvas,#the-canvas .art-canvas-inner{width:540px !important;height:960px !important;}';

// Refinos por layout no modo stretch (respiro vertical, headline maior).
const LAYOUT_POLISH = {
  A: '.img-band{height:58%;}.text-band{height:45%;}',
  C: '.art-cnt-c{padding:70px 30px 56px 34px;}.headline-c{font-size:34px;max-width:62%;}.sub-c{font-size:13px;}',
  E: '.art-content-e{padding:70px 30px 56px 34px;}.center-e{max-width:64%;}.subtitle-e{max-width:280px;}',
  M: '.art-cnt-m{padding:70px 30px 56px 34px;}.hl-m{font-size:30px;max-width:340px;}.sb-m{font-size:13px;max-width:300px;}',
  N: '.cnt-l2{padding:70px 30px 56px 34px;}',
};

// Layouts que ficam melhores emoldurados (posições fixas que não reflow).
const FRAME_LAYOUTS = new Set([]);

async function gerarStoryPng(arteUrl, outPath, { layout = '', modo = null } = {}) {
  const modoFinal = modo || (FRAME_LAYOUTS.has(String(layout).toUpperCase()) ? 'frame' : 'stretch');
  const url = arteUrl.includes('?') ? arteUrl : arteUrl + '?embed';
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 620, height: 1080, deviceScaleFactor: 2 });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForSelector('#the-canvas', { timeout: 15000 });
    await page.evaluate(() => Promise.all(
      [...document.images].map(img =>
        img.complete ? Promise.resolve() : new Promise(r => { img.onload = r; img.onerror = r; })
      )
    ));
    await page.evaluate(() => document.fonts.ready);

    let alvo = '#the-canvas';
    if (modoFinal === 'stretch') {
      await page.addStyleTag({
        content: STRETCH_BASE + (LAYOUT_POLISH[String(layout).toUpperCase()] || ''),
      });
    } else {
      alvo = '#story-frame';
      await page.evaluate(() => {
        const c = document.querySelector('#the-canvas');
        const frame = document.createElement('div');
        frame.id = 'story-frame';
        frame.style.cssText =
          'width:540px;height:960px;position:relative;overflow:hidden;' +
          `background:${getComputedStyle(c).backgroundColor || '#02050A'};`;
        c.parentNode.insertBefore(frame, c);

        const bg = c.querySelector('img');
        if (bg && bg.src) {
          const blur = bg.cloneNode();
          blur.style.cssText =
            'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;' +
            'filter:blur(38px) brightness(0.45);transform:scale(1.25);';
          frame.appendChild(blur);
        }

        frame.appendChild(c);
        c.style.position = 'absolute';
        c.style.top = '50%';
        c.style.left = '50%';
        c.style.transform = 'translate(-50%,-50%)';
        c.style.boxShadow = '0 0 60px rgba(0,0,0,0.55)';
      });
    }
    await new Promise(r => setTimeout(r, 800));

    const el = await page.$(alvo);
    if (!el) throw new Error(`${alvo} não encontrado`);

    await el.screenshot({ path: outPath, type: 'png' });
  } finally {
    await browser.close();
  }
}

module.exports = { gerarStoryPng, LAYOUT_POLISH, FRAME_LAYOUTS };
