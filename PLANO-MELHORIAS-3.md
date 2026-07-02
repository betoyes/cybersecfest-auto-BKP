# PLANO-MELHORIAS-3 — Bugs, riscos e melhorias detectados por análise de código

**Status:** ✅ Concluído em 01 jul 2026 (49 testes passando)

> **Notas de execução:**
> - Fase 5 **pulada** — o código já persiste `subtitle` sem `state` desde o Plano-2; o aviso proposto seria enganoso.
> - Fase 6 estendida: `handleCastSalvarArte` (routes/cast.js) exigia `state` e quebrava o toggle "Marcar publicada" do CAST — corrigido junto com o suporte a `publicar_em`. Job em `_scripts/utils/agendador.js` (roda no dev-server, 60s, invalida caches).
> - Extra: writes atômicos (temp + rename) em todos os bancos JSON via `_scripts/utils/atomic-write.js`.

**Pré-requisito:** Ler `CLAUDE.md` antes de executar. Servidor em `_scripts/` (`npm run dev`, porta 8765).  
**Testes:** `cd _scripts && npm test` — 46 testes devem passar antes e depois de cada fase.  
**Commit:** Um commit por fase ou um commit agregado ao final, a critério do executor.

---

## PROMPT DE KICKOFF (cole numa nova janela Claude Code)

```
Leia CLAUDE.md e PLANO-MELHORIAS-3.md e execute cada fase sequencialmente.
Antes de começar, rode: cd _scripts && npm test
Após cada fase, rode os testes novamente. Se falharem, corrija antes de continuar.
Ao finalizar todas as fases, faça commit com mensagem descritiva.
Não implemente nada além do especificado em cada fase.
```

---

## Fase 1 — `.gitignore`: excluir `.DS_Store` e dados operacionais

**Problema:** `.DS_Store` já foi comitado e aparece em todo `git status`. `propostas-cast.json` é dado operacional (não código).

**Arquivo:** `/.gitignore` (raiz do projeto)

**Adicionar ao final do arquivo existente:**
```
# macOS
.DS_Store
**/.DS_Store

# Dados operacionais (gerados em runtime, não devem ser versionados)
propostas-cast.json

# Ferramentas locais
.serena/
```

**Limpar do histórico (apenas os não-código):**
```bash
git rm --cached .DS_Store "artes/.DS_Store" "artes/blog-1782236441882/.DS_Store" "galeria-templates/.DS_Store" 2>/dev/null || true
git rm --cached propostas-cast.json 2>/dev/null || true
```

**Verificar:** `git status` não deve mais listar `.DS_Store` como arquivo.

---

## Fase 2 — `validateImageQuality`: validar também o resultado do retry

**Problema:** Em `_scripts/utils/client-router.js`, o retry chama `generateImage` mas não valida o resultado — se a segunda tentativa também for ruim, ela é retornada silenciosamente.

**Arquivo:** `_scripts/utils/client-router.js`

**Localizar o método `_gerarImagem` e substituir:**

```js
// ANTES:
let buf = await generateImage(prompt, opts);
const valid = await validateImageQuality(buf);
if (!valid.ok) {
  console.warn(`⚠️ Imagem rejeitada (${valid.motivo}) — retentando...`);
  buf = await generateImage(prompt, opts);
}
return buf;

// DEPOIS:
let buf = await generateImage(prompt, opts);
const valid = await validateImageQuality(buf);
if (!valid.ok) {
  console.warn(`⚠️ Imagem rejeitada (${valid.motivo}) — retentando...`);
  buf = await generateImage(prompt, opts);
  const valid2 = await validateImageQuality(buf);
  if (!valid2.ok) {
    console.warn(`⚠️ Retry também rejeitado (${valid2.motivo}) — usando mesmo assim`);
  }
}
return buf;
```

**Verificar:** `npm test` passa. Não há mudança de comportamento visível — apenas o log melhorado.

---

## Fase 3 — Rate limiting na geração de imagem

**Problema:** `POST /api/{slug}/arte/imagem/mudar` e `POST /api/{slug}/propostas/aprovar` chamam a API de imagem diretamente. Clique duplo ou script pode gerar 10 imagens em sequência e gastar créditos.

**Arquivo:** `_scripts/utils/client-router.js`

**Adicionar ao construtor de `ClientRouter` (após `this._embCache = null`):**
```js
this._imgLock = false;
```

**Localizar `handleMudarImagem` e adicionar no início do método (antes de qualquer lógica):**
```js
if (this._imgLock) {
  return json(res, 429, { ok: false, erro: 'Geração de imagem em andamento. Aguarde.' });
}
this._imgLock = true;
try {
```

**E no final do método (antes do último `return` ou `json()`):**
```js
} finally {
  this._imgLock = false;
}
```

**Fazer o mesmo para `handleAprovarProposta`** — mesmo padrão de lock/unlock com try/finally.

**Verificar:** `npm test` passa. Testar manualmente que dois cliques rápidos em "Gerar" retornam 429 no segundo.

---

## Fase 4 — Corrigir `marcarSimilares`: tipo inconsistente no embedding

**Problema:** Em `_scripts/utils/similaridade.js`, `getEmbeddingFn` é chamada com array para as artes (`getEmbeddingFn(arteTexts)`) mas com string para cada proposta (`getEmbeddingFn(pText)`). Se a função `getEmbedding` de `llm.js` retorna formatos diferentes para string vs array, a comparação cosine quebra silenciosamente.

**Verificar em `_scripts/utils/llm.js`** como `getEmbedding` se comporta:
- Se aceita tanto string quanto array e retorna consistentemente, não há bug
- Se só aceita array, a linha `await getEmbeddingFn(pText)` precisa virar `await getEmbeddingFn([pText])` com `.then(r => r[0])`

**Arquivo:** `_scripts/utils/similaridade.js`

**Substituir:**
```js
// ANTES:
let pEmb;
try { pEmb = await getEmbeddingFn(pText); }
catch { continue; }

// DEPOIS:
let pEmb;
try {
  const result = await getEmbeddingFn([pText]);
  pEmb = Array.isArray(result[0]) ? result[0] : result;
} catch { continue; }
```

**Verificar:** `npm test` passa. O comportamento de similaridade deve ser igual ou mais correto.

---

## Fase 5 — `handleSalvarArte`: subtitle não deve ser silenciosamente ignorado

**Problema:** Quando o frontend envia `{ slug, publicado: true, subtitle: "novo" }`, o `subtitle` é ignorado silenciosamente porque `hasState` é false. O log deve pelo menos avisar.

**Arquivo:** `_scripts/utils/client-router.js`

**Localizar em `handleSalvarArte` o bloco de validação e adicionar aviso:**
```js
// Localizar após: const hasPublicado = typeof payload?.publicado === 'boolean';
// Adicionar:
if (!hasState && payload?.subtitle !== undefined) {
  console.warn(`⚠️  handleSalvarArte [${this.slug}]: subtitle ignorado (sem state). Envie state completo para atualizar texto.`);
}
```

**Verificar:** `npm test` passa. Mudança é apenas um log de aviso.

---

## Fase 6 — Publicação agendada (`publicar_em`)

**Funcionalidade:** Permitir definir uma data futura para publicação. O `guardian-cast.js` (que já roda em background) verifica e publica automaticamente quando a data chega.

### 6a — Backend: aceitar `publicar_em` em `handleSalvarArte`

**Arquivo:** `_scripts/utils/client-router.js`

**Localizar o bloco `if (hasPublicado)` e expandir:**
```js
// ANTES:
if (hasPublicado) {
  artes[idx].publicado    = payload.publicado;
  artes[idx].publicado_em = payload.publicado ? new Date().toISOString() : null;
}

// DEPOIS:
if (hasPublicado) {
  artes[idx].publicado    = payload.publicado;
  artes[idx].publicado_em = payload.publicado ? new Date().toISOString() : null;
}
if (payload?.publicar_em !== undefined) {
  // aceita ISO string ou null para cancelar agendamento
  artes[idx].publicar_em = payload.publicar_em || null;
  if (payload.publicar_em) {
    console.log(`📅 Arte ${arteSlug} agendada para ${payload.publicar_em}`);
  }
}
```

### 6b — Background job: publicar quando data chegar

**Arquivo:** `_scripts/guardian-cast.js`

**Localizar o loop principal (onde o guardian verifica artes) e adicionar:**
```js
// Após carregar artes, antes de qualquer outro check:
const agora = new Date().toISOString();
const paraPublicar = artes.filter(a =>
  !a.publicado && a.publicar_em && a.publicar_em <= agora
);
for (const arte of paraPublicar) {
  arte.publicado    = true;
  arte.publicado_em = agora;
  arte.publicar_em  = null;
  console.log(`✅ Guardian: auto-publicou ${arte.slug}`);
}
if (paraPublicar.length > 0) writeArtes(artes);
```

> **Nota:** Se o guardian-cast.js não existir neste projeto, criar o arquivo `_scripts/utils/agendador.js` com a função `verificarAgendamentos(clientRouter)` exportada, e chamar no startup do dev-server.

### 6c — UI: campo de data no modal

**Arquivo:** `sunnysystems/index.html` e `cast/index.html`

**Localizar o botão "Marcar publicada" / toggle e adicionar abaixo:**
```html
<div id="modal-agendar-wrap" style="margin-top:6px;font-size:12px;color:var(--muted,#888);">
  Agendar: <input type="datetime-local" id="modal-publicar-em"
    style="background:transparent;border:1px solid #444;color:inherit;font-size:12px;padding:2px 4px;border-radius:4px;">
  <button onclick="salvarAgendamento()" style="font-size:11px;margin-left:4px;">Salvar</button>
</div>
```

**Adicionar função JS em cada galeria:**
```js
async function salvarAgendamento() {
  const val = document.getElementById('modal-publicar-em')?.value;
  // datetime-local retorna "2026-07-01T10:00", converter para ISO
  const iso = val ? new Date(val).toISOString() : null;
  const r = await fetch(`${API}/arte/salvar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug: modalSlug, publicar_em: iso }),
  }).then(r => r.json());
  if (r.ok) showStatus(iso ? `Agendado para ${new Date(iso).toLocaleString('pt-BR')}` : 'Agendamento cancelado');
}
```

**Verificar:** `npm test` passa. Testar manualmente: agendar para 1 minuto no futuro, aguardar o guardian publicar.

---

## Fase 7 — Busca global entre clientes

**Funcionalidade:** `GET /api/search?q=texto` busca em todos os `artes-*.json` simultaneamente e retorna resultados com `cliente`, `slug`, `headline`, `tipo`.

**Arquivo:** `_scripts/dev-server.js`

**Localizar onde as rotas são registradas (após `loadClients()`) e adicionar:**
```js
// Rota de busca global
if (req.method === 'GET' && urlPath === '/api/search') {
  const q = (new URL(req.url, 'http://localhost').searchParams.get('q') || '').toLowerCase().trim();
  if (!q || q.length < 2) return json(res, 400, { ok: false, erro: 'query muito curta' });

  const clientes = [
    { slug: 'cast',         banco: path.join(ROOT, 'artes-cast.json') },
    { slug: 'fest',         banco: path.join(ROOT, 'artes.json') },
    ...clients.map(c => ({ slug: c.slug, banco: path.join(ROOT, `artes-${c.slug}.json`) })),
  ];

  const resultados = [];
  for (const { slug, banco } of clientes) {
    if (!fs.existsSync(banco)) continue;
    try {
      const artes = JSON.parse(fs.readFileSync(banco, 'utf8'));
      for (const a of artes) {
        const texto = [(a.headline || ''), (a.subtitulo || ''), (a.tema || '')].join(' ').toLowerCase();
        if (texto.includes(q)) {
          resultados.push({ cliente: slug, slug: a.slug, headline: a.headline, subtitulo: a.subtitulo, tipo: a.tipo, thumb: a.thumb });
        }
      }
    } catch { /* banco corrompido ou ausente */ }
  }

  return json(res, 200, { ok: true, total: resultados.length, resultados });
}
```

**Verificar:** `curl "http://localhost:8765/api/search?q=segurança"` retorna JSON com resultados de múltiplos clientes.

---

## Checklist final

Antes de commitar, verificar:

- [ ] `npm test` — 46/46 passando
- [ ] `.DS_Store` não aparece em `git status`
- [ ] `propostas-cast.json` não aparece em `git status`
- [ ] Endpoint `/api/search?q=teste` responde com 200
- [ ] Clicar duas vezes em "Gerar imagem" retorna 429 no segundo clique
- [ ] Toggle publicar em arte existente ainda funciona (Fase 3 não quebrou o lock em fluxo normal)

---

## Referência de arquivos críticos

| Arquivo | O que contém |
|---------|-------------|
| `_scripts/utils/client-router.js` | `ClientRouter` — todos os handlers de cliente dinâmico |
| `_scripts/utils/similaridade.js` | `marcarSimilares` — detecção de conteúdo repetido |
| `_scripts/utils/llm.js` | `generateImage`, `validateImageQuality`, `getEmbedding` |
| `_scripts/dev-server.js` | Servidor HTTP + dispatch de rotas |
| `_scripts/guardian-cast.js` | Job de background (verificar antes de modificar) |
| `sunnysystems/index.html` | Galeria Sunny Systems (HTML/JS inline) |
| `cast/index.html` | Galeria CAST (HTML/JS inline) |
| `.gitignore` | Raiz do projeto |

Ver `CLAUDE.md` para gotchas técnicos antes de editar qualquer arquivo.
