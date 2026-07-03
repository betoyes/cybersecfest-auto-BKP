# CLAUDE.md — Guia rápido para Claude Code

## Quando ler o HANDOFF.md

Leia `HANDOFF.md` antes de começar se a tarefa envolver:
- Motion System (animações GSAP, HyperFrames, render MP4)
- Protocolo multi-agente (SuperAgent, AnimAgent, ownership de arquivos)
- Deploy / Vercel / repo público
- Estrutura de `img-versoes/` ou versões legado `dir: "."`

Caso contrário, este arquivo é suficiente.

## Servidor local

```bash
cd _scripts && npm run dev   # porta 8765 — nodemon: reinicia automaticamente ao salvar .js
```

**Atenção:** Se rodar `node dev-server.js` diretamente (sem nodemon), edições em `.js` exigem restart manual. Verificar PID: `lsof -i :8765`.

---

## Arquitetura — Studio + três produtos, um repo

```
/                →  home.html (Studio)       →  seleção de produto
/fest/           →  fest/index.html          →  galeria FEST
/cast/           →  cast/index.html          →  galeria CAST
/sunnysystems/   →  sunnysystems/index.html  →  galeria Sunny Systems
/artes/{slug}/   →  arte.html (estático)     →  editor FEST
/artes/cast-*/   →  arte.html (dinâmico)     →  editor CAST
/artes/sunny-*/  →  arte.html (dinâmico)     →  editor Sunny Systems
```

```
CybersecFEST   →  artes.json          →  fest/index.html          →  /artes/{slug}/
CybersecCAST   →  artes-cast.json     →  cast/index.html          →  /artes/cast-{slug}/
Sunny Systems  →  artes-sunny.json    →  sunnysystems/index.html  →  /artes/sunny-{slug}/
```

FEST e CAST têm rotas hardcoded em `dev-server.js`. Clientes dinâmicos (Sunny Systems e futuros) usam `_clients.json` + `client-router.js`.

> **Importante:** `fest/index.html` usa apenas paths absolutos (prefixo `/`). Nunca use paths relativos nesse arquivo — ele está em `/fest/` e não na raiz.

---

## Arquivos críticos

| Arquivo | Função |
|---------|--------|
| `_scripts/dev-server.js` | Servidor HTTP + rotas FEST + dispatch (~710 linhas) |
| `_scripts/routes/cast.js` | Todos os handlers CAST (factory `setupCastRoutes`) |
| `_scripts/routes/motion.js` | Todos os handlers Motion (factory `setupMotionRoutes`) |
| `_scripts/utils/img-versoes.js` | Lê/escreve histórico de versões de imagem (`img-versoes/`) |
| `_scripts/utils/layouts.js` | HTML de cada layout A–Q |
| `_scripts/utils/editor-wrap.js` | Wrapper do editor visual (painéis + CSS) |
| `_scripts/utils/editor-v3-script.js` | JS do editor (sliders, save, export PNG) |
| `_scripts/utils/brand-renderer.js` | Aplica tokens de marca sobre o HTML do layout |
| `_scripts/utils/llm.js` | Gemini (imagens) + GPT-4o (texto) |
| `_scripts/utils/client-router.js` | Handler genérico para clientes dinâmicos (pedido → propostas → aprovar → arte) |
| `_clients.json` | Lista de clientes dinâmicos carregada no startup do servidor |
| `_brands/cyberseccast/brand.js` | Tokens de cor/fonte/logo do CAST |
| `_brands/cyberseccast/imagem-prompt.js` | Prompts CAST + `detectPerson()` + `CAST_STYLE_REF_INSTRUCTION` |
| `_brands/sunnysystems/brand.js` | Tokens Sunny Systems — âmbar `#FBB414`, Space Grotesk/Inter, fundo `#0f0f0f` |
| `_brands/sunnysystems/imagem-prompt.js` | Prompts Sunny — `TEMA_SCENE` por pilar + `buildImagemPrompt` contextual |
| `_agents/sunnysystems-estrategista/knowledge.js` | Conhecimento da Sunny Systems (produtos, pilares, teses) |
| `_agents/sunnysystems-estrategista/system-prompt.js` | System prompts por pilar editorial + `getSystemPrompt(tipo)` |
| `artes-cast.json` | Banco de artes CAST (append-only) |
| `artes-sunny.json` | Banco de artes Sunny Systems (append-only) |
| `artes.json` | Banco de artes FEST (append-only, dono: SuperAgent) |
| `_scripts/utils/agendador.js` | Publicação agendada — verifica `publicar_em` nos bancos a cada 60s (roda no dev-server) |
| `_scripts/utils/atomic-write.js` | `atomicWriteFileSync` — escrita temp+rename para bancos JSON (usar em todo write de banco) |
| `assets/logo-sunny.png` | Logo Sunny Systems — versão branca (sol âmbar + texto branco) para fundo escuro |

---

## Pipeline CAST — modo híbrido

**Local (dev-server):** `arte.html` é renderizado dinamicamente a cada GET:
```
GET /artes/cast-*/arte.html
  → handleCastArteHtmlDynamic
  → buildArteHtmlCast (fundo.png + artes-cast.json + state.json)
  → renderLayoutForBrand + wrapWithEditor
  → HTML fresco (mudanças de código refletem sem regenerar)
```

**Produção (GitHub Pages):** `POST /api/cast/exportar` gera arte.html estático para todos os slugs.

**Estado do editor:**
- Salvo em `artes/{slug}/state.json` (separado do arte.html)
- `POST /api/cast/arte/salvar` → salva state.json + subtitle em artes-cast.json + regenera thumb

---

## Editor visual

- `wrapWithEditor(simpleHtml, opts)` — detecta se é HTML simples ou já v3-completo
- `isV3Complete` — se true, retorna o HTML inalterado (cuidado: HTML antigo em disco pode estar completo)
- `editorV3Script(slug)` — gera o JS do editor como string de template
- Save URL: CAST usa `/api/cast/arte/salvar`, FEST usa `/api/arte/salvar`
- Export PNG: usa `dom-to-image-more` com `style.transform: scale(N)` para 2x (1080×1350 de 540×675)

---

## Geração de imagens

Cadeia (ordem de tentativa):
```
Gemini gemini-3.1-flash-image-preview → gemini-2.5-flash-image → gpt-image-1 → DALL-E 3
```

CAST: usa `CAST_STYLE_REF_INSTRUCTION` via parâmetro `_styleInstruction` (não misturar com FEST cyan).  
Sem pessoas por padrão — `detectPerson()` ativa cenas com pessoa apenas se nome/convidado for mencionado.

---

## Gotchas técnicos

1. **`renderLayoutForBrand(slug, arte, brand)`** — 1º arg é slug (ignorado internamente). O layout vem de `arte.layout`, não do slug.

2. **`moveCastLogoToLeft(html)`** — substitui string CSS exata de `layouts.js`. Se o CSS mudar, essa função para de funcionar.

3. **`isV3Complete` em `wrapWithEditor`** — se o `arte.html` no disco já foi gerado com o editor, wrapWithEditor retorna ele intacto. No modo híbrido isso não acontece (simpleHtml vem de renderLayoutForBrand que é sempre simples). Mas em testes diretos com arquivo do disco pode enganar.

4. **Módulos Node.js em cache** — `npm run dev` usa nodemon (auto-restart). Se rodar sem nodemon, editar `.js` sem restart = código antigo. Verificar: `lsof -i :8765` (PID) e `ps -p PID -o lstart` (hora de início).

5. **`subtitle` e `headline` com `<br>`** — subtítulo e título podem conter `<br>` para quebra de linha. O editor serializa como innerHTML e restaura na textarea como `\n`. O `layouts.js` renderiza `${sub}` e `${hl}` diretamente (sem escape), então HTML funciona.

6. **Export PNG espaço preto** — `domtoimage.toPng(el, {width, height})` NÃO faz scale automático. Usar `style: { transform: 'scale(N)', transformOrigin: 'top left' }` onde `N = exportW / el.offsetWidth`.

7. **Badge LAYOUT A** — removido do `normalizeCanvas` (só existe o CSS rule agora). Se aparecer de novo, verificar se o server está com o código antigo em cache.

8. **Ghost text em motion** — usar `fundo-raw.png` (foto sem texto). `thumb.png` tem texto baked. `motion-gerador.js` já prioriza fundo-raw > fundo > thumb.

9. **`artes-cast.json` e `writeArtesCast()`** — cache de 10s em `routes/cast.js` (`castArtesCache`). Após write, cache atualizado imediatamente. `invalidateArtesCast()` força releitura.

10. **Back URL no editor CAST** — `wrapWithEditor` recebe `back: '../../cast/'` via `buildArteHtmlCast`. Sem isso aponta para a galeria FEST.

11. **Back URL no editor FEST** — `wrapWithEditor` recebe `back: '/fest/'` em `handleFestReaplicar`. O path `/fest/` é absoluto porque a galeria FEST está em `/fest/`, não na raiz.

12. **Layout CSS perdido em `handleFestReaplicar`** — `wrapWithEditor` precisa receber `layout: arte.layout` para que `resolveLayoutCss` injete o CSS correto. Sem ele, classes como `.art-content-e`, `.art-bg-e`, `.center-e` ficam sem CSS → conteúdo invisível nos thumbnails. Correção em `dev-server.js`: `wrapWithEditor(simpleHtml, { slug, layout: arte.layout, save: '...', back: '/fest/' })`.

13. **`resolveLayoutCss` não reconhece layouts com sufixo `-e`** — a função checa `/\.(hl|ct|bc|bb|lc)\{/` para validar CSS extraída do HTML, mas layouts novos usam `.headline-e{`, `.center-e{`. O fallback correto é `getLayoutCss(layout)`, que só funciona se `layout` for passado (ver gotcha 12).

14. **`gerarThumbComposto` suporta URL HTTP** — aceita `http://localhost:8765/...` além de paths de arquivo. Em `handleFestReaplicar`, passar a URL do servidor (`http://localhost:8765/artes/${slug}/arte.html`) garante que o HTML completo (com CSS de layout já injetado) seja renderizado corretamente pelo Puppeteer.

15. **Título editável no editor** — painel direito seção TÍTULO tem `hlEdit` (textarea, texto + `\n`→`<br>`) e `hlBlue` (input, palavras azuis separadas por espaço/vírgula). Cor de destaque: FEST `#14A8F4`, CAST `#6366f1` (variável `ACCENT` em `editor-v3-script.js`). O save envia `headline`/`palavras_azuis`/`subtitle` e todos os backends persistem no banco (FEST em `handleSalvarArte` do dev-server; CAST em `handleCastSalvarArte`; dinâmicos no `client-router`).

16. **FEST `arte.html` agora é dinâmico** — `handleFestArteHtmlDynamic` em `routes/cast.js` intercepta `GET /artes/(evento|blog|patrocinador|palestrante)-*/arte.html` antes do `serveStatic`. Mudanças em `editor-wrap.js` ou `editor-v3-script.js` refletem automaticamente, igual ao CAST. Artes sem `fundo.png` (legado) ainda servem o arquivo estático em disco.

17. **Multi-cliente dinâmico** — novos clientes são onboardados via `node _scripts/onboarding-cliente.js --briefing briefing.json`. Isso gera `_brands/{slug}/`, `_agents/{slug}-estrategista/`, galeria `{slug}/index.html`, banco `artes-{slug}.json` e registra em `_clients.json`. O `dev-server.js` carrega `_clients.json` no startup via `loadClients()` e despacha todas as rotas do cliente automaticamente via `dispatchClient()` (`_scripts/utils/client-router.js`). Para adicionar um cliente: rodar onboarding → reiniciar servidor.

18. **`brand.js` de clientes dinâmicos usa formato flat** — exporta as propriedades diretamente (`module.exports = { id, name, colors, fonts, ... }`), sem wrapper `{ brand: {...} }`. O `ClientRouter` detecta isso com `brandMod.id && brandMod.colors ? brandMod : null`. Se o brand não carregar, as artes renderizam com a identidade do FEST.

19. **`logo-sunny.png` precisa estar em `assets/`** — `assetDataUri()` em `embed-assets.js` busca assets relativos à raiz do projeto (`assets/`). Logos de clientes devem ser copiados para lá, não mantidos só em `_brands/{slug}/` ou em `Cybersec.CAST-Website/`.

20. **`getSystemPromptFn` por cliente** — carregado no construtor de `ClientRouter` via `require('_agents/{slug}-estrategista/system-prompt.js')`. Deve exportar `getSystemPrompt(tipo)` que recebe o pilar editorial e retorna o system prompt correto. Se o módulo não exportar essa função, `this.getSystemPromptFn = null` e `/api/{slug}/pedido` retorna 400.

21. **Contaminação de marca no Gemini** — quando OpenAI falha, o fallback para Gemini 2.0 Flash usa `config: { systemInstruction: systemPrompt }` (não concatenação). Se isso não for respeitado, o Gemini gera conteúdo de outra marca (ex: "CYBERSEC.CAST" em posts da Sunny Systems) por associação do treino. O `system-prompt.js` de cada cliente deve ter bloco explícito "EMPRESA EXCLUSIVA: NUNCA mencione [outras marcas]".

22. **`const API` no HTML de galeria de clientes** — cada galeria (`sunnysystems/index.html`, etc.) tem `const API = '/api/{slug}'`. Se clonada do CAST sem trocar esse valor, todos os pedidos vão para `/api/cast` e o conteúdo gerado é do CAST, não do cliente.

23. **Imagem gerada sem contexto** — `buildImagemPrompt` recebe `contexto_visual` (campo do usuário), `cena_visual` (gerada pelo LLM na proposta) e `headline`/`subtitulo`/`tipo`. Prioridade: `instrucao` > `contexto_visual` > `cena_visual` > metáfora derivada de `headline + tema` > `TEMA_SCENE[tipo]`. Em `handleAprovarProposta`, `contexto_visual` deve incluir `proposta.cena_visual` como fallback.

24. **`_gerarImagem` deve receber o objeto `arte` completo** — assinatura: `_gerarImagem(arte, instrucao)`. O objeto `arte` deve ter `tipo`, `layout`, `headline`, `subtitulo`, `contexto_visual`, `tema` para que `buildImagemPrompt` consiga montar cena contextual. Nunca chamar com `(contextoVisual, tipo, headline)` como args posicionais separados.

---

## Rotas Sunny Systems (client-router genérico)

```
POST /api/sunnysystems/pedido                → gera 3 propostas via LLM (system prompt do agente estrategista)
GET  /api/sunnysystems/propostas             → retorna lote pendente em memória (this._lote)
POST /api/sunnysystems/propostas/aprovar     → aprova proposta → gera imagem → cria arte
POST /api/sunnysystems/propostas/rejeitar    → descarta lote pendente
POST /api/sunnysystems/arte/imagem/mudar     → nova imagem para arte existente
POST /api/sunnysystems/arte/deletar          → deleta arte
GET  /sunnysystems/                          → galeria (Cache-Control: no-store)
GET  /artes/sunny-*/arte.html               → editor dinâmico
```

Mesmo padrão se aplica a qualquer cliente em `_clients.json` substituindo `sunnysystems` pelo slug.

---

## Rotas globais

```
GET  /api/search?q=texto                 → busca em todos os bancos artes-*.json (cliente, slug, headline, tipo, thumb)
GET  /api/calendario                     → todas as artes de todos os clientes (datas, estado publicação) — alimenta /calendario/
POST /api/clientes/criar                 → onboarding via UI: briefing JSON → spawn onboarding-cliente.js (lock global, timeout 5min)
GET  /calendario/                        → calendário editorial mensal multi-cliente (chips por marca, estados ●◔○)
GET  /api/story.png?slug={slug}          → export Story 1080×1920 de qualquer cliente (botão "↓ Story" nas galerias)
```

**Story (9:16):** `utils/story-png.js` tem dois modos. **stretch (padrão)** rediagrama de verdade: estica `#the-canvas` E `.art-canvas-inner` (ambos têm 540×675 inline — os dois precisam do override `!important`) para 540×960; os layouts full-bleed (containers `inset:0` + flex `space-between` + bg `object-fit:cover`) redistribuem sozinhos, com refino por layout em `LAYOUT_POLISH`. **frame** (fallback via `?modo=frame` ou `FRAME_LAYOUTS`): arte 4:5 intacta centralizada com o fundo desfocado nas bordas. `story.png` é derivado e está no .gitignore.

**Telegram (opcional):** se `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID` estiverem no `_scripts/.env`, o agendador envia o thumb + legenda via bot quando auto-publica. Sem as vars é no-op silencioso (`notificarTelegram` em `agendador.js`).

**Publicação agendada:** `POST /api/{cast|slug}/arte/salvar` aceita `{ slug, publicar_em: ISO|null }` (sem `state`). O agendador (`utils/agendador.js`, intervalo 60s no dev-server) publica automaticamente quando a data chega e invalida os caches. Toggle manual: `{ slug, publicado: bool }`.

---

## Rotas CAST principais

```
GET  /api/cast/artes                     → lista artes-cast.json
POST /api/cast/arte/criar                → cria arte manual (sem proposta)
POST /api/cast/arte/salvar               → salva state.json + subtitle
POST /api/cast/arte/imagem/mudar         → nova imagem IA
POST /api/cast/arte/deletar              → deleta arte
POST /api/cast/exportar                  → gera arte.html estático (produção)
POST /api/cast/arte/reaplicar            → re-renderiza todas as artes do zero
GET  /artes/cast-*/arte.html             → renderização dinâmica (intercepta serveStatic)
```

---

## Identidade visual

| Marca | Fundo | Destaque | Headline | Corpo |
|-------|-------|----------|----------|-------|
| FEST | `#02050A` | `#14A8F4` (ciano) | Ubuntu Bold | Montserrat |
| CAST | `#07060f` | `#6366f1` (índigo) | Space Mono | Inter |
| Sunny Systems | `#0f0f0f` | `#FBB414` (âmbar) | Space Grotesk | Inter |

Logos parceiros FEST/CAST: DevOps Bootcamp, IAM Tech Day, Alcatraz Security.  
Logo Sunny Systems: `assets/logo-sunny.png` — sol âmbar + texto branco (versão para fundo escuro).
