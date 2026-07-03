// LLM helpers — OpenAI (texto) + Gemini Nano Banana (imagens)
'use strict';

const { OpenAI } = require('openai');
const { GoogleGenAI } = require('@google/genai');
const path = require('path');
const { getReferencePartsForGeneration, STYLE_REF_INSTRUCTION } = require('./reference-images.js');
const stats = require('./gen-stats.js');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY_CREAO });
const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY_CREAO });

const NANO_BANANA_MODELS = [
  'gemini-3.1-flash-image-preview',   // Nano Banana avançado — primário
  'gemini-2.5-flash-image',           // Nano Banana rápido — fallback
];

// ── Text generation — GPT-4o primário, Gemini fallback ────────────
async function generateText(prompt, systemPrompt = '', temperature = 0.85, maxTokens = null) {
  try {
    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });
    const opts = { model: 'gpt-4o', messages, temperature };
    if (maxTokens) opts.max_tokens = maxTokens;
    const res = await stats.medir('texto', 'gpt-4o',
      () => openai.chat.completions.create(opts),
      r => stats.custoTexto('gpt-4o', r.usage?.prompt_tokens, r.usage?.completion_tokens));
    return res.choices[0].message.content.trim();
  } catch (e) {
    console.warn('⚠️  OpenAI text falhou → Gemini Flash:', e.message);
    const geminiReq = {
      model: 'gemini-2.0-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    };
    if (systemPrompt) geminiReq.config = { systemInstruction: systemPrompt };
    const res = await stats.medir('texto', 'gemini-2.0-flash',
      () => gemini.models.generateContent(geminiReq),
      r => stats.custoTexto('gemini-2.0-flash', r.usageMetadata?.promptTokenCount, r.usageMetadata?.candidatesTokenCount));
    return (res.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
  }
}

// ── gpt-image-1 (ChatGPT Image — gerador principal CAST) ─────────
// gpt-image-2 testado e descartado: ~110s por imagem (muito lento)
async function generateImageGptImage1(prompt) {
  const res = await stats.medir('imagem', 'gpt-image-1', () => openai.images.generate({
    model: 'gpt-image-1',
    prompt,
    n: 1,
    size: '1024x1536',   // portrait 2:3 — o mais próximo de 3:4
    quality: 'high',
  }));

  const b64 = res.data?.[0]?.b64_json;
  if (b64) {
    console.log('🖼️  Imagem gerada via gpt-image-1 (ChatGPT Image)');
    return Buffer.from(b64, 'base64');
  }

  // Fallback para URL
  const url = res.data?.[0]?.url;
  if (url) {
    const imgRes = await fetch(url);
    if (!imgRes.ok) throw new Error(`download gpt-image-1: ${imgRes.status}`);
    console.log('🖼️  Imagem gerada via gpt-image-1 (URL)');
    return Buffer.from(await imgRes.arrayBuffer());
  }

  throw new Error('gpt-image-1 sem dados de imagem na resposta');
}

// Variação controlada: seed explícito para composições consistentes — retorna { buffer, seed }
async function generateImageGptImage1WithSeed(prompt, seedIn = null) {
  const seed = (Number.isInteger(seedIn) && seedIn > 0) ? seedIn : Math.floor(Math.random() * 2147483647);
  const res = await stats.medir('imagem', 'gpt-image-1', () => openai.images.generate({
    model: 'gpt-image-1',
    prompt,
    n: 1,
    size: '1024x1536',
    quality: 'high',
    seed,
  }));

  const b64 = res.data?.[0]?.b64_json;
  if (b64) {
    console.log(`🖼️  Imagem gerada via gpt-image-1 (seed ${seed})`);
    return { buffer: Buffer.from(b64, 'base64'), seed };
  }

  const url = res.data?.[0]?.url;
  if (url) {
    const imgRes = await fetch(url);
    if (!imgRes.ok) throw new Error(`download gpt-image-1: ${imgRes.status}`);
    console.log(`🖼️  Imagem gerada via gpt-image-1 URL (seed ${seed})`);
    return { buffer: Buffer.from(await imgRes.arrayBuffer()), seed };
  }

  throw new Error('gpt-image-1 sem dados de imagem na resposta');
}

function extractImageBuffer(response) {
  const parts = response?.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    const data = part.inlineData?.data || part.inline_data?.data;
    if (data) return Buffer.from(data, 'base64');
  }
  return null;
}

// ── Imagem via Gemini Nano Banana (SDK @google/genai) ─────────────
async function generateImageNanoBanana(prompt, { referenceParts = [], styleInstruction = null } = {}) {
  let lastError = null;

  const instruction = styleInstruction || (referenceParts.length ? STYLE_REF_INSTRUCTION : null);

  const parts = [
    ...referenceParts,
    { text: instruction ? `${instruction}\n\n${prompt}` : prompt },
  ];

  const contents = referenceParts.length
    ? [{ role: 'user', parts }]
    : prompt;

  for (const model of NANO_BANANA_MODELS) {
    try {
      const response = await stats.medir('imagem', model, async () => {
        const r = await gemini.models.generateContent({
          model,
          contents,
          config: {
            responseModalities: ['TEXT', 'IMAGE'],
            imageConfig: { aspectRatio: '3:4' },
          },
        });
        if (!(extractImageBuffer(r)?.length > 100)) throw new Error('resposta sem inlineData de imagem');
        return r;
      });

      const buffer = extractImageBuffer(response);
      if (buffer?.length > 100) {
        const refNote = referenceParts.length ? ` + ${referenceParts.length} ref(s)` : '';
        console.log(`🖼️  Imagem gerada via ${model}${refNote}`);
        return buffer;
      }
      throw new Error('resposta sem inlineData de imagem');
    } catch (e) {
      lastError = e;
      console.warn(`⚠️  ${model} falhou:`, e.message);
    }
  }

  throw lastError || new Error('Nano Banana indisponível');
}

// ── Fallback: DALL-E 3 ─────────────────────────────────────────────
async function generateImageDalle(prompt) {
  const res = await stats.medir('imagem', 'dall-e-3', () => openai.images.generate({
    model: 'dall-e-3',
    prompt,
    n: 1,
    size: '1024x1792',
  }));

  const url = res.data?.[0]?.url;
  if (!url) throw new Error('DALL-E 3 sem URL');

  const imgRes = await fetch(url);
  if (!imgRes.ok) throw new Error(`download DALL-E: ${imgRes.status}`);

  console.log('🖼️  Imagem gerada via DALL-E 3');
  return Buffer.from(await imgRes.arrayBuffer());
}

/**
 * Geração de imagem — cadeia: gpt-image-1 → Gemini Nano Banana → DALL-E 3
 *
 * @param {string} prompt
 * @param {object} opts
 * @param {string}  [opts.tipo]
 * @param {string}  [opts.layout]
 * @param {boolean} [opts.useReferences=true]   — se true, injeta referências FEST (ignorado se _referenceParts)
 * @param {string}  [opts.contextoVisual]
 * @param {string}  [opts.cidade]
 * @param {Array}   [opts._referenceParts]       — referências injetadas externamente (ex: CAST)
 * @param {string}  [opts._styleInstruction]     — instrução de estilo custom (substitui STYLE_REF_INSTRUCTION FEST)
 * @param {boolean} [opts.useGptImage=false]     — força gpt-image-1 como primário
 */
async function generateImage(prompt, {
  tipo, layout, useReferences = true, contextoVisual = '', cidade = '',
  _referenceParts = null, _styleInstruction = null, useGptImage = false,
} = {}) {
  let referenceParts = [];
  let refPaths = [];

  if (_referenceParts) {
    referenceParts = _referenceParts;
  } else if (useReferences) {
    const refs = getReferencePartsForGeneration({ tipo, layout, max: 3, contextoVisual, cidade });
    referenceParts = refs.parts;
    refPaths = refs.paths;
    if (refPaths.length) {
      console.log(`   📎 Style refs: ${refPaths.map(p => path.basename(p)).join(', ')}`);
    }
  }

  // gpt-image-1 como primário quando solicitado
  if (useGptImage) {
    try {
      return await generateImageGptImage1(prompt);
    } catch (e) {
      console.warn('⚠️  gpt-image-1 falhou → Gemini:', e.message);
    }
  }

  let geminiError;
  try {
    return await generateImageNanoBanana(prompt, {
      referenceParts,
      styleInstruction: _styleInstruction,
    });
  } catch (e) {
    geminiError = e;
    console.warn('⚠️  Nano Banana falhou → gpt-image-1:', e.message);
  }

  // Tenta gpt-image-1 como segundo fallback antes do DALL-E
  try {
    return await generateImageGptImage1(prompt);
  } catch (e) {
    console.warn('⚠️  gpt-image-1 falhou → DALL-E 3:', e.message);
  }

  try {
    return await generateImageDalle(prompt);
  } catch (e) {
    const msg = `Gemini: ${geminiError?.message || '?'} | gpt-image-1: falhou | DALL-E: ${e.message}`;
    console.error('❌ Todos os geradores de imagem falharam:', msg);
    throw new Error(msg);
  }
}

// Embedding para detecção de similaridade (text-embedding-3-small, barato)
// Aceita string ou string[] — retorna float[] ou float[][]
async function getEmbedding(input) {
  const res = await openai.embeddings.create({ model: 'text-embedding-3-small', input });
  if (Array.isArray(input)) return res.data.map(d => d.embedding);
  return res.data[0].embedding;
}

// Crop inteligente — detecta posição do sujeito na imagem via gpt-4o-mini vision
// Retorna 'left' | 'center' | 'right' | 'abstract'
async function detectSubjectPosition(imgBuffer) {
  const b64 = imgBuffer.toString('base64');
  const res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 10,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}`, detail: 'low' } },
        { type: 'text', text: 'Where is the main subject? Reply with exactly one word: left, center, right, or abstract.' },
      ],
    }],
  });
  const answer = (res.choices[0]?.message?.content || '').trim().toLowerCase();
  return ['left', 'center', 'right', 'abstract'].includes(answer) ? answer : 'abstract';
}

async function validateImageQuality(imgBuffer) {
  if (!imgBuffer || imgBuffer.length < 50_000) {
    return { ok: false, motivo: 'imagem muito pequena (possível falha de geração)' };
  }
  return { ok: true };
}

module.exports = { generateText, generateImage, generateImageGptImage1, generateImageGptImage1WithSeed, getEmbedding, detectSubjectPosition, validateImageQuality };
