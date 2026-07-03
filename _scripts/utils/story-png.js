// Export Stories (1080×1920) — captura o #the-canvas do arte.html dinâmico
// com CSS override 9:16 injetado no Puppeteer. Não altera nada em disco além
// do PNG de saída; a mesma arte/state serve feed e story.
'use strict';

const { launchBrowser } = require('./puppeteer-browser.js');

// Override genérico 9:16. Refinos por layout entram aqui conforme necessidade
// (usar seletores específicos como .canvas .text-band, etc.).
async function gerarStoryPng(arteUrl, outPath) {
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

    // Monta o quadro 9:16: arte 4:5 intacta centralizada, bordas preenchidas
    // com o fundo da própria arte desfocado (fallback: cor de fundo do canvas).
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
    await new Promise(r => setTimeout(r, 800));

    const frame = await page.$('#story-frame');
    if (!frame) throw new Error('#story-frame não montado');

    await frame.screenshot({ path: outPath, type: 'png' });
  } finally {
    await browser.close();
  }
}

module.exports = { gerarStoryPng };
