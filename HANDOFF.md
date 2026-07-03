# CybersecFEST — Documento de Handoff para Nova IA

> **Última atualização:** 03 jul 2026 — sessão Claude Code (PLANO-3 + onda de features: stories, calendário, simplificação)  
> **Propósito:** Onboarding completo para qualquer IA ou agente que vá dar continuidade a este projeto.

---

## CHANGELOG RECENTE

### 01–03 jul 2026 — PLANO-3 + onda de features (commits b0459f8…a69fd1c)

**Infra e robustez:**
- Writes atômicos (`utils/atomic-write.js`) em todos os bancos JSON
- Rate limit `_imgLock` (429) na geração de imagem; retry validado
- `.gitignore`: .DS_Store, .serena/, propostas-cast.json, mídia local, story.png

**Features novas:**
- **Publicação agendada** — `publicar_em` + `utils/agendador.js` (60s no dev-server, invalida caches); notificação Telegram opcional (env)
- **Busca global** `GET /api/search?q=` e **calendário editorial** `/calendario/` + `GET /api/calendario` (multi-cliente, abre no mês com conteúdo, chip abre a arte via `?arte=slug`)
- **Export Story 1080×1920** — `GET /api/story.png?slug=` + formato Stories do editor; modo stretch rediagrama (estica `#the-canvas` + `.art-canvas-inner`), safe areas do Instagram e tipografia maior via `LAYOUT_POLISH`; frame (blur) como fallback
- **Onboarding via UI** — card "＋ Novo cliente" na home → `POST /api/clientes/criar`; home renderiza cards de `_clients.json` dinamicamente

**Correções de fluxo:**
- Título editado no editor persiste no banco também no FEST (gotcha 15 resolvido)
- Toggle "Marcar publicada" do CAST não exige mais `state`
- **Rotação de layouts manda na aprovação** (gotcha 25): LLM não dita layout; pools por cliente via `brand.js` → `rotacaoLayouts`; prompts da Sunny usam zonas de exclusão canônicas (`getLayoutImageRules`)
- **Pedido simplificado**: galerias = caixa de briefing única; tipo inferido do texto (`utils/inferir-tipo.js`), vazio = calendário; selects de tipo/objetivo e checkbox "Forçar" removidos
- UX: toasts (`assets/toast.js`) no lugar de alert(), nav cruzada FEST↔CAST↔Sunny↔📅, home com card de cliente dinâmico

### 28 jun 2026 — 9 melhorias Plano-2 + configuração de tokens

**`_scripts/utils/client-router.js`:**
- `handleCalendario` — rota `GET /api/{slug}/temas/calendario` (Fase 1)
- `handleSalvarArte` — aceita `publicado: bool` sem `state`; persiste `publicado` + `publicado_em` (Fase 6)
- `_getArteEmbeddings(artes)` — cache 60s para embeddings das artes; invalida em `writeArtes` (Fase 4)
- `_gerarImagem` — valida qualidade (< 50KB) com 1 retry automático (Fase 8)
- Thumbnails fire-and-forget em criar/duplicar/aprovar; await mantido em salvar/reaplicar (Fase 3)
- `handleExportarZip` inclui `arte.html` (Fase 5)

**`_scripts/routes/cast.js`:**
- `handleFestArteHtmlDynamic` — renderização dinâmica de artes FEST (elimina gotcha 16) (Fase 2)
- Thumbnails fire-and-forget em criar/duplicar (Fase 3)
- `handleCastExportarZip` inclui `arte.html` (Fase 5)

**`_scripts/dev-server.js`:**
- Intercepta `/artes/(evento|blog|patrocinador|palestrante)-*/arte.html` antes do serveStatic (Fase 2)

**`_scripts/utils/similaridade.js`:**
- `marcarSimilares` aceita 4º arg `arteEmbeddingsPrecomputed` (Fase 4)

**`_scripts/utils/llm.js`:**
- `validateImageQuality(imgBuffer)` exportada — check tamanho mínimo (Fase 8)

**`_brands/sunnysystems/imagem-prompt.js`:**
- `LAYOUT_COMPOSITION_HINTS` A/B/C/D/G/H/J/M/N injetados no prompt (Fase 9)

**`sunnysystems/index.html` + `cast/index.html`:**
- Filtro "Só publicadas" + badge ✓ no card + botão toggle no modal (Fase 6)
- `#modal-seed-wrap` + `loadSeedFromState` + `copySeed` (Fase 7)

**`.claude/settings.json`** (novo):
- `ECC_DISABLED_HOOKS` desabilita GateGuard para este projeto
- Permissões: npm test, lsof :8765, curl localhost, mcp headroom

Ver `PLANO-MELHORIAS-2.md` para especificação completa das 9 fases.

---

### 28 jun 2026 — 12 melhorias + porte Sunny Systems

**Novos módulos:**
- `_scripts/utils/similaridade.js` — cosine similarity via embeddings `text-embedding-3-small`

**`_scripts/utils/llm.js`** — 3 novas funções exportadas:
- `generateImageGptImage1WithSeed(prompt, seed?)` — variação controlada; retorna `{ buffer, seed }`
- `getEmbedding(input)` — embedding de texto ou array
- `detectSubjectPosition(imgBuffer)` — posição do sujeito via `gpt-4o-mini` vision; retorna `left|center|right|abstract`

**`_scripts/utils/editor-v3-script.js` / `editor-wrap.js`** — editor agora genérico:
- `editorV3Script(slug, { saveUrl, previewUrl })` — URLs injetadas, não mais hardcoded por produto
- Headline, subtítulo e `palavras_azuis` sempre no payload de save (antes condicionados a `isCast`)

**`_scripts/utils/client-router.js`** — reescrito com todas as melhorias portadas do CAST:
- `handleExportarZip`, `handleDuplicarArte`, `handlePreview` (novos handlers)
- `handleMudarImagem` suporta `variar: true` com seed; `handleSalvarArte` persiste `palavras_azuis`
- `handlePedido` com feedback loop (últimas 5 artes) + similaridade + campo `cena_visual`
- `handleAprovarProposta` / `handleCriarArte` com `_detectSmartBgPos` automático
- Lock por slug via `_setBusy/_clearBusy`; `configureLock()` exportado
- `buildArteHtml(arteSlug, arte, bgPosOverride?)` — suporta override de posição inicial
- `previewUrl: /api/{slug}/arte/preview` injetado no editor

**Novas rotas (todos os clientes dinâmicos via `client-router.js`):**
```
POST /api/{slug}/arte/preview      → read-only, sem escrita em disco
POST /api/{slug}/arte/duplicar     → copia fundo.png + state.json, gera novo thumb
GET  /api/{slug}/exportar-zip      → ZIP com thumb.png + fundo.png + artes.json
```

**`sunnysystems/index.html`:** botão Variar + Duplicar, chip de similaridade  
**`assets/css/gallery.css`:** `.modal-img-variar-btn`, `.prop-similar`  
**`_scripts/gerar-propostas-cast.js`:** feedback loop + similaridade para CAST  
**`_scripts/routes/cast.js`:** ZIP, duplicar, seed+variar, smartBgPos, lock por slug

Ver `PLANO-MELHORIAS.md` para tabela completa de fases e arquivos.

---

---

## 1. O QUE É ESTE PROJETO

Este repositório é a **fábrica automatizada de conteúdo** para dois produtos de cibersegurança:

- **CybersecFEST** — evento premium (BH e SP 2026)
- **CybersecCAST** — podcast executivo de cibersegurança

### O que ele faz:
- Gera **artes gráficas** para Instagram (feed vertical 1080×1350) automaticamente via IA
- Exibe as artes em **galerias locais** (`fest/index.html` para FEST, `cast/index.html` para CAST)
- Home **Studio** em `home.html` (raiz `/`) com seleção de produto
- Permite **editar** artes via editor visual inline no navegador
- Gera **animações HTML/GSAP** (Motion System) para as artes estáticas
- Renderiza as animações como **MP4** via HyperFrames CLI
- Exporta **legendas** para cada post

### Tecnologias principais:
- **Node.js** — scripts, servidor de desenvolvimento, geração de artes
- **HTML/CSS/JS puro** — galeria, artes estáticas e animadas
- **GSAP 3** — engine de animação
- **HyperFrames** (`npx hyperframes@0.7.3`) — render de HTML→MP4
- **OpenAI / GPT-4o** — geração de imagens de fundo e texto criativo
- **Puppeteer / Playwright** — captura de screenshots (thumbs)
- **Vercel** — deploy público da galeria (repositório espelho em `betoyes/cybersecfest`)

---

## 2. ESTRUTURA DE DIRETÓRIOS

```
cybersecfest-auto-1/               ← raiz do projeto
│
├── home.html                      ← STUDIO HOME — seleção de produto (/, local e Vercel)
├── fest/
│   └── index.html                 ← GALERIA FEST (/fest/) — todos os paths absolutos
├── cast/
│   └── index.html                 ← GALERIA CAST (/cast/)
├── artes.json                     ← BANCO FEST — lista de todas as artes FEST
├── artes-cast.json                ← BANCO CAST — lista de todas as artes CAST
├── temas.json                     ← contexto editorial FEST, temas, rotação de layouts
├── propostas.json                 ← banco de rascunhos FEST aguardando aprovação
├── propostas-cast.json            ← banco de rascunhos CAST aguardando aprovação
├── animacoes.json                 ← registro de todas as animações geradas
├── AGENTS.md                      ← protocolo multi-agente (ler OBRIGATORIAMENTE)
├── CLAUDE.md                      ← guia compacto para Claude Code (lido automaticamente)
├── HANDOFF.md                     ← este documento
│
├── artes/                         ← uma pasta por post publicado
│   └── {slug}/
│       ├── arte.html              ← HTML da arte estática (NUNCA editar diretamente)
│       ├── thumb.png              ← imagem composta final (logo + texto + fundo)
│       ├── fundo.png              ← foto de fundo pura (sem texto), ≈ igual thumb
│       ├── fundo-raw.png          ← foto de fundo LIMPA extraída do art-bg
│       ├── img-versoes/           ← histórico de versões de imagem (Mudar Imagem)
│       │   ├── index.json         ← { ativa: 2, versoes: [{id,criada_em,label}] }
│       │   ├── v1/
│       │   │   ├── fundo.png      ← imagem da versão 1 (original)
│       │   │   └── thumb.png      ← thumbnail da versão 1
│       │   └── v2/, v3/…          ← versões geradas via chat "Mudar Imagem"
│       └── motion/                ← pasta de animações (se tiver motion)
│           ├── versions.json      ← lista de versões (v1, v2, v3…)
│           ├── pedidos.json       ← fila de pedidos da UI
│           ├── v1/                ← versão 1 da animação
│           │   ├── index.html     ← composição HyperFrames + GSAP
│           │   ├── design.md      ← notas do preset
│           │   ├── hyperframes.json
│           │   ├── package.json
│           │   ├── preview.mp4    ← só após render
│           │   └── assets/
│           │       ├── fundo-raw.png   ← foto limpa (sem texto)
│           │       ├── fundo.png       ← foto composta (fallback)
│           │       ├── logo-cyberfest.png
│           │       ├── logo-devops.webp
│           │       ├── logo-iam.webp
│           │       ├── logo-alcatraz.webp
│           │       └── fonts/
│           │           ├── Ubuntu-Bold.woff2
│           │           ├── Montserrat-Regular.woff2
│           │           ├── Montserrat-SemiBold.woff2
│           │           └── Montserrat-Bold.woff2
│           └── v2/, v3/…          ← versões adicionais (mesma estrutura)
│
├── assets/
│   ├── css/gallery.css            ← estilos da galeria + modal motion
│   ├── js/
│   │   ├── motion-versions.js     ← frontend: carrega versões, player, downloads
│   │   ├── motion-sandbox.js      ← frontend: controle de quais posts têm motion
│   │   └── motion-prompt.js       ← frontend: modal "Nova Versão" + presets
│   ├── logo-cyberfest.png         ← logo principal
│   ├── logo-devops.webp           ← parceiro DevOps Bootcamp
│   ├── logo-iam.webp              ← parceiro IAM Tech Day
│   └── logo-alcatraz.webp         ← parceiro Alcatraz Security
│
├── _agents/
│   └── animador/
│       ├── SKILL.md               ← procedimento AnimAgent (passo a passo)
│       ├── config.json            ← configurações e catálogo de presets
│       └── BRIEF-PROMPT-ANIMACAO.md ← guia para criar briefs de animação
│
├── _scripts/                      ← scripts Node.js do sistema
│   ├── dev-server.js              ← servidor HTTP local (porta 8765) — ~710 linhas
│   ├── gerador-artes.js           ← gera arte FEST completa via IA
│   ├── gerador-artes-cast.js      ← gera arte CAST completa via IA
│   ├── pedido-run.js              ← executa pedido de nova arte FEST
│   ├── pedido-run-cast.js         ← executa pedido de nova arte CAST
│   ├── aprovar-propostas.js       ← aprovação de lotes FEST
│   ├── aprovar-propostas-cast.js  ← aprovação de lotes CAST
│   ├── gerar-propostas-cast.js    ← gera 3 propostas CAST via LLM
│   ├── motion-pedido-run.js       ← worker: gera versão motion em background
│   ├── routes/
│   │   ├── cast.js                ← handlers CAST (factory setupCastRoutes)
│   │   └── motion.js              ← handlers Motion (factory setupMotionRoutes)
│   └── utils/
│       ├── layouts.js             ← renderiza HTML de cada layout (A–Q)
│       ├── brand-renderer.js      ← aplica tokens de marca sobre HTML do layout
│       ├── editor-wrap.js         ← wrapper editor visual (painéis CSS + HTML)
│       ├── editor-v3-script.js    ← JS do editor (sliders, save, export PNG)
│       ├── img-versoes.js         ← lê/escreve histórico img-versoes/ por slug
│       ├── llm.js                 ← Gemini (imagens) + GPT-4o (texto) + cadeia de fallback
│       ├── thumb-composto.js      ← captura screenshot da arte como thumb.png
│       ├── editor-state.js        ← lê/escreve estado do editor inline
│       ├── motion-gerador.js      ← lógica de geração de versões motion
│       ├── motion-presets.js      ← HTML templates dos presets automáticos
│       ├── motion-versoes.js      ← leitura/escrita de versions.json
│       ├── motion-pedidos.js      ← fila de pedidos (pedidos.json)
│       ├── motion-mp4.js          ← resolve arquivo MP4 de uma versão
│       └── …outros utilitários
│
├── _brands/
│   └── cyberseccast/
│       ├── brand.js               ← tokens de cor/fonte/logo CAST
│       ├── imagem-prompt.js       ← prompts CAST, detectPerson(), CAST_STYLE_REF_INSTRUCTION
│       └── temas.json             ← contexto editorial CAST, histórico de layouts
│
├── galeria-templates/
│   └── index.html                 ← galeria de templates (layouts A–Q)
│
└── effects-preview/               ← previews de efeitos visuais
```

---

## 3. COMO INICIAR O SERVIDOR LOCAL

```bash
cd _scripts
npm run dev
# ou:
LOCAL_MODE=1 node dev-server.js
```

Servidor sobe em: **`http://127.0.0.1:8765/`**

A variável `LOCAL_MODE=1` é essencial — sem ela o sistema tenta usar o GitHub API em vez de gravar em disco.

---

## 4. ARTES — COMO FUNCIONAM

### Tipos de post:
| Tipo | Exemplos de uso |
|------|-----------------|
| `blog` | Conteúdo editorial, gatilho FOMO |
| `evento` | Divulgação direta do evento |
| `patrocinador` | Chamada para patrocínio |
| `palestrante` | Destaque de speaker (ainda não gerado) |

### Layouts disponíveis (A–Q):
Cada layout é um template HTML com posicionamento diferente de elementos. Definidos em `_scripts/utils/layouts.js`. Os ativos estão em `galeria-templates/`.

### Paleta e tipografia da identidade visual:
- **Fundo:** `#02050A` (quase preto azulado)
- **Texto principal:** `#F6F8FF` (branco frio)
- **Destaque/azul:** `#14A8F4` (ciano elétrico)
- **Fonte headline:** Ubuntu Bold
- **Fonte corpo:** Montserrat (Regular, SemiBold, Bold)
- **Logos parceiros:** DevOps Bootcamp, IAM Tech Day, Alcatraz Security

### Estrutura de um post em `artes.json`:
```json
{
  "slug": "evento-1782045624931",
  "tipo": "evento",
  "headline": "O RISCO NÃO\nESPERA VOCÊ\nSE ATUALIZAR.",
  "palavras_azuis": "RISCO, ATUALIZAR",
  "subtitulo": "Venha debater com quem está no campo...",
  "cidade": "",
  "formato": "feed_vertical",
  "layout": "E",
  "legenda": "Texto completo para Instagram...",
  "image_path": "artes/evento-1782045624931/thumb.png",
  "html_path": "artes/evento-1782045624931/arte.html",
  "created_at": "2026-06-21T12:40:27.598Z"
}
```

### Regra CRÍTICA — `artes.json` é append-only:
**Nunca remover entradas.** Só adicionar. O SuperAgent tem posse exclusiva de escrita.

---

## 5. POSTS EXISTENTES (jun/2026)

| Slug | Tipo | Layout | Tem motion? |
|------|------|--------|-------------|
| `patrocinador-1782039190901` | patrocinador | F | ❌ |
| `evento-1782045624931` | evento | E | ✅ v1 (cinematic-13s, HTML preview) |
| `blog-1782058741657` | blog | C | ❌ |
| `blog-1782058840735` | blog | M | ❌ |
| `blog-1782085374136` | blog | N | ❌ |
| `blog-1782085638864` | blog | C | ❌ |
| `blog-1782087418412` | blog | M | ❌ |
| `blog-1782100791590` | blog | N | ❌ |
| `blog-1782102928259` | blog | M | ❌ |
| `evento-1782143777641` | evento | E | ✅ v1/v2/v3 (v3=preview, tem MP4) |
| `blog-1782236441882` | blog | C | ❌ |
| `blog-1782238181309` | blog | C | ❌ |
| `patrocinador-1782316675205` | patrocinador | I | ❌ |

---

## 6. CYBERSEC.CAST — PIPELINE COMPLETO

### Identidade visual CAST:
- **Fundo:** `#07060f` (quase preto violeta)
- **Destaque:** `#6366f1` (índigo/violeta)
- **Headline:** Space Mono
- **Corpo:** Inter
- **Logo:** `assets/logo-cast.png`
- **Eco logos:** mesmos do FEST (DevOps Bootcamp, IAM Tech Day, Alcatraz Security)

### Fluxo de geração CAST:

```
UI (cast/index.html)
  → POST /api/cast/pedido → handleCastPedido
  → pedido-run-cast.js → criarLotePropostasCast (gerar-propostas-cast.js)
     → LLM: 3 propostas (headline, subtítulo, palavras_azuis, contexto_visual)
     → salvas em propostas-cast.json

[Usuário aprova proposta na UI]

  → POST /api/cast/propostas/aprovar → handleCastAprovar
  → aprovarLoteCast (aprovar-propostas-cast.js)
  → gerarArteCast (gerador-artes-cast.js)
     → buildCastImagePrompt (imagem-prompt.js)
         detectPerson() → sem pessoas se convidado não for nomeado
         cenas abstratas: microfone, estúdio, LED índigo, LUT cinematográfico
     → generateImage com _styleInstruction=CAST_STYLE_REF_INSTRUCTION
         cadeia: Gemini 3.1 → Gemini 2.5 → gpt-image-1 → DALL-E 3
     → renderLayoutForBrand (brand-renderer.js) → tokens CAST + logo CAST
     → wrapWithEditor → arte.html
     → gerarThumbComposto → thumb.png
     → salvo em artes-cast.json
```

### Modo híbrido (local vs produção):

**Local (dev-server):** `arte.html` é renderizado dinamicamente a cada GET — mudanças de código refletem automaticamente sem regenerar artes.
```
GET /artes/cast-*/arte.html
  → handleCastArteHtmlDynamic (intercepta antes de serveStatic)
  → buildArteHtmlCast: fundo.png + artes-cast.json + state.json
  → renderLayoutForBrand + wrapWithEditor → HTML fresco
```

**Produção (GitHub Pages):** `POST /api/cast/exportar` gera arte.html estático para todos os slugs.

### Estado do editor CAST:
- Salvo em `artes/{slug}/state.json` (separado do arte.html)
- `POST /api/cast/arte/salvar` → salva state.json + subtitle em artes-cast.json + regenera thumb
- Subtitle suporta `<br>` para quebras de linha (editável no painel direito do editor)

### Pool de layouts por tipo CAST:
```
episodio:  C, M, N, G
convidado: D, G, K, F
insight:   A, H, L, J
```

### Rotas CAST:
| Método | Path | O que faz |
|--------|------|-----------|
| `GET` | `/api/cast/artes` | Lista artes-cast.json |
| `POST` | `/api/cast/pedido` | Gera propostas via IA |
| `GET` | `/api/cast/propostas` | Lista propostas pendentes |
| `POST` | `/api/cast/propostas/aprovar` | Aprova proposta → gera arte |
| `POST` | `/api/cast/arte/criar` | Cria arte manual (sem proposta) |
| `POST` | `/api/cast/arte/salvar` | Salva state + subtitle |
| `POST` | `/api/cast/arte/imagem/mudar` | Nova imagem via IA |
| `POST` | `/api/cast/exportar` | Gera arte.html estático (produção) |
| `POST` | `/api/cast/arte/reaplicar` | Re-renderiza todas as artes |
| `GET` | `/artes/cast-*/arte.html` | Renderização dinâmica (modo local) |

---

## 7. MOTION SYSTEM — COMO FUNCIONA

Este é o sistema mais complexo. Permite criar versões animadas das artes estáticas.

### Arquitetura do Motion System:

```
UI (index.html)
  ↓ clica "MOTION" no modal do card
assets/js/motion-versions.js     ← frontend: carrega versions.json, exibe player
assets/js/motion-prompt.js       ← frontend: modal "Nova Versão"
  ↓ POST /api/motion/pedido
_scripts/dev-server.js            ← cria pedido.json, dispara worker em background
  ↓ spawn
_scripts/motion-pedido-run.js    ← worker (processo filho)
  ↓ chama
_scripts/utils/motion-gerador.js ← gera HTML da nova versão
  ↓ usa
_scripts/utils/motion-presets.js ← templates HTML+GSAP dos presets automáticos
  ↓ escreve
artes/{slug}/motion/v{N}/        ← nova versão criada em disco
  ↓ atualiza
artes/{slug}/motion/versions.json
animacoes.json
```

### `versions.json` — estrutura:
```json
{
  "slug": "evento-1782045624931",
  "preview": 1,          ← versão atualmente selecionada para exibição
  "mp4_from": 1,         ← versão com MP4 aprovado para download
  "versions": [
    {
      "id": 1,
      "dir": "v1",        ← pasta física: motion/v1/
      "preset": "cinematic-reveal-13s",
      "duracao_s": 13,
      "created_at": "2026-06-25T23:30:00.000Z",
      "note": "Descrição da versão",
      "mp4": null          ← "preview.mp4" se tiver MP4 gerado
    }
  ]
}
```

**Legado:** posts antigos têm `dir: "."` (composição na raiz de `motion/`, não em subpasta).

### Presets automáticos (`motion-presets.js`):

| ID | Label | Duração | Auto | Descrição |
|----|-------|---------|------|-----------|
| `entrance-premium-6s` | entrada | 6.5s | ✅ | Ken Burns suave, headline sobe em stagger |
| `kinetic-swipe-7s` | swipe | 7s | ✅ | Headline entra pela esquerda, flash azul |
| `confraria-lite-8s` | hud | 8s | ✅ | Cantos HUD, orb atmosférico, 3D leve |
| `confraria-signal` | signal | 9s | ❌ (manual) | Grid, scan, parallax duplo, CTA shine |

**Presets manuais existentes** (criados pelo Cursor, não pelo gerador automático):

| Post | Versão | Preset ID | Duração | Status |
|------|--------|-----------|---------|--------|
| `evento-1782045624931` | v1 | `cinematic-reveal-13s` | 13s | HTML preview (sem MP4) |
| `evento-1782143777641` | v1 | `signal-mesh-10s` | 10s | legado (dir: ".") |
| `evento-1782143777641` | v2 | `signal-mesh-enhanced-10s` | 10s | tem MP4 |
| `evento-1782143777641` | v3 | `cyber-command-impact-9s` | 9s | **preview atual**, tem MP4 |

### PROBLEMA CRÍTICO RESOLVIDO — Ghost Text / Double Text

**O que era:** Todo preset automático usa `fundo.png` como imagem de fundo. O `fundo.png` é uma cópia do `thumb.png`, que é a composição completa (logo + texto + subtítulo + tudo baked). Ao colocar texto HTML por cima, criava texto duplicado.

**A solução implementada:**

1. **`fundo-raw.png`** — imagem extraída do elemento `#art-bg` da `arte.html`. É a foto de fundo original **sem texto**. Deve existir em `artes/{slug}/fundo-raw.png`.

2. **`motion-gerador.js`** — ao copiar assets para uma nova versão, prioridade:
   ```
   fundo-raw.png > fundo.png > thumb.png
   ```
   Se `fundo-raw.png` existir, usa ele (foto limpa). Assim novos presets automáticos nunca terão ghost text.

3. **Overlay 100% sólido** — em `motion-presets.js`, o `.overlay` agora é `#02050a` sólido nos primeiros 55% da largura e faz gradiente até transparente em 78%. Cobre completamente qualquer texto baked no lado esquerdo.

4. **v1 de `evento-1782045624931`** — usa `fundo-raw.png` diretamente. O overlay é `opacity: 1` desde o CSS (não animado), eliminando janela de visibilidade do fundo.

**Para novos posts:** Ao criar uma animação, extrair `fundo-raw.png` do `#art-bg` da `arte.html` e salvar em `artes/{slug}/fundo-raw.png`.

### Como criar `fundo-raw.png` para um post:
```javascript
// Na arte.html, o elemento #art-bg tem background-image: url('data:image/...')
// Extrair esse data URI e salvar como fundo-raw.png
// Isso pode ser feito via Puppeteer ou manualmente inspecionando o DOM
```

### Contrato HyperFrames (composição válida):
```html
<div id="root"
  data-composition-id="preset-id"
  data-start="0"
  data-width="1080"
  data-height="1350"
  data-duration="13">
  <section class="clip scene"
    data-start="0"
    data-duration="13"
    data-track-index="1">
    <!-- conteúdo -->
  </section>
</div>
<script>
  const tl = gsap.timeline({ paused: true });
  // animações...
  window.__timelines['preset-id'] = tl;
</script>
```

**Obrigatório:**
- `data-composition-id` único
- `gsap.timeline({ paused: true })`
- `window.__timelines["id"] = tl`
- **SEM** `repeat: -1` (render determinístico)
- **SEM** Google Fonts CDN (apenas `@font-face` local com `.woff2`)
- Validar com `npx hyperframes@0.7.3 lint` antes de commitar

### Render de MP4:
```bash
cd artes/{slug}/motion/v{N}
npm run render
# equivale a: npx hyperframes@0.7.3 render --fps 30 --quality high --output preview.mp4
```

---

## 7. API REST DO SERVIDOR LOCAL

O `dev-server.js` roda na porta **8765** e expõe:

### Rotas de Artes:
| Método | Path | O que faz |
|--------|------|-----------|
| `POST` | `/api/pedido` | Gera nova arte (fluxo completo via IA) |
| `GET` | `/api/propostas` | Lista propostas pendentes de aprovação |
| `POST` | `/api/aprovar` | Aprova lote de propostas |
| `POST` | `/api/rejeitar` | Rejeita lote |
| `POST` | `/api/banco` | Consome uma proposta do banco pré-gerado |
| `POST` | `/api/arte/salvar` | Salva edições do editor inline |
| `POST` | `/api/arte/deletar` | Remove uma arte |
| `POST` | `/api/campanha` | Gera lote de artes (campanha) |
| `GET` | `/api/campanha/export` | Exporta ZIP da campanha |
| `POST` | `/api/arte/imagem/mudar` | Gera nova imagem via IA (instrução livre) |
| `GET` | `/api/arte/imagem/versoes?slug=` | Lista versões de imagem de um post |
| `POST` | `/api/arte/imagem/versao/ativar` | Restaura versão anterior como ativa |
| `POST` | `/api/arte/imagem/versao/deletar` | Deleta uma versão de imagem |

### Rotas Motion:
| Método | Path | O que faz |
|--------|------|-----------|
| `POST` | `/api/motion/pedido` | Cria pedido de nova versão (dispara worker) |
| `GET` | `/api/motion/pedido?slug=` | Status do pedido em andamento |
| `GET` | `/api/motion/versoes?slug=` | Lista versões de um post |
| `POST` | `/api/motion/selecionar` | Define versão preview |
| `POST` | `/api/motion/aprovar-mp4` | Define versão como source do MP4 |
| `POST` | `/api/motion/deletar` | Deleta uma versão (v2+, nunca v1) |
| `GET` | `/api/motion/mp4?slug=&version=` | Resolve URL do MP4 de uma versão |
| `GET` | `/api/motion/presets?slug=` | Lista presets disponíveis |

### Payload de `/api/motion/pedido`:
```json
{
  "slug": "evento-1782045624931",
  "mode": "surpresa",           ← "surpresa" ou "ajustar"
  "instrucoes": "mais lento",   ← só quando mode=ajustar
  "baseVersion": 1,             ← versão base para ajuste (opcional)
  "presetId": "kinetic-swipe-7s" ← preset específico (opcional)
}
```

### Payload de `/api/motion/selecionar`:
```json
{ "slug": "evento-1782045624931", "version": 2 }
```

---

## 8. GALERIA (index.html) — COMO FUNCIONA

A galeria principal em `index.html` é uma SPA (Single Page App) que:

1. Carrega `artes.json` e exibe os cards em grade
2. Cards são clicáveis — todas as ações ficam **apenas no modal** (sem botões na grade)
3. Clicando num card abre modal com:
   - **Preview** da arte (`thumb.png`)
   - **Mudar Imagem**: campo de instrução livre + botão Gerar → chama `/api/arte/imagem/mudar`
     - Pills de versão aparecem abaixo (v1 Original, v2 — instrução, …)
     - Clique num pill não-ativo → restaura aquela versão via `/api/arte/imagem/versao/ativar`
     - Botão `×` em pills não-ativos → deleta via `/api/arte/imagem/versao/deletar`
   - **Legenda**, **Editar**, **↓ PNG**, **🗑 Deletar**
   - **Motion EM STANDBY**: UI de motion comentada em `index.html` (código preservado, não deletado)

### `<hyperframes-player>` Web Component:
```html
<hyperframes-player src="artes/{slug}/motion/v1/index.html"></hyperframes-player>
```
Carrega a composição em iframe, controla play/pause/timeline.

### Visibilidade do Motion:
Controlada por `assets/js/motion-sandbox.js`. Atualmente retorna `true` para qualquer slug não-vazio (motion universal para todos os posts).

### Geração em background:
Quando o usuário clica "+ Nova Versão", o servidor:
1. Cria `pedidos.json` com status `pending`
2. Dispara `motion-pedido-run.js` como processo filho (`spawn + detached`)
3. Retorna imediatamente ao frontend com `{ ok: true, pedido: { id, targetVersion } }`
4. O frontend faz polling em `/api/motion/pedido?slug=` até status `done`

---

## 9. AGENTES — QUEM SÃO, COMO FUNCIONAM E PROTOCOLO

### 9.1 Visão Geral — Dois Agentes Distintos

```
┌─────────────────────────────────────────────────────────────────┐
│                    USUÁRIO (Beto)                                │
│  Orquestra ambos os agentes, aprova outputs, dá direção         │
└────────────────┬──────────────────────────┬────────────────────-┘
                 │                          │
     ┌───────────▼──────────┐   ┌───────────▼──────────┐
     │     SUPERAGENT       │   │      ANIMAGENT        │
     │   Plataforma: CREAO  │   │   Plataforma: Cursor  │
     │                      │   │                       │
     │ Gera artes estáticas │   │ Cria animações motion │
     │ Orquestra editorial  │   │ Render MP4            │
     │ Mantém artes.json    │   │ Mantém animacoes.json │
     │ Deploy Vercel        │   │ Mantém motion/        │
     └──────────────────────┘   └───────────────────────┘
```

---

### 9.2 SuperAgent (CREAO)

**Plataforma:** CREAO (plataforma proprietária de agentes IA)  
**Prefixo de commit:** `[SuperAgent]`

#### O que o SuperAgent faz — fluxo completo:

```
1. Recebe instrução do usuário
   ("gere um post de blog sobre IAM")
         ↓
2. Lê temas.json
   - Identifica tema editorial
   - Verifica rotação de layouts (qual layout usar)
   - Consulta historico_recente para não repetir
         ↓
3. Gera texto criativo (via GPT-4 / LLM)
   - headline (maiúsculas, 3–5 palavras impactantes)
   - palavras_azuis (quais palavras ficam em #14A8F4)
   - subtitulo (1–2 frases de apoio)
   - legenda (texto completo para Instagram)
         ↓
4. Gera imagem de fundo (via DALL-E / GPT-4o Vision)
   - Estilo: fotografia dark, cidade à noite, luz azul
   - Dimensões: ~1122×1402 (maior que o canvas para o Ken Burns)
   - Salva como base64 em arte.html (#art-bg)
         ↓
5. Renderiza arte.html
   - Usa layouts.js para montar o HTML (layout A–Q)
   - Insere imagem como background-image no #art-bg
   - Insere texto em #art-content (logo, headline, subtítulo, CTAs)
   - Salva em artes/{slug}/arte.html
         ↓
6. Captura screenshot (Puppeteer/Playwright)
   - Tira screenshot de arte.html em 1080×1350
   - Salva como artes/{slug}/thumb.png
         ↓
7. Registra em artes.json
   - Append da entrada com slug, tipo, headline, layout, paths
   - Atualiza temas.json (historico_recente)
         ↓
8. Atualiza index.html
   - Adiciona o novo card na galeria pública
   - Via branch + PR (nunca direto na main)
         ↓
9. Commit [SuperAgent] + push para repo público
```

#### Onde vive o conteúdo gerado pelo SuperAgent:
```
artes/{slug}/
  arte.html       ← HTML completo da arte (NÃO editar)
  thumb.png       ← composição final capturada (logo+texto+fundo, tudo em uma imagem)
  fundo.png       ← pode ser igual ao thumb.png (composição) OU foto limpa
```

> ⚠️ **IMPORTANTE:** `thumb.png` é uma imagem composta — tem o logo, headline, subtítulo, logos parceiros TUDO BAKED como pixels. Não é só o fundo. Isso é o que causa o problema de "ghost text" nas animações se usada diretamente.

#### Quando o SuperAgent usa o GitHub API diretamente:
O SuperAgent opera via API do GitHub (não via git local). Ele usa `PUT /repos/betoyes/cybersecfest/contents/arquivo` para commitar. Por isso a regra de "fetch fresco antes de escrever" — ele precisa do SHA atual para não criar conflitos.

---

### 9.3 AnimAgent (Cursor)

**Plataforma:** Cursor IDE (este ambiente)  
**Prefixo de commit:** `[AnimAgent]` ou `[Cursor]`

#### O que o AnimAgent faz — fluxo completo:

```
1. Recebe instrução do usuário
   ("crie animação para evento-1782045624931")
         ↓
2. Leitura obrigatória (PASSO 0 do SKILL.md)
   - AGENTS.md
   - _agents/animador/config.json
   - artes.json (metadados do post: headline, palavras_azuis, etc.)
   - artes/{slug}/arte.html (somente leitura — referência visual)
   - artes/{slug}/motion/versions.json (se existir)
         ↓
3. Prepara assets
   - Extrai fundo-raw.png de arte.html (#art-bg background-image)
   - Salva em artes/{slug}/fundo-raw.png (foto limpa, sem texto)
   - Copia logos, fontes para motion/v{N}/assets/
         ↓
4. Compõe index.html (HyperFrames + GSAP)
   - Canvas 1080×1350
   - Fundo: fundo-raw.png (foto limpa)
   - Overlay: gradiente sólido na esquerda (cobre área do texto)
   - Camadas: bg → overlay → luz azul → partículas → vinheta → conteúdo HTML
   - Timeline GSAP: paused, determinística, sem repeat:-1
   - window.__timelines["preset-id"] = tl
         ↓
5. Valida
   cd artes/{slug}/motion/v{N}
   npx hyperframes@0.7.3 lint    ← 0 erros obrigatório
         ↓
6. Registra em versions.json (append)
   {
     "id": N,
     "dir": "vN",
     "preset": "nome-do-preset",
     "duracao_s": 13,
     "created_at": "...",
     "note": "descrição",
     "mp4": null
   }
         ↓
7. Registra em animacoes.json (append ou update)
         ↓
8. Render MP4 (quando solicitado)
   cd artes/{slug}/motion/v{N}
   npm run render
   → preview.mp4
         ↓
9. Commit [AnimAgent] feat: motion {preset} — {slug}
```

#### Como o AnimAgent cria animações manualmente vs automaticamente:

**Modo automático (via UI "Nova Versão"):**
- Usuário clica "+ Nova Versão" na galeria
- Frontend chama `POST /api/motion/pedido`
- `dev-server.js` cria um pedido em `pedidos.json` e dispara `motion-pedido-run.js` como processo filho
- `motion-pedido-run.js` chama `motion-gerador.js` → `motion-presets.js`
- O preset gera o HTML completo automaticamente usando os dados de `artes.json`
- Versão criada em `motion/v{N}/`

**Modo manual (via Cursor/AnimAgent):**
- Usuário descreve a animação desejada (pode usar `BRIEF-PROMPT-ANIMACAO.md` como guia)
- O AnimAgent lê o brief, entende o conceito criativo
- Escreve o `index.html` manualmente com GSAP timeline customizada
- Permite animações muito mais sofisticadas que os presets automáticos
- Exemplo: `cinematic-reveal-13s` (v1 de `evento-1782045624931`)

#### Arquivos de skill do AnimAgent:
```
_agents/animador/
  SKILL.md                    ← procedimento passo a passo (ler antes de operar)
  config.json                 ← catálogo de presets, paths, regras
  BRIEF-PROMPT-ANIMACAO.md    ← guia para criar briefs de animação com IA externa
```

---

### 9.4 Interação entre os Agentes

Os agentes **NÃO se comunicam diretamente**. O usuário é o ponto de contato entre eles.

```
SuperAgent cria arte
    → artes.json atualizado
    → artes/{slug}/arte.html + thumb.png criados
    
Usuário pede ao AnimAgent para animar
    → AnimAgent lê artes.json para pegar metadados
    → AnimAgent NÃO modifica arte.html ou artes.json
    → AnimAgent cria artes/{slug}/motion/ com animações
    → AnimAgent atualiza animacoes.json
```

#### Verificação de estado cruzado:
Antes de qualquer operação, verificar os últimos commits:
```bash
git log --oneline -10
```
Se houver commits com prefixo diferente do seu, reportar ao usuário antes de prosseguir.

---

### 9.5 Protocolo de Commits e Branches

**Prefixos de commit obrigatórios:**
```
[SuperAgent] feat: adiciona arte blog-1782xxxxxx — Layout N
[AnimAgent]  feat: motion cinematic-reveal-13s — evento-1782045624931
[Cursor]     feat: Motion System v1 — pipeline completo
[Cursor]     fix: ghost text — overlay sólido + fundo-raw.png
```

**Mudanças em arquivos centrais → Branch + PR:**
```bash
# Criar branch com prefixo do agente
git checkout -b animagent/update-motion-presets

# Fazer o commit na branch
git commit -m "[AnimAgent] feat: novo preset premium signal-v2"

# Abrir PR para o usuário aprovar
gh pr create --title "AnimAgent: novo preset signal-v2"
```

**Arquivos com dono definido:**
| Arquivo/Pasta | Dono | Outros agentes |
|---------------|------|----------------|
| `artes.json` | SuperAgent | Apenas leitura |
| `temas.json` | SuperAgent | Leitura; edições via branch |
| `index.html` | SuperAgent | Leitura; edições via branch |
| `_agents/` | SuperAgent | Apenas leitura |
| `animacoes.json` | AnimAgent | Append-only |
| `artes/{slug}/motion/` | AnimAgent | Escrita livre |
| `AGENTS.md` | Qualquer agente | PR obrigatório |
| `HANDOFF.md` | Qualquer agente | PR obrigatório |

---

### 9.6 Onboarding de Nova IA neste Protocolo

Se uma nova IA/agente for integrada:

1. Solicitar ao usuário um GitHub Token com permissão `push`
2. Leitura obrigatória: `AGENTS.md`, `HANDOFF.md`, `artes.json`, `temas.json`
3. Verificar últimos 5 commits para identificar atividade recente
4. Escolher prefixo de commit único (ex: `[ClaudeAgent]`, `[GPTAgent]`)
5. Adicionar linha na tabela de agentes em `AGENTS.md` via PR
6. **Nunca** usar `artes.json` como escrita se não for o SuperAgent

---

## 10. FLUXO EDITORIAL

### Calendário:
| Dia | Tipo de post | Tom |
|-----|-------------|-----|
| Segunda | blog | Gatilho pertencimento / conteúdo tema da grade |
| Quarta | palestrante | Autoridade + FOMO |
| Sexta | evento ou patrocinador | Chamada direta |

### Tom editorial (NUNCA violar):
- **Aspiracional, exclusivo, FOMO** — "se não estou lá, estou fora do mercado"
- **Proibido:** hackers encapuzados, cadeados, código verde, "num mundo cada vez mais digital", preços de cotas, datas não confirmadas

### Palavras azuis:
Campo `palavras_azuis` no `artes.json` indica quais palavras do headline aparecem em `#14A8F4`. Separadas por vírgula, case-insensitive.

### Rotação de layouts:
```
blog:         C → M → N → O → (repete)
evento:       E → L → J → P → (repete)
patrocinador: F → I → B → Q → (repete)
```

---

## 11. DEPLOY / REPOSITÓRIO PÚBLICO

- **Repo local:** `betoyes/cybersecfest-auto-1` (este repositório)
- **Repo público (Vercel):** `betoyes/cybersecfest`
- A galeria pública (`index.html`) é deployada no Vercel do repo público
- O SuperAgent faz push de artes aprovadas via GitHub API diretamente no repo público

---

## 12. ESTADO ATUAL DO PROJETO (jun/2026)

### Studio Home — O que está funcionando:
- ✅ `home.html` na raiz (`/`) — seleção de produto com cards FEST, CAST e placeholder "novo cliente"
- ✅ `fest/index.html` — galeria FEST em `/fest/` com todos os paths absolutos (foi migrada de `/`)
- ✅ `cast/index.html` — link "← Studio" adicionado no header
- ✅ `assets/css/gallery.css` — classe `.back-home` adicionada (usada pela galeria FEST)

### CybersecFEST — O que está funcionando:
- ✅ Geração automática de artes (blog, evento, patrocinador)
- ✅ Editor visual inline no modal da galeria
- ✅ Galeria local com preview, edição e aprovação
- ✅ **Mudar Imagem** — troca de fundo via instrução livre (Gemini, sem referências visuais)
- ✅ **Versionamento de imagem** — histórico em `img-versoes/`, pills de versão no modal
- ✅ `LAYOUT_BG_POS` — posição automática do fundo por layout ao trocar imagem
- ✅ Motion System: presets automáticos + presets manuais (UI em standby, código preservado)
- ✅ Versionamento de animações (v1, v2, v3…) + download de MP4
- ✅ Fix definitivo de ghost text (fundo-raw.png + overlay sólido)
- ✅ **Agente editorial `fest-estrategista`**: knowledge.js (histórico real, edições BH+SP 2026, cotas com valores reais, empresas participantes) + 3 personas — `FEST_AUDIENCIA_SYSTEM`, `FEST_PATROCINADORES_SYSTEM`, `FEST_CONVITE_SYSTEM`
- ✅ Briefing do usuário (`temaLivre`) vai ao topo do prompt com prioridade absoluta — não é mais ignorado pelo LLM

### CybersecCAST — O que está funcionando:
- ✅ Pipeline completo: pedido → propostas → aprovação → arte
- ✅ Identidade visual CAST (índigo #6366f1, Space Mono, Inter, logo CAST)
- ✅ Modo híbrido: renderização dinâmica local + export estático para produção
- ✅ Editor visual com state.json separado (mudanças no código refletem automaticamente)
- ✅ Subtitle editável no editor com suporte a quebra de linha
- ✅ Sem pessoas por padrão — `detectPerson()` ativa cenas com pessoa apenas se nomeada
- ✅ Cadeia de imagem: Gemini 3.1 → Gemini 2.5 → gpt-image-1 → DALL-E 3
- ✅ Back URL do editor aponta para `../../cast/`
- ✅ Export PNG sem espaço preto (scale 2x via `style.transform`)
- ✅ Badge LAYOUT A removido do canvas (era artefato em `thumb.png` antigos; código não gera mais)
- ✅ Label `.cl` correta: CAST artes exibem "CybersecCAST · Layout X" (não "CybersecFEST")
- ✅ Versões de imagem (pills v1/v2/v3) na galeria CAST: path de thumb corrigido (prefixo `/` absoluto)
- ✅ Modal CAST: headline renderiza HTML (`innerHTML`) — `<br>` no título aparece como quebra de linha
- ✅ Modal CAST: subtitle no painel meta exibe sem `<br>` literal (tags stripped antes do display)
- ✅ Slider ←→ (posição lateral) da imagem de fundo: reescrito em `uBg()` com `translate+scale` em vez de `objectPosition` — funciona com imagens retrato em containers paisagem
- ✅ **Agente editorial `cast-estrategista`**: knowledge.js (episódios gravados com convidado/cargo/empresa reais, hosts Edgar + Amanda, patrocinadores T1, cotas Silver/Gold/Diamond/Strategic) + 3 personas — `CAST_AUDIENCIA_SYSTEM`, `CAST_PATROCINADORES_SYSTEM`, `CAST_TEMPORADA_SYSTEM`
- ✅ **Validação de qualidade de legenda** (3 passos): gerar → `forceLong` → `expandirLegendaCast` individual — mesma pipeline do FEST
- ✅ `referencia-copy-cast.js`: calibração por linhas (6–12) E chars (320–1400), exemplos ouro fixos + exemplos dinâmicos de `artes-cast.json` aprovadas
- ✅ Briefing do usuário ao topo do prompt — LLM não ignora mais o tema informado
- ✅ Lote pendente com objetivo diferente é descartado automaticamente — não bloqueia novo pedido de outro objetivo

### Motion UI — Estado Standby (jun/2026):
A UI de motion está **comentada** em `index.html` com marcadores `<!-- MOTION EM STANDBY -->`. O pipeline backend continua funcional.

### O que ainda precisa ser feito:
- ❌ Extrair `fundo-raw.png` para todos os posts FEST (só `evento-1782045624931` tem)
- ❌ Criar motion para os outros posts FEST
- ❌ Posts do tipo `palestrante` ainda não foram criados
- ❌ Deploy automático para o Vercel (ainda manual)
- ❌ Reativar UI de motion quando pipeline estiver estável

### Refatorações recentes (jun/2026):
- ✅ `nodemon` — `npm run dev` reinicia automaticamente ao salvar qualquer `.js`
- ✅ Cache em memória em `embed-assets.js` — assets lidos do disco uma só vez por processo
- ✅ Warning em `moveCastLogoToLeft` — stderr se string CSS não for encontrada
- ✅ `dev-server.js` fragmentado: 1526 → 710 linhas; handlers CAST em `routes/cast.js`, Motion em `routes/motion.js`, versões de imagem em `utils/img-versoes.js`

---

## 13. COMO UMA NOVA IA DEVE COMEÇAR

### Passo 0 — Leitura obrigatória:
```
1. AGENTS.md         ← protocolo multi-agente
2. HANDOFF.md        ← este documento
3. artes.json        ← posts existentes (não duplicar slugs)
4. temas.json        ← contexto editorial vigente
5. animacoes.json    ← animações já criadas
```

### Passo 1 — Verificar commits recentes:
```bash
git log --oneline -10
```
Identificar commits de outros agentes antes de operar.

### Passo 2 — Subir servidor local:
```bash
cd _scripts && npm run dev
```
Acessar: `http://127.0.0.1:8765/`

### Passo 3 — Para criar uma animação nova:
1. Verificar se o post tem `fundo-raw.png` em `artes/{slug}/`
2. Se não tiver, extrair do `arte.html` (elemento `#art-bg` → `background-image`)
3. Seguir o procedimento em `_agents/animador/SKILL.md`
4. Usar prefixo de commit `[AnimAgent]`

### Passo 4 — Para criar uma nova arte estática:
Isso é responsabilidade do **SuperAgent** (CREAO). O Cursor/AnimAgent não deve criar artes sem coordenação.

---

## 14. ARQUIVOS CHAVE — RESUMO RÁPIDO

| Arquivo | O que é | Quem edita |
|---------|---------|-----------|
| `artes.json` | banco de posts | SuperAgent (append-only) |
| `temas.json` | contexto editorial, rotação | SuperAgent |
| `animacoes.json` | registro de animações | AnimAgent (append-only) |
| `index.html` | galeria pública | SuperAgent (via PR) |
| `AGENTS.md` | protocolo colaboração | Qualquer agente via PR |
| `_scripts/dev-server.js` | servidor + rotas FEST + dispatch (~710 linhas) | Cursor |
| `_scripts/routes/cast.js` | handlers CAST (factory) | Cursor |
| `_scripts/routes/motion.js` | handlers Motion (factory) | Cursor |
| `_scripts/utils/img-versoes.js` | versões de imagem por slug | Cursor |
| `_scripts/utils/motion-gerador.js` | gera versões motion | Cursor/AnimAgent |
| `_scripts/utils/motion-presets.js` | templates HTML presets | Cursor/AnimAgent |
| `_scripts/utils/motion-versoes.js` | lê/escreve versions.json | Cursor/AnimAgent |
| `assets/js/motion-versions.js` | frontend player motion | Cursor |
| `assets/js/motion-sandbox.js` | quais posts têm motion | Cursor |
| `_agents/animador/SKILL.md` | procedimento AnimAgent | AnimAgent via PR |
| `_scripts/utils/editor-state.js` | estado padrão do editor inline | Cursor |
| `_scripts/utils/editor-v3-script.js` | JS do editor inline (uBg, uEl, uTxt…) | Cursor |
| `_scripts/utils/editor-wrap.js` | wrap HTML + CSS do editor | Cursor |
| `_scripts/utils/imagem-prompt.js` | prompts de imagem por layout (A–Q) | Cursor |
| `_scripts/utils/llm.js` | clientes Gemini + OpenAI (texto e imagem) | Cursor |
| `_agents/fest-estrategista/knowledge.js` | Base de conhecimento real do FEST (edições, cotas, histórico) | Cursor |
| `_agents/fest-estrategista/system-prompt.js` | 3 personas LLM do FEST: audiencia, patrocinadores, convite | Cursor |
| `_agents/cast-estrategista/knowledge.js` | Base de conhecimento real do CAST (episódios, hosts, patrocinadores) | Cursor |
| `_agents/cast-estrategista/system-prompt.js` | 3 personas LLM do CAST: audiencia, patrocinadores, temporada | Cursor |
| `_scripts/utils/referencia-copy-cast.js` | Calibração editorial CAST: validação legenda + exemplos ouro | Cursor |
| `_scripts/utils/referencia-copy.js` | Calibração editorial FEST: validação legenda + exemplos ouro | Cursor |
| `artes-cast.json` | banco de artes CAST | append-only |
| `propostas-cast.json` | fila de propostas CAST (lotes + banco) | dev-server via API |

---

## 15. VARIÁVEIS DE AMBIENTE

Arquivo `.env` na raiz (não commitado):

```env
LOCAL_MODE=1              # grava em disco local (obrigatório para dev)
OPENAI_API_KEY=sk-...     # geração de imagens e texto
GITHUB_TOKEN=ghp_...      # push para repo público (Vercel)
GITHUB_REPO=betoyes/cybersecfest  # repo público
```

---

## 16. COMANDOS ÚTEIS

```bash
# Subir servidor de desenvolvimento
cd _scripts && npm run dev

# Criar animação via CLI
node _scripts/animar-arte.js --slug evento-1782045624931 --preset entrance-premium-6s

# Validar composição HyperFrames
cd artes/{slug}/motion/v1 && npx hyperframes@0.7.3 lint

# Preview no browser
cd artes/{slug}/motion/v1 && npx hyperframes@0.7.3 preview

# Render MP4 (qualidade alta)
cd artes/{slug}/motion/v1 && npm run render

# Render MP4 (rascunho rápido)
cd artes/{slug}/motion/v1 && npm run render:draft

# Ver versões de um post
cat artes/{slug}/motion/versions.json

# Ver todas as animações
cat animacoes.json
```

---

## 17. GOTCHAS E ARMADILHAS CONHECIDAS

1. **Ghost text / Double text:** Sempre usar `fundo-raw.png` (foto limpa) como fundo das animações. Se não existir, criar extraindo do `#art-bg` da `arte.html`. Nunca usar `thumb.png` diretamente como fundo em composições com texto HTML.

2. **Preview automático da nova versão:** Quando o worker gera uma nova versão, ele define `preview = novaVersão` em `versions.json`. Se quiser manter a versão original como preview, definir manualmente via `POST /api/motion/selecionar`.

3. **Overlay deve ser opacity:1 desde o CSS:** Não animar o overlay de 0→1 se ele precisar cobrir texto baked. Animá-lo significa que entre t=0 e t=fade, o fundo fica exposto.

4. **Sem `repeat: -1` no GSAP:** O HyperFrames render captura frames determinísticos. Loop infinito trava o render. Para loops ambiente, use `gsap.delayedCall` ou callback `onComplete`.

5. **Fontes obrigatoriamente locais:** `@font-face` com `.woff2` em `assets/fonts/`. Google Fonts CDN falha no render headless.

6. **`artes.json` append-only:** Nunca remover ou reordenar entradas. Só adicionar ao final.

7. **Sandbox Node vs frontend divergem:** `_scripts/utils/motion-sandbox.js` ainda restringe a `evento-1782143777641` por código. `assets/js/motion-sandbox.js` já liberou para todos. Se precisar liberar no servidor também, editar `motion-sandbox.js` do `_scripts/utils/`.

8. **Versão legado `dir: "."`:** Posts antigos têm a composição na raiz de `motion/` (não em `v1/`). O sistema lida com isso, mas novas versões devem sempre usar subpastas `v{N}/`.

9. **Mudar Imagem — `useReferences: false`:** A rota `/api/arte/imagem/mudar` desativa as imagens de referência de estilo (`useReferences: false`). Isso é intencional — as referências copiavam a composição (ex: homem de costas) e ignoravam a instrução do usuário. O estilo de marca é mantido via prompt textual (`buildImagePrompt` com `userScene`).

10. **`background-position` por layout:** Ao trocar imagem, `LAYOUT_BG_POS` em `dev-server.js` define a posição de fundo correta por layout. Ex: layout C (sujeito à direita) usa `x: 85%`. Sem isso o sujeito gerado à direita ficava cortado com `background-position: 50%`. Ajustes manuais posteriores no editor ainda são possíveis.

11. **Imagem original extraída do `arte.html`:** Posts sem `fundo.png` separado têm a imagem embutida como base64 no `#art-bg` dentro do HTML. O `handleMudarImagem` extrai esse base64 e salva como `v1 — Original` em `img-versoes/` antes de sobrescrever, permitindo restauração posterior.

12. **Modelos Gemini para imagem (jun/2026):** Os modelos válidos são `gemini-3.1-flash-image-preview` (primário) e `gemini-2.5-flash-image` (fallback). A config correta usa `imageConfig: { aspectRatio: '3:4' }`, não `responseFormat`. Cadeia completa: Gemini 3.1 → Gemini 2.5 → gpt-image-1 → DALL-E 3.

13. **`renderLayoutForBrand(slug, arte, brand)`** — 1º arg é slug (ignorado internamente com `void slug`). O layout vem de `arte.layout`. Passar o slug como layout quebra o rendering silenciosamente.

14. **Instrução de estilo CAST vs FEST:** `generateImageNanoBanana` usa `STYLE_REF_INSTRUCTION` (cyan FEST) por padrão. CAST passa `_styleInstruction: CAST_STYLE_REF_INSTRUCTION` para sobrescrever. Misturar as duas instrui o Gemini com paleta contraditória e degrada a imagem.

15. **Módulos Node.js em cache:** O servidor cacheia todos os `require()` na inicialização. Editar qualquer `.js` e não reiniciar o servidor = código antigo rodando. Verificar `lsof -i :8765` para PID e `ps -p PID -o lstart` para hora de início.

16. **Export PNG espaço preto:** `domtoimage.toPng(el, {width, height})` NÃO faz scale automático do elemento — captura no tamanho natural e coloca no canvas maior. Usar `style: { transform: 'scale(N)', transformOrigin: 'top left' }` onde `N = exportW / el.offsetWidth`.

17. **Badge LAYOUT A no canvas:** NÃO é gerado pelo código atual. Era artefato baked em `thumb.png` antigos gerados por código legado. `normalizeCanvas` foi removido (jun/2026). Se reaparecer numa arte nova, verificar cache do servidor. A label `.cl` (rodapé do editor) exibe "CybersecCAST" ou "CybersecFEST" conforme `slug.startsWith('cast-')` em `editor-wrap.js:329`.

18. **`isV3Complete` em `wrapWithEditor`:** Se o `simpleHtml` passado já contiver `id="topbar"`, `ep-tag`, `btnSave`, etc., a função retorna o HTML inalterado. No modo híbrido CAST isso não acontece (simpleHtml vem de `renderLayoutForBrand` que é sempre HTML simples). Mas ao testar com arquivo do disco pode enganar.

19. **Subtitle CAST com `<br>`:** Subtítulo pode conter tags `<br>` para quebras de linha. O editor serializa innerHTML e restaura na textarea como `\n`. O `layouts.js` renderiza `${sub}` diretamente (sem escape). Salvo em `artes-cast.json.subtitulo`.

20. **`writeArtesCast()` invalida cache:** Após escrever `artes-cast.json`, o cache em memória é atualizado imediatamente. Não precisa de `invalidateArtesCast()` após `writeArtesCast()`.

---

21. **Slider ←→ (posição lateral) e `objectPosition` em imagens retrato:** `objectPositionX` não tem efeito quando a imagem retrato (ex: 896×1200) está num container paisagem (540×371) com `object-fit:cover` — a imagem preenche exatamente a largura, sem overflow horizontal. A função `uBg()` em `editor-v3-script.js` foi reescrita para usar `transform: translate(tx, ty) scale(z)`. O range de pan X cresce com o zoom: a 10% de zoom, ±27px; a 50%, ±135px. Também removido `object-position:center 25%` hardcoded do CSS `.img-band img` em `layouts.js` (Layout A).

22. **Thumb URL absoluta:** O servidor retorna `thumb` com path absoluto (`/artes/{slug}/thumb.png?t=...`). Sem o `/` inicial, o path resolve relativo à página atual — artes CAST em `/cast/` resolveriam para `/cast/artes/...` (404). Todo campo `thumb` retornado pela API usa path com `/` inicial.

23. **`temaLivre` deve ir ao TOPO do prompt:** O campo de briefing do usuário era inserido no meio do prompt (depois de "Crie 3 rotas para post de..."), fazendo o LLM ignorar o tema e gerar conteúdo genérico. Ambos os geradores (FEST e CAST) agora usam `temaHeader` com `🎯 PRIORIDADE ABSOLUTA` no início do prompt, antes de qualquer instrução.

24. **Agentes editoriais — atualizar `knowledge.js` quando mudar dados reais:** Os arquivos `_agents/fest-estrategista/knowledge.js` e `_agents/cast-estrategista/knowledge.js` contêm dados reais (episódios, convidados, cotas, edições). São a única fonte de verdade que o LLM usa. Se um convidado for confirmado, uma cota mudar ou uma edição for adicionada, atualizar esses arquivos — não o prompt do dev-server.

25. **Lote pendente de objetivo diferente:** O CAST valida se o lote pendente tem o mesmo `objetivo` do novo pedido. Se diferente (ex: lote de `audiencia` pendente + novo pedido de `patrocinadores`), o lote antigo é rejeitado automaticamente antes de gerar o novo. Isso evita o bug onde propostas irrelevantes eram retornadas ao usuário.

26. **Pipeline de validação de legenda CAST (3 passos):** `gerarRotasComValidacao` em `gerar-propostas-cast.js` valida por linhas (6–12) E chars (≥320). Passo 1: geração normal. Passo 2: `forceLong: true` se houver falhas. Passo 3: `expandirLegendaCast` individual para cada legenda ainda curta. O log do servidor mostra `· ângulo: N linhas · X chars ★ ⚠️` — monitorar qualidade em tempo real.

27. **Título editável no editor (jun/2026):** O painel direito da seção TÍTULO agora tem dois campos: `hlEdit` (textarea — texto + quebras de linha com `\n` → `<br>`) e `hlBlue` (input — palavras azuis separadas por espaço/vírgula). Ao digitar, `buildTitlHtml()` reconstrui o `TITL.innerHTML` envolvendo as palavras marcadas em `<span style="color:#14A8F4">` (FEST) ou `<span style="color:#6366f1">` (CAST). O campo `hlBlue` é pré-preenchido lendo os `<span[style*="color"]>` existentes no DOM. A edição é visual apenas — não persiste em `state.json` nem no `arte.html` em disco (próxima iteração: salvar via `saveBody.headline`).

29. **Arquitetura multi-cliente (jun/2026):** Qualquer novo cliente pode ser onboardado sem tocar em código. Fluxo completo:
    1. `node _scripts/onboarding-cliente.js --briefing briefing.json` — gera via GPT-4o: `_brands/{slug}/brand.js`, `imagem-prompt.js`, `temas.json`, `_agents/{slug}-estrategista/knowledge.js`, `system-prompt.js`; cria galeria `{slug}/index.html`, banco `artes-{slug}.json` e registra em `_clients.json`.
    2. Reiniciar o servidor — `loadClients()` lê `_clients.json` e instancia um `ClientRouter` por cliente ativo.
    3. `dispatchClient(req, res, urlPath)` no handler despacha automaticamente todas as rotas do cliente.
    Rotas disponíveis por cliente: `GET /{slug}/`, `GET /api/{slug}/artes`, `POST /api/{slug}/arte/criar|salvar|deletar|imagem/mudar|reaplicar`, `GET /artes/{slug}-*/arte.html`.
    Arquivos: `_scripts/onboarding-cliente.js`, `_scripts/utils/client-router.js`, `_clients.json`, `briefing-exemplo.json`.

28. **FEST `arte.html` agora é dinâmico (resolvido em 28 jun 2026):** `handleFestArteHtmlDynamic` em `routes/cast.js` intercepta `GET /artes/(evento|blog|patrocinador|palestrante)-*/arte.html` antes do `serveStatic`. Mudanças em `editor-wrap.js` ou `editor-v3-script.js` refletem automaticamente sem regenerar. Artes sem `fundo.png` (legado) ainda servem o arquivo estático em disco.

---

## 13. Agentes Editoriais

Dois agentes editoriais foram criados para substituir os system prompts hardcoded nos geradores de propostas.

### `_agents/fest-estrategista/`

| Arquivo | Conteúdo |
|---------|----------|
| `knowledge.js` | Histórico 2023–2026, edições BH+SP com temas e empresas reais, cotas com valores reais (BH e SP), diferenciais de patrocínio, perfil de audiência |
| `system-prompt.js` | `FEST_AUDIENCIA_SYSTEM` · `FEST_PATROCINADORES_SYSTEM` · `FEST_CONVITE_SYSTEM` |

Importado por: `_scripts/gerar-propostas.js`

### `_agents/cast-estrategista/`

| Arquivo | Conteúdo |
|---------|----------|
| `knowledge.js` | Hosts (Edgar + Amanda), 6 episódios gravados com convidado/cargo/empresa reais, 1 agendado, patrocinadores T1 (Skalena, LDC, Sunny), cotas Silver/Gold/Diamond/Strategic |
| `system-prompt.js` | `CAST_AUDIENCIA_SYSTEM` · `CAST_PATROCINADORES_SYSTEM` · `CAST_TEMPORADA_SYSTEM` |

Importado por: `_scripts/gerar-propostas-cast.js`

**Quando o `CAST_TEMPORADA_SYSTEM` está ativo**, o LLM pode e deve citar convidados por nome — os dados são verificados em `knowledge.js`. Para os outros objetivos, as legendas são conceituais (sem inventar fatos).

**Para adicionar novos convidados/episódios:** editar apenas `_agents/cast-estrategista/knowledge.js` → array `temporada.episodios_gravados`. O sistema pega automaticamente na próxima requisição (sem restart necessário, o arquivo é lido em runtime).

*Documento atualizado em 27 jun 2026 — sessão Claude Code (refatoração dev-server → routes/, nodemon, cache embed-assets)*  
*Para dúvidas sobre sessões anteriores: ver histórico de commits no git.*
