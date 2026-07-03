// Inferência de tipo editorial a partir do briefing em texto livre.
// Substitui o select de tipo das galerias: o usuário descreve o que quer
// e o LLM classifica; briefing vazio = calendário decide (piloto automático).
'use strict';

async function inferirTipo(briefing, tipos, fallback) {
  const texto = String(briefing || '').trim();
  if (!texto || !Array.isArray(tipos) || tipos.length < 2) return fallback;

  try {
    const { generateText } = require('./llm.js');
    const resposta = await generateText(
      `Briefing: "${texto.slice(0, 400)}"\n\nClassifique este briefing em EXATAMENTE um dos tipos: ${tipos.join(', ')}.\nResponda APENAS com o tipo, nada mais.`,
      'Você é um classificador. Responda com uma única palavra da lista fornecida.',
      0,
      10
    );
    const limpo = String(resposta || '').toLowerCase().replace(/[^a-z_-]/g, '');
    const match = tipos.find(t => String(t).toLowerCase() === limpo);
    if (match) {
      console.log(`🏷️  Tipo inferido do briefing: ${match}`);
      return match;
    }
  } catch (e) {
    console.warn('⚠️  inferirTipo falhou — usando calendário:', e.message);
  }
  return fallback;
}

module.exports = { inferirTipo };
