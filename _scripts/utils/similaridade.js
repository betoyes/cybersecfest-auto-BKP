'use strict';

const THRESHOLD = 0.92;

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function arteText(arte) {
  return [(arte.headline || ''), (arte.subtitulo || '')]
    .join(' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Checar similaridade de propostas contra artes aprovadas recentes.
 * Adiciona `similar_a: slug` na proposta se acima do threshold.
 * Nunca lança erro — falhas de API são silenciosas (feature opcional).
 */
async function marcarSimilares(propostas, artes, getEmbeddingFn, arteEmbeddingsPrecomputed) {
  if (!Array.isArray(artes) || !artes.length) return propostas;

  const arteTexts = artes.map(arteText).filter(t => t.length > 0);
  if (!arteTexts.length) return propostas;

  let arteEmbeddings;
  if (arteEmbeddingsPrecomputed) {
    arteEmbeddings = arteEmbeddingsPrecomputed;
  } else {
    try {
      arteEmbeddings = await getEmbeddingFn(arteTexts);
    } catch (e) {
      console.warn('⚠️  Similaridade: falha nos embeddings de artes:', e.message);
      return propostas;
    }
  }

  for (const p of propostas) {
    const pText = [(p.headline || ''), (p.subtitulo || '')]
      .join(' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!pText) continue;

    let pEmb;
    try {
      const result = await getEmbeddingFn([pText]);
      pEmb = Array.isArray(result[0]) ? result[0] : result;
    } catch { continue; }

    for (let i = 0; i < arteEmbeddings.length; i++) {
      const sim = cosineSimilarity(pEmb, arteEmbeddings[i]);
      if (sim >= THRESHOLD) {
        p.similar_a = artes[i].slug;
        console.log(`   ⚠️  "${p.angulo}" similar a ${artes[i].slug} (${sim.toFixed(3)})`);
        break;
      }
    }
  }

  return propostas;
}

module.exports = { cosineSimilarity, marcarSimilares };
