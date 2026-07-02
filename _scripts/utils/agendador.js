// Agendador de publicação — verifica `publicar_em` em todos os bancos de artes
// e publica automaticamente quando a data chega. Roda no dev-server via setInterval.
'use strict';

const fs   = require('fs');
const path = require('path');
const { atomicWriteFileSync } = require('./atomic-write.js');

const ROOT = path.join(__dirname, '..', '..');
const INTERVALO_MS = 60_000;

function bancosDisponiveis() {
  const fixos = ['artes.json', 'artes-cast.json'];
  let dinamicos = [];
  try {
    const clients = JSON.parse(fs.readFileSync(path.join(ROOT, '_clients.json'), 'utf8'));
    dinamicos = clients.filter(c => c.ativo).map(c => `artes-${c.slug}.json`);
  } catch { /* sem clientes dinâmicos */ }
  return [...fixos, ...dinamicos]
    .map(f => path.join(ROOT, f))
    .filter(f => fs.existsSync(f));
}

// Publica artes agendadas cuja data já passou. Retorna quantas publicou.
// bancos: lista de paths opcional (default: todos os bancos do projeto).
function verificarAgendamentos(bancos = bancosDisponiveis()) {
  const agora = new Date().toISOString();
  let publicadas = 0;

  for (const banco of bancos) {
    let artes;
    try { artes = JSON.parse(fs.readFileSync(banco, 'utf8')); } catch { continue; }
    if (!Array.isArray(artes)) continue;

    const paraPublicar = artes.filter(a => !a.publicado && a.publicar_em && a.publicar_em <= agora);
    if (!paraPublicar.length) continue;

    for (const arte of paraPublicar) {
      arte.publicado    = true;
      arte.publicado_em = agora;
      arte.publicar_em  = null;
      console.log(`✅ Agendador: auto-publicou ${arte.slug} (${path.basename(banco)})`);
      publicadas++;
    }
    atomicWriteFileSync(banco, JSON.stringify(artes, null, 2) + '\n');
  }

  return publicadas;
}

// onChange: chamado quando alguma arte foi publicada (ex.: invalidar caches do servidor)
function iniciarAgendador(onChange = null) {
  const timer = setInterval(() => {
    try {
      const publicadas = verificarAgendamentos();
      if (publicadas > 0 && typeof onChange === 'function') onChange();
    } catch (e) { console.warn('⚠️  Agendador:', e.message); }
  }, INTERVALO_MS);
  timer.unref();
  return timer;
}

module.exports = { verificarAgendamentos, iniciarAgendador, INTERVALO_MS };
