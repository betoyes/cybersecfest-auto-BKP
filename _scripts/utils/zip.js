'use strict';

// Compat archiver v7 (factory: archiver('zip', opts)) e v8 (classes: new ZipArchive(opts)).
// Sem isso, archiver v8 lança "archiver is not a function" DEPOIS dos headers HTTP
// enviados e a resposta nunca termina (download de zip trava para sempre).
function criarZipStream(nivel = 6) {
  const mod = require('archiver');
  if (typeof mod === 'function') return mod('zip', { zlib: { level: nivel } });
  if (mod.ZipArchive) return new mod.ZipArchive({ zlib: { level: nivel } });
  throw new Error('archiver: formato de export desconhecido');
}

module.exports = { criarZipStream };
