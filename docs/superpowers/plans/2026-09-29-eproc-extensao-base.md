# Extensão eproc — base (A): plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma extensão Chrome MV3 instalável, com painel lateral que confirma a conta no nosso sistema, encontra a aba do eproc do TJSC e mostra se o advogado está logado, em qual instância e qual processo está aberto. Junto vem a infraestrutura (rede, captcha, sigilo, erros) que os subprojetos B, C e D vão usar.

**Architecture:** O painel (React) orquestra. Ele chama a nossa API com `fetch` + cookie e pede dados ao agente (content script na aba do eproc) por `chrome.tabs.sendMessage`. O service worker só abre o painel. Toda a lógica fica em módulos TypeScript puros, testados com `node --test`. Os pontos que tocam `chrome.*` são finos e verificados à mão.

**Tech Stack:** TypeScript 5.9, React 19, Vite 6 (painel + service worker), esbuild (agente em IIFE, já instalado como dependência do Vite), `node --test` do Node 25 (roda `.ts` direto), `@types/chrome` (única dependência nova, só de desenvolvimento).

**Spec:** `docs/superpowers/specs/2026-09-29-eproc-extensao-base-design.md`

### Desvios deliberados do spec

1. **Pasta `frontend/extensao/` em vez de `extensao/` na raiz.** Um arquivo em `extensao/` que importa `react` não acha `frontend/node_modules`, porque a resolução de módulos sobe pelas pastas e nunca desce para `frontend/`. Dentro de `frontend/`, a extensão divide `node_modules`, `tsconfig` e scripts com o site sem nenhuma configuração extra.
2. **`estado()` não devolve `usuario`.** No HTML da JFRS o nome do usuário não aparece num elemento estável (só dentro de um menu dinâmico), e o spec já aceitava `null`. Campo que sempre vale `null` é código morto. Volta quando o HAR do TJSC mostrar onde o nome fica.
3. **O processo aberto vem da URL, não do DOM.** A tela de detalhe é `controlador.php?acao=processo_selecionar&...&num_processo=<20 dígitos>`. O `id="txtNumProcesso"` que o guia cita não existe no HTML gravado (só existe `txtNumProcessoPesquisaRapida`, que é o campo de busca).
4. **Política em `/privacidade.html`, estática**, em `frontend/public/`. O FastAPI já serve arquivos reais de `dist/` sem login (`api/app.py:1164-1171`), e uma página React exigiria login.
5. **Erro a mais no painel: `SISTEMA_FORA`**, para quando a nossa API não responde (qualquer falha que não seja 401). O spec não previa esse caso, e sem ele a tela ficaria muda.
6. **`frontend/src/api.ts` muda**: a base da API vem de `VITE_API_BASE` e o `fetch` usa `credentials: 'include'`, para o painel (página `chrome-extension://`) conversar com a API. No site, `VITE_API_BASE` é indefinido e nada muda.

## Global Constraints

- Permissões: exatamente `["sidePanel", "scripting"]`. **Nunca** `cookies`, `tabs` ou `<all_urls>`.
- `host_permissions`: `https://eproc1g.tjsc.jus.br/*`, `https://eproc2g.tjsc.jus.br/*` e a origem da nossa API. Nada mais.
- Nenhum código remoto. Tudo vai no pacote.
- Erros do agente: conjunto fechado `NAO_LOGADO | CAPTCHA | LAYOUT | EPROC_FORA | SIGILOSO | SEM_ABA_EPROC`.
- Cookies, `hash`, URLs assinadas e dados de processo nunca saem da aba do eproc. Na base, o painel não envia dado do eproc à nossa API.
- Uma requisição ao eproc por vez, com intervalo mínimo de 1 s entre elas.
- Timeout de 25 s por requisição ao eproc.
- Decodificação: UTF-8 estrito, com recuo para `windows-1252`.
- `LAYOUT` nunca vira lista vazia nem "nenhum processo".
- Sigilo em caso de dúvida: `id_sigilo` ausente, ou `title` sem "Nível N", conta como sigiloso.
- Métodos mutantes na nossa API levam `X-Requerido-Por: web`.
- Textos da interface em português, com as mensagens exatas da tabela "Erros na tela" do spec.
- Nenhum HAR, e nenhum dado real de processo, entra no git. As fixtures usam só os dados fictícios do guia (CNPJ `11.222.333/0001-81`, processo `50012345620204047100`).

## Review Focus

1. **Nossa API fora do ar ou com 500 na abertura do painel.** Espera-se `SISTEMA_FORA`, com botão de tentar de novo, e não tela em branco nem "entre no sistema". Teste na Task 5.
2. **Várias abas do eproc abertas, uma delas descartada pelo Chrome.** Espera-se que a aba ativa seja preferida e que a descartada seja recarregada antes do uso. Teste na Task 5.
3. **O agente responde algo fora do formato** (versão antiga injetada, `undefined`). Espera-se `LAYOUT`, sem exceção solta no painel. Teste na Task 5.
4. **Resposta do eproc em ISO-8859-1 com acento cru, chegando como JSON válido.** Espera-se o acento preservado, não `�`. Teste na Task 2.
5. **Duas chamadas ao eproc disparadas ao mesmo tempo.** Espera-se a segunda começar só depois da primeira terminar e de 1 s de intervalo. Teste na Task 2.

---

## Estrutura de arquivos

```
frontend/
  package.json                      (mod) scripts build:extensao, test:extensao; devDep @types/chrome
  tsconfig.json                     (mod) include extensao; types chrome; exclui *.test.ts
  vite.extensao.config.ts           (novo) build do painel + sw, gera manifest.json
  public/privacidade.html           (novo) política de privacidade
  src/api.ts                        (mod) base da API por env + credentials: 'include'
  extensao/
    manifest.ts                     montarManifest(apiBase) — puro
    manifest.test.ts
    sw.ts                           abre o painel ao clicar no ícone
    painel.html                     entrada do painel
    painel/
      main.tsx                      monta <Painel/>
      Painel.tsx                    tela
      chrome.ts                     adaptadores chrome.* → Deps do fluxo
      fluxo.ts                      abrirPainel(deps) — puro
      fluxo.test.ts
      mensagens.ts                  texto + ação por erro — puro
      mensagens.test.ts
      painel.css
    agente/
      index.ts                      content script: listener + despacho
      lib/
        erros.ts                    TipoErro, ErroEproc
        rede.ts                     decodificar, criarRede → {postar, baixarPagina}
        rede.test.ts
        captcha.ts
        sigilo.ts
        captcha-sigilo.test.ts
        har.test.ts                 roda contra *.har na raiz, se existir
        estado.ts                   lerEstado(doc, url)
        estado.test.ts
        despacho.ts                 responder(msg, doc, url) — puro
        despacho.test.ts
verificar.bat                       (mod) testes + build da extensão
COMO_RODAR.md                       (mod) como gerar e carregar a extensão
```

Todos os comandos abaixo rodam em `frontend/`, salvo quando indicado.

---

### Task 1: Esqueleto do build e manifest

**Files:**
- Create: `frontend/extensao/manifest.ts`, `frontend/extensao/manifest.test.ts`, `frontend/vite.extensao.config.ts`, `frontend/extensao/sw.ts`, `frontend/extensao/painel.html`, `frontend/extensao/painel/main.tsx`, `frontend/extensao/agente/index.ts`
- Modify: `frontend/package.json`, `frontend/tsconfig.json`, `frontend/src/api.ts:11-21`, `.gitignore`

**Interfaces:**
- Produces: `EPROC_HOSTS: string[]`; `montarManifest(apiBase: string): chrome.runtime.ManifestV3`, que lança `Error` se `apiBase` for inválida; `import.meta.env.VITE_API_BASE: string` no build da extensão (`undefined` no site); scripts `npm run build:extensao` e `npm run test:extensao`.

- [ ] **Step 1: Instalar os tipos do Chrome**

Run: `npm install -D @types/chrome`
Expected: `package.json` ganha `"@types/chrome"` em `devDependencies`.

- [ ] **Step 2: Escrever o teste do manifest**

`frontend/extensao/manifest.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EPROC_HOSTS, montarManifest } from './manifest.ts'

test('permissões mínimas exigidas pela loja', () => {
  const m = montarManifest('https://sistema.exemplo.com.br')
  assert.deepEqual(m.permissions, ['sidePanel', 'scripting'])
  assert.deepEqual(m.host_permissions, [...EPROC_HOSTS, 'https://sistema.exemplo.com.br/*'])
  const tudo = JSON.stringify(m)
  for (const proibido of ['"cookies"', '"tabs"', '<all_urls>']) assert.ok(!tudo.includes(proibido), proibido)
})

test('agente só roda no eproc do TJSC', () => {
  const m = montarManifest('https://sistema.exemplo.com.br')
  assert.deepEqual(m.content_scripts, [{ matches: EPROC_HOSTS, js: ['agente.js'], run_at: 'document_idle' }])
  assert.deepEqual(EPROC_HOSTS, ['https://eproc1g.tjsc.jus.br/*', 'https://eproc2g.tjsc.jus.br/*'])
})

test('base da API: caminho e barra final não vazam para a permissão', () => {
  const m = montarManifest('https://sistema.exemplo.com.br/qualquer/')
  assert.equal(m.host_permissions?.at(-1), 'https://sistema.exemplo.com.br/*')
})

test('http só em localhost', () => {
  assert.equal(montarManifest('http://localhost:5173').host_permissions?.at(-1), 'http://localhost:5173/*')
  assert.throws(() => montarManifest('http://sistema.exemplo.com.br'), /https/)
})

test('base ausente ou inválida falha o build', () => {
  assert.throws(() => montarManifest(''), /EXT_API_BASE/)
  assert.throws(() => montarManifest('não é url'), /EXT_API_BASE/)
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test extensao/manifest.test.ts`
Expected: FAIL, `Cannot find module ... manifest.ts`.

- [ ] **Step 4: Implementar o manifest**

`frontend/extensao/manifest.ts`:

```ts
// O manifest é gerado no build (vite.extensao.config.ts) porque a origem da
// nossa API muda entre dev e produção, e ela entra em host_permissions.
export const EPROC_HOSTS = ['https://eproc1g.tjsc.jus.br/*', 'https://eproc2g.tjsc.jus.br/*']

export function montarManifest(apiBase: string): chrome.runtime.ManifestV3 {
  let url: URL
  try {
    url = new URL(apiBase)
  } catch {
    throw new Error('EXT_API_BASE ausente ou inválida: ' + JSON.stringify(apiBase))
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('EXT_API_BASE tem de ser https (http só em localhost): ' + apiBase)
  }
  return {
    manifest_version: 3,
    name: 'Segundo Cérebro — eproc',
    version: '0.1.0',
    description: 'Analisa processos do eproc do TJSC com a sessão do próprio advogado.',
    minimum_chrome_version: '116',
    action: { default_title: 'Segundo Cérebro' },
    side_panel: { default_path: 'painel.html' },
    background: { service_worker: 'sw.js', type: 'module' },
    // Sem 'cookies': quem anexa o cookie do eproc é o próprio navegador, no
    // fetch de mesma origem do agente. A extensão nunca lê cookie nenhum.
    permissions: ['sidePanel', 'scripting'],
    host_permissions: [...EPROC_HOSTS, url.origin + '/*'],
    content_scripts: [{ matches: EPROC_HOSTS, js: ['agente.js'], run_at: 'document_idle' }],
  }
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test extensao/manifest.test.ts`
Expected: PASS, 5 testes.

- [ ] **Step 6: Entradas mínimas da extensão**

`frontend/extensao/sw.ts`:

```ts
// Só isto. Quem orquestra é o painel (ver spec, "Arquitetura"): ele fica vivo
// enquanto aberto, e o service worker morre depois de ~30 s ocioso.
const abrirNoClique = () =>
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})
abrirNoClique()
chrome.runtime.onInstalled.addListener(abrirNoClique)
```

`frontend/extensao/painel.html`:

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <title>Segundo Cérebro</title>
  </head>
  <body>
    <div id="raiz"></div>
    <script type="module" src="./painel/main.tsx"></script>
  </body>
</html>
```

`frontend/extensao/painel/main.tsx` (provisório, a Task 6 troca):

```tsx
import { createRoot } from 'react-dom/client'

createRoot(document.getElementById('raiz')!).render(<p>Segundo Cérebro</p>)
```

`frontend/extensao/agente/index.ts` (provisório, a Task 4 troca):

```ts
export {}
```

- [ ] **Step 7: Config do Vite da extensão**

`frontend/vite.extensao.config.ts`:

```ts
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { montarManifest } from './extensao/manifest.ts'

// Painel + service worker saem daqui, em ES modules. O agente (content script)
// NÃO: content script não pode ser módulo, então sai do esbuild em IIFE (ver
// o script build:extensao no package.json).
const API_BASE = process.env.EXT_API_BASE ?? ''
const manifest = montarManifest(API_BASE) // falha o build cedo se faltar a env
const raiz = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  root: raiz('./extensao'),
  plugins: [
    react(),
    {
      name: 'manifest',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'manifest.json', source: JSON.stringify(manifest, null, 2) })
      },
    },
  ],
  define: { 'import.meta.env.VITE_API_BASE': JSON.stringify(new URL(API_BASE).origin) },
  build: {
    outDir: raiz('./extensao/dist'),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: { painel: raiz('./extensao/painel.html'), sw: raiz('./extensao/sw.ts') },
      output: { entryFileNames: '[name].js', chunkFileNames: 'chunks/[name].js', assetFileNames: 'assets/[name][extname]' },
    },
  },
})
```

- [ ] **Step 8: Scripts, tsconfig e .gitignore**

Em `frontend/package.json`, dentro de `"scripts"`, acrescente:

```json
"build:extensao": "vite build -c vite.extensao.config.ts && esbuild extensao/agente/index.ts --bundle --format=iife --target=chrome116 --outfile=extensao/dist/agente.js",
"test:extensao": "node --test \"extensao/**/*.test.ts\""
```

Em `frontend/tsconfig.json`, troque `"types"` e `"include"` e acrescente `"exclude"`:

```json
    "types": ["vite/client", "chrome"]
  },
  "include": ["src", "extensao"],
  "exclude": ["extensao/**/*.test.ts", "extensao/dist"]
```

(Os testes ficam fora do `tsc` porque usam `node:test` e o projeto não tem `@types/node`. O próprio `node --test` já falha se o arquivo não carregar.)

Em `.gitignore` (raiz), abaixo de `frontend/dist-artefato/`:

```
frontend/extensao/dist/
```

- [ ] **Step 9: A API aceita base e cookie cross-origin**

Em `frontend/src/api.ts`, dentro de `req`, troque `const r = await fetch(rota, {` e o `...init,` seguinte por:

```ts
  // No site, VITE_API_BASE é undefined e a rota continua relativa (same-origin).
  // No painel da extensão, a página é chrome-extension://, então a rota precisa
  // da origem da API, e o cookie só vai com credentials: 'include'.
  const r = await fetch((import.meta.env.VITE_API_BASE ?? '') + rota, {
    credentials: 'include',
    ...init,
```

- [ ] **Step 10: Build e checagem**

Run: `npx tsc --noEmit`
Expected: sem erros.

Run: `EXT_API_BASE=http://localhost:5173 npm run build:extensao` (no PowerShell: `$env:EXT_API_BASE='http://localhost:5173'; npm run build:extensao`)
Expected: `extensao/dist/` com `manifest.json`, `painel.html`, `painel.js`, `sw.js` e `agente.js`.

Run: `npm run build:extensao` sem a variável
Expected: FAIL com `EXT_API_BASE ausente ou inválida`.

Run: `npm run build`
Expected: o build do site continua passando.

- [ ] **Step 11: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/tsconfig.json frontend/vite.extensao.config.ts frontend/src/api.ts frontend/extensao .gitignore
git commit -m "extensao eproc: esqueleto do build e manifest com permissoes minimas"
```

---

### Task 2: Erros e rede do agente

**Files:**
- Create: `frontend/extensao/agente/lib/erros.ts`, `frontend/extensao/agente/lib/rede.ts`, `frontend/extensao/agente/lib/rede.test.ts`

**Interfaces:**
- Produces:
  - `type TipoErro = 'NAO_LOGADO' | 'CAPTCHA' | 'LAYOUT' | 'EPROC_FORA' | 'SIGILOSO' | 'SEM_ABA_EPROC'`
  - `class ErroEproc extends Error { tipo: TipoErro }`
  - `decodificar(bytes: ArrayBuffer): string`
  - `criarRede(op: { base: string; fetch?: typeof fetch; intervaloMs?: number; esperar?: (ms: number) => Promise<void>; agora?: () => number }): { postar(url: string, pares: [string, string][]): Promise<unknown>; baixarPagina(url: string): Promise<string> }`

- [ ] **Step 1: Escrever os testes**

`frontend/extensao/agente/lib/rede.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ErroEproc } from './erros.ts'
import { criarRede, decodificar } from './rede.ts'

const BASE = 'https://eproc1g.tjsc.jus.br/eproc/controlador.php?acao=x'
const latin1 = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0))).buffer

function resposta(corpo: string | ArrayBuffer, init: { status?: number; url?: string; redirected?: boolean } = {}) {
  const bytes = typeof corpo === 'string' ? new TextEncoder().encode(corpo).buffer : corpo
  return {
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    url: init.url ?? BASE,
    redirected: init.redirected ?? false,
    arrayBuffer: async () => bytes,
  } as unknown as Response
}

const semEspera = { esperar: async () => {}, agora: () => 0 }
const tipoDe = async (p: Promise<unknown>) => {
  try {
    await p
    return 'sem erro'
  } catch (e) {
    return e instanceof ErroEproc ? e.tipo : 'outro: ' + String(e)
  }
}

test('decodificar: utf-8 válido passa; latin1 cru cai para windows-1252', () => {
  assert.equal(decodificar(new TextEncoder().encode('ação').buffer), 'ação')
  assert.equal(decodificar(latin1('ação')), 'ação')
})

test('postar: JSON em ISO-8859-1 com acento cru chega intacto', async () => {
  const rede = criarRede({ base: BASE, ...semEspera, fetch: async () => resposta(latin1('{"classe":"MANDADO DE SEGURANÇA"}')) })
  assert.deepEqual(await rede.postar('controlador_ajax.php?acao_ajax=y', []), { classe: 'MANDADO DE SEGURANÇA' })
})

test('postar: corpo form-urlencoded preserva chave repetida e cabeçalhos da página', async () => {
  let visto: { url: string; init: RequestInit } | undefined
  const rede = criarRede({
    base: BASE,
    ...semEspera,
    fetch: async (url, init) => {
      visto = { url: String(url), init: init! }
      return resposta('{}')
    },
  })
  await rede.postar('controlador_ajax.php?acao_ajax=y', [['fnValidacao[]', 'a'], ['fnValidacao[]', 'b']])
  assert.equal(visto!.url, 'https://eproc1g.tjsc.jus.br/eproc/controlador_ajax.php?acao_ajax=y')
  assert.equal(String(visto!.init.body), 'fnValidacao%5B%5D=a&fnValidacao%5B%5D=b')
  assert.equal(visto!.init.method, 'POST')
  assert.equal(visto!.init.credentials, 'same-origin')
  assert.equal((visto!.init.headers as Record<string, string>)['X-Requested-With'], 'XMLHttpRequest')
})

test('sessão caída: tela de login no lugar do JSON', async () => {
  const rede = criarRede({ base: BASE, ...semEspera, fetch: async () => resposta('<form><input type="password" name="pwdSenha"></form>') })
  assert.equal(await tipoDe(rede.postar('a', [])), 'NAO_LOGADO')
  assert.equal(await tipoDe(rede.baixarPagina('a')), 'NAO_LOGADO')
})

test('sessão caída: redirecionamento para index.php ou externo_controlador.php', async () => {
  for (const url of ['https://eproc1g.tjsc.jus.br/eproc/index.php', 'https://eproc1g.tjsc.jus.br/eproc/externo_controlador.php?acao=principal']) {
    const rede = criarRede({ base: BASE, ...semEspera, fetch: async () => resposta('<html></html>', { redirected: true, url }) })
    assert.equal(await tipoDe(rede.baixarPagina('a')), 'NAO_LOGADO', url)
  }
})

test('status: 401/403 é sessão, 5xx e 429 são eproc fora', async () => {
  const com = (status: number) => criarRede({ base: BASE, ...semEspera, fetch: async () => resposta('x', { status }) })
  assert.equal(await tipoDe(com(401).postar('a', [])), 'NAO_LOGADO')
  assert.equal(await tipoDe(com(403).postar('a', [])), 'NAO_LOGADO')
  assert.equal(await tipoDe(com(503).postar('a', [])), 'EPROC_FORA')
  assert.equal(await tipoDe(com(429).postar('a', [])), 'EPROC_FORA')
})

test('JSON inválido sem cara de login é LAYOUT, nunca lista vazia', async () => {
  const rede = criarRede({ base: BASE, ...semEspera, fetch: async () => resposta('<html>tela nova</html>') })
  assert.equal(await tipoDe(rede.postar('a', [])), 'LAYOUT')
})

test('timeout e falha de rede viram EPROC_FORA', async () => {
  const timeout = criarRede({ base: BASE, ...semEspera, fetch: async () => { throw new DOMException('t', 'TimeoutError') } })
  assert.equal(await tipoDe(timeout.postar('a', [])), 'EPROC_FORA')
  const rede = criarRede({ base: BASE, ...semEspera, fetch: async () => { throw new TypeError('Failed to fetch') } })
  assert.equal(await tipoDe(rede.baixarPagina('a')), 'EPROC_FORA')
})

test('fila: chamadas simultâneas saem uma por vez, com intervalo mínimo', async () => {
  let relogio = 0
  const esperas: number[] = []
  const log: string[] = []
  const rede = criarRede({
    base: BASE,
    intervaloMs: 1000,
    agora: () => relogio,
    esperar: async (ms) => { esperas.push(ms); relogio += ms },
    fetch: async (url) => {
      log.push('ini ' + String(url).slice(-1))
      await new Promise((r) => setTimeout(r, 5))
      relogio += 200
      log.push('fim ' + String(url).slice(-1))
      return resposta('{}')
    },
  })
  await Promise.all([rede.postar('p1', []), rede.postar('p2', [])])
  assert.deepEqual(log, ['ini 1', 'fim 1', 'ini 2', 'fim 2'])
  // o intervalo conta do FIM da anterior (relógio 200) até o início da próxima
  assert.deepEqual(esperas, [1000])
})

test('fila: um erro não trava as chamadas seguintes', async () => {
  let n = 0
  const rede = criarRede({ base: BASE, ...semEspera, fetch: async () => (n++ === 0 ? resposta('x', { status: 500 }) : resposta('{"ok":1}')) })
  assert.equal(await tipoDe(rede.postar('a', [])), 'EPROC_FORA')
  assert.deepEqual(await rede.postar('a', []), { ok: 1 })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test extensao/agente/lib/rede.test.ts`
Expected: FAIL, módulos não encontrados.

- [ ] **Step 3: Implementar `erros.ts`**

`frontend/extensao/agente/lib/erros.ts`:

```ts
// Conjunto FECHADO. O painel tem uma mensagem e uma ação para cada um
// (painel/mensagens.ts). Erro novo aqui sem mensagem lá é o que o teste de
// mensagens pega.
export type TipoErro = 'NAO_LOGADO' | 'CAPTCHA' | 'LAYOUT' | 'EPROC_FORA' | 'SIGILOSO' | 'SEM_ABA_EPROC'

export class ErroEproc extends Error {
  tipo: TipoErro
  constructor(tipo: TipoErro, detalhe?: string) {
    super(detalhe ? tipo + ': ' + detalhe : tipo)
    this.tipo = tipo
  }
}
```

- [ ] **Step 4: Implementar `rede.ts`**

`frontend/extensao/agente/lib/rede.ts`:

```ts
import { ErroEproc } from './erros.ts'

// O controlador_ajax declara iso-8859-1 até em JSON; response.text() assumiria
// UTF-8 e estragaria acento cru. Estrito primeiro, porque UTF-8 válido quase
// nunca é latin1 por acaso.
export function decodificar(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

const PARECE_LOGIN = /type=["']?password|pwdSenha/i
const URL_LOGIN = /\/(index|externo_controlador)\.php/

type Opcoes = {
  base: string
  fetch?: typeof fetch
  intervaloMs?: number
  esperar?: (ms: number) => Promise<void>
  agora?: () => number
}

export function criarRede(op: Opcoes) {
  const buscar = op.fetch ?? fetch.bind(globalThis)
  const intervalo = op.intervaloMs ?? 1000
  const esperar = op.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const agora = op.agora ?? Date.now
  // ponytail: fila global por aba. Se B/C precisarem de paralelismo, não precisam:
  // o eproc é de um humano, e ritmo humano é a defesa contra captcha e bloqueio.
  let fila: Promise<unknown> = Promise.resolve()
  let ultimaSaida = -Infinity

  function naFila<T>(tarefa: () => Promise<T>): Promise<T> {
    const vez = fila.then(async () => {
      const falta = ultimaSaida + intervalo - agora()
      if (falta > 0) await esperar(falta)
      try {
        return await tarefa()
      } finally {
        ultimaSaida = agora()
      }
    })
    fila = vez.catch(() => {})
    return vez
  }

  async function requisitar(url: string, init: RequestInit): Promise<string> {
    let r: Response
    try {
      r = await buscar(new URL(url, op.base).href, {
        ...init,
        credentials: 'same-origin',
        signal: AbortSignal.timeout(25000),
      })
    } catch (e) {
      throw new ErroEproc('EPROC_FORA', String(e))
    }
    if (r.status === 401 || r.status === 403) throw new ErroEproc('NAO_LOGADO', 'status ' + r.status)
    if (!r.ok) throw new ErroEproc('EPROC_FORA', 'status ' + r.status)
    if (r.redirected && URL_LOGIN.test(new URL(r.url).pathname)) throw new ErroEproc('NAO_LOGADO', 'redirecionado')
    const texto = decodificar(await r.arrayBuffer())
    if (PARECE_LOGIN.test(texto.slice(0, 20000))) throw new ErroEproc('NAO_LOGADO', 'tela de login')
    return texto
  }

  return {
    postar(url: string, pares: [string, string][]): Promise<unknown> {
      return naFila(async () => {
        const texto = await requisitar(url, {
          method: 'POST',
          body: new URLSearchParams(pares), // lista de pares: aceita fnValidacao[] repetido
          headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json, text/javascript, */*; q=0.01' },
        })
        try {
          return JSON.parse(texto)
        } catch {
          throw new ErroEproc('LAYOUT', 'resposta não é JSON')
        }
      })
    },
    baixarPagina(url: string): Promise<string> {
      return naFila(() => requisitar(url, { method: 'GET' }))
    },
  }
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test extensao/agente/lib/rede.test.ts`
Expected: PASS, 10 testes. Se `String(visto.init.body)` não bater, confira que o corpo é `URLSearchParams` (o `toString` dele é o form-urlencoded).

- [ ] **Step 6: Commit**

```bash
git add frontend/extensao/agente/lib/erros.ts frontend/extensao/agente/lib/rede.ts frontend/extensao/agente/lib/rede.test.ts
git commit -m "extensao eproc: rede do agente (fila, decodificacao, sessao caida)"
```

---

### Task 3: Captcha e sigilo

**Files:**
- Create: `frontend/extensao/agente/lib/captcha.ts`, `frontend/extensao/agente/lib/sigilo.ts`, `frontend/extensao/agente/lib/captcha-sigilo.test.ts`, `frontend/extensao/agente/lib/har.test.ts`

**Interfaces:**
- Consumes: `ErroEproc` (Task 2).
- Produces:
  - `captchaLiberado(resposta: unknown): boolean`; `exigirCaptchaLiberado(resposta: unknown): void` (lança `CAPTCHA`)
  - `itemSigiloso(item: { id_sigilo?: unknown }): boolean`; `nivelDoTitulo(title: string | null | undefined): number | null`; `documentoSigiloso(title: string | null | undefined): boolean`; `separar<T extends { id_sigilo?: unknown }>(itens: T[]): { publicos: T[]; sigilosos: number }`; `exigirPublico(item: { id_sigilo?: unknown }): void` (lança `SIGILOSO`)

- [ ] **Step 1: Escrever os testes**

`frontend/extensao/agente/lib/captcha-sigilo.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { captchaLiberado, exigirCaptchaLiberado } from './captcha.ts'
import { ErroEproc } from './erros.ts'
import { documentoSigiloso, exigirPublico, itemSigiloso, nivelDoTitulo, separar } from './sigilo.ts'

const LIBERADO = { captcha: { estado: 'ativo', validade: 'valido', codigo_estado: 1, codigo_validade: 1, captcha_imagem: 'false' } }
const com = (mudanca: object) => ({ captcha: { ...LIBERADO.captcha, ...mudanca } })

test('captcha: só passa sem desafio visual e com validade 1', () => {
  assert.equal(captchaLiberado(LIBERADO), true)
  assert.equal(captchaLiberado(com({ codigo_validade: '1' })), true) // número em string também vale
  for (const r of [com({ captcha_imagem: 'true' }), com({ captcha_imagem: false }), com({ codigo_validade: 2 }), { captcha: {} }, {}, null, 'x']) {
    assert.equal(captchaLiberado(r), false, JSON.stringify(r))
  }
})

test('captcha: exigir lança CAPTCHA', () => {
  assert.doesNotThrow(() => exigirCaptchaLiberado(LIBERADO))
  assert.throws(() => exigirCaptchaLiberado(com({ captcha_imagem: 'true' })), (e) => e instanceof ErroEproc && e.tipo === 'CAPTCHA')
})

test('sigilo de item de lista: só "0" é público; ausente conta como sigiloso', () => {
  assert.equal(itemSigiloso({ id_sigilo: '0' }), false)
  assert.equal(itemSigiloso({ id_sigilo: 0 }), false)
  assert.equal(itemSigiloso({ id_sigilo: '1' }), true)
  assert.equal(itemSigiloso({}), true)
})

test('sigilo de documento pelo title', () => {
  const t = (n: string) => 'DESPACHO/DECISÃO 1\nSem Sigilo (Nível ' + n + ')\n31.87KB'
  assert.equal(nivelDoTitulo(t('0')), 0)
  assert.equal(nivelDoTitulo(t('2')), 2)
  assert.equal(nivelDoTitulo('NIVEL 3'), 3)
  assert.equal(nivelDoTitulo('sem informação'), null)
  assert.equal(documentoSigiloso(t('0')), false)
  assert.equal(documentoSigiloso(t('1')), true)
  assert.equal(documentoSigiloso('sem informação'), true) // na dúvida, não sai
  assert.equal(documentoSigiloso(null), true)
})

test('separar: públicos na ordem original, sigilosos só contados', () => {
  const r = separar([{ id_sigilo: '0', n: 'a' }, { id_sigilo: '1', n: 'b' }, { id_sigilo: '0', n: 'c' }])
  assert.deepEqual(r.publicos.map((x) => x.n), ['a', 'c'])
  assert.equal(r.sigilosos, 1)
  assert.deepEqual(separar([]), { publicos: [], sigilosos: 0 })
})

test('exigirPublico lança SIGILOSO', () => {
  assert.doesNotThrow(() => exigirPublico({ id_sigilo: '0' }))
  assert.throws(() => exigirPublico({ id_sigilo: '5' }), (e) => e instanceof ErroEproc && e.tipo === 'SIGILOSO')
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test extensao/agente/lib/captcha-sigilo.test.ts`
Expected: FAIL, módulos não encontrados.

- [ ] **Step 3: Implementar**

`frontend/extensao/agente/lib/captcha.ts`:

```ts
import { ErroEproc } from './erros.ts'

// Único estado conhecido como "sem desafio" (HAR da JFRS, 25/09/2026). Todo o
// resto é tratado como desafio: a extensão para e manda o humano resolver na
// aba. Nunca tenta resolver nem contornar.
export function captchaLiberado(resposta: unknown): boolean {
  const c = (resposta as { captcha?: { captcha_imagem?: unknown; codigo_validade?: unknown } } | null)?.captcha
  return !!c && c.captcha_imagem === 'false' && Number(c.codigo_validade) === 1
}

export function exigirCaptchaLiberado(resposta: unknown): void {
  if (!captchaLiberado(resposta)) throw new ErroEproc('CAPTCHA')
}
```

`frontend/extensao/agente/lib/sigilo.ts`:

```ts
import { ErroEproc } from './erros.ts'

// Decisão do spec: sigiloso nunca sai do navegador. Na dúvida (campo ausente,
// title sem nível), conta como sigiloso — errar para o lado de não enviar.
export const itemSigiloso = (item: { id_sigilo?: unknown }) => String(item.id_sigilo) !== '0'

export function nivelDoTitulo(title: string | null | undefined): number | null {
  const m = /n[ií]vel\s+(\d+)/i.exec(title ?? '')
  return m ? Number(m[1]) : null
}

export const documentoSigiloso = (title: string | null | undefined) => (nivelDoTitulo(title) ?? 1) > 0

export function separar<T extends { id_sigilo?: unknown }>(itens: T[]) {
  const publicos = itens.filter((i) => !itemSigiloso(i))
  return { publicos, sigilosos: itens.length - publicos.length }
}

export function exigirPublico(item: { id_sigilo?: unknown }): void {
  if (itemSigiloso(item)) throw new ErroEproc('SIGILOSO')
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test extensao/agente/lib/captcha-sigilo.test.ts`
Expected: PASS, 6 testes.

- [ ] **Step 5: Teste contra o HAR real, se existir**

`frontend/extensao/agente/lib/har.test.ts`:

```ts
// Roda contra qualquer *.har na raiz do repositório. HAR NUNCA entra no git
// (tem nome real de parte), então na máquina de quem não tem o arquivo este
// teste é pulado e diz isso.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { captchaLiberado } from './captcha.ts'
import { separar } from './sigilo.ts'

const RAIZ = join(import.meta.dirname, '..', '..', '..', '..')
const hars = readdirSync(RAIZ).filter((f) => f.endsWith('.har'))

type Entrada = { request: { url: string; method: string }; response: { content: { text?: string } } }

for (const har of hars) {
  const entradas: Entrada[] = JSON.parse(readFileSync(join(RAIZ, har), 'utf8')).log.entries
  const respostas = (trecho: string) =>
    entradas.filter((e) => e.request.url.includes(trecho) && e.request.method === 'POST').map((e) => JSON.parse(e.response.content.text ?? 'null'))

  test(`${har}: estado de captcha gravado é reconhecido`, (t) => {
    const r = respostas('verifica_estado_captcha')
    if (!r.length) return t.skip('sem verifica_estado_captcha neste HAR')
    for (const x of r) assert.equal(captchaLiberado(x), x.captcha.captcha_imagem === 'false' && Number(x.captcha.codigo_validade) === 1)
  })

  test(`${har}: busca por documento separa públicos e sigilosos sem perder nenhum`, (t) => {
    const r = respostas('processos_consulta_por_documento_identificacao')
    if (!r.length) return t.skip('sem busca por documento neste HAR')
    for (const x of r) {
      assert.ok(Array.isArray(x.resultados), 'resultados ausente seria LAYOUT')
      const s = separar(x.resultados)
      assert.equal(s.publicos.length + s.sigilosos, x.resultados.length)
    }
  })
}

test('HAR presente na raiz', (t) => {
  if (!hars.length) t.skip('nenhum *.har na raiz; testes contra tráfego real pulados')
})
```

Run: `node --test extensao/agente/lib/har.test.ts`
Expected: com o `blu arquivo.har` na raiz, 3 testes PASS. Sem HAR, 1 teste marcado como `skip`.

- [ ] **Step 6: Commit**

```bash
git add frontend/extensao/agente/lib/captcha.ts frontend/extensao/agente/lib/sigilo.ts frontend/extensao/agente/lib/captcha-sigilo.test.ts frontend/extensao/agente/lib/har.test.ts
git commit -m "extensao eproc: guardas de captcha e sigilo, com teste contra HAR local"
```

---

### Task 4: `estado()` e o agente

**Files:**
- Create: `frontend/extensao/agente/lib/estado.ts`, `frontend/extensao/agente/lib/estado.test.ts`, `frontend/extensao/agente/lib/despacho.ts`, `frontend/extensao/agente/lib/despacho.test.ts`
- Modify: `frontend/extensao/agente/index.ts` (substitui o provisório)

**Interfaces:**
- Consumes: `ErroEproc`, `TipoErro` (Task 2).
- Produces:
  - `type Instancia = '1g' | '2g'`
  - `type Estado = { logado: boolean; instancia: Instancia | null; processo: string | null }`
  - `type DocLike = { querySelector(sel: string): unknown; body: { className: string } | null }`
  - `lerEstado(doc: DocLike, url: string): Estado`
  - `type Pedido = { tipo: 'estado' }`
  - `type Resposta = { ok: true; estado: Estado } | { ok: false; erro: TipoErro }`
  - `responder(msg: unknown, doc: DocLike, url: string): Promise<Resposta | null>` (`null` = mensagem que não é para o agente)

- [ ] **Step 1: Escrever os testes**

`frontend/extensao/agente/lib/estado.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lerEstado, type DocLike } from './estado.ts'

// Documento falso: só os seletores que lerEstado consulta. Os valores vêm do
// HTML gravado da JFRS (btn-encerrar-sessao, body.instancia-1g).
const doc = (op: { sair?: boolean; senha?: boolean; classe?: string }): DocLike => ({
  body: { className: op.classe ?? 'bootstrap-styles instancia-1g' },
  querySelector: (sel: string) =>
    (sel === '#btn-encerrar-sessao' && op.sair) || (sel === 'input[type="password"]' && op.senha) ? {} : null,
})
const DETALHE = 'https://eproc1g.tjsc.jus.br/eproc/controlador.php?acao=processo_selecionar&acao_origem=x&num_processo=50012345620204047100&hash=abc'
const CONSULTA = 'https://eproc1g.tjsc.jus.br/eproc/controlador.php?acao=processo_consultar&hash=abc'

test('logado, num detalhe de processo', () => {
  assert.deepEqual(lerEstado(doc({ sair: true }), DETALHE), { logado: true, instancia: '1g', processo: '50012345620204047100' })
})

test('logado, fora de processo', () => {
  assert.deepEqual(lerEstado(doc({ sair: true }), CONSULTA), { logado: true, instancia: '1g', processo: null })
})

test('tela de login', () => {
  assert.deepEqual(lerEstado(doc({ senha: true, classe: '' }), 'https://eproc1g.tjsc.jus.br/eproc/index.php'), { logado: false, instancia: null, processo: null })
})

test('botão sair e campo de senha juntos: não logado (fail closed)', () => {
  assert.equal(lerEstado(doc({ sair: true, senha: true }), CONSULTA).logado, false)
})

test('instância: classe do body; sem classe, pelo host', () => {
  assert.equal(lerEstado(doc({ sair: true, classe: 'instancia-2g' }), CONSULTA).instancia, '2g')
  assert.equal(lerEstado(doc({ sair: true, classe: '' }), 'https://eproc2g.tjsc.jus.br/eproc/controlador.php?acao=x').instancia, '2g')
  assert.equal(lerEstado(doc({ sair: true, classe: '' }), CONSULTA).instancia, '1g')
})

test('num_processo inválido ou em outra ação não é processo aberto', () => {
  const u = (q: string) => 'https://eproc1g.tjsc.jus.br/eproc/controlador.php?' + q
  assert.equal(lerEstado(doc({ sair: true }), u('acao=processo_selecionar&num_processo=123')).processo, null)
  assert.equal(lerEstado(doc({ sair: true }), u('acao=outra&num_processo=50012345620204047100')).processo, null)
})
```

`frontend/extensao/agente/lib/despacho.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { responder } from './despacho.ts'
import type { DocLike } from './estado.ts'

const logado: DocLike = { body: { className: 'instancia-1g' }, querySelector: (s) => (s === '#btn-encerrar-sessao' ? {} : null) }
const URL_OK = 'https://eproc1g.tjsc.jus.br/eproc/controlador.php?acao=processo_consultar'

test('estado responde ok com o estado lido', async () => {
  assert.deepEqual(await responder({ tipo: 'estado' }, logado, URL_OK), { ok: true, estado: { logado: true, instancia: '1g', processo: null } })
})

test('mensagem que não é do agente devolve null (não responde)', async () => {
  assert.equal(await responder({ tipo: 'outra' }, logado, URL_OK), null)
  assert.equal(await responder(undefined, logado, URL_OK), null)
  assert.equal(await responder('estado', logado, URL_OK), null)
})

test('exceção inesperada vira LAYOUT, nunca escapa', async () => {
  const quebrado = { body: null, querySelector: () => { throw new Error('boom') } } as DocLike
  assert.deepEqual(await responder({ tipo: 'estado' }, quebrado, URL_OK), { ok: false, erro: 'LAYOUT' })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test extensao/agente/lib/estado.test.ts extensao/agente/lib/despacho.test.ts`
Expected: FAIL, módulos não encontrados.

- [ ] **Step 3: Implementar `estado.ts`**

`frontend/extensao/agente/lib/estado.ts`:

```ts
// Só lê a página atual — nenhuma requisição. Seletores vistos no HTML da JFRS
// (HAR de 25/09/2026); conferir contra o TJSC quando o HAR de lá chegar
// (docs/eproc-roteiro-captura.md).
export type Instancia = '1g' | '2g'
export type Estado = { logado: boolean; instancia: Instancia | null; processo: string | null }
export type DocLike = { querySelector(sel: string): unknown; body: { className: string } | null }

export function lerEstado(doc: DocLike, url: string): Estado {
  // Botão "sair" só existe logado; campo de senha só na tela de login. Os
  // dois juntos é tela que não conhecemos: não logado.
  const logado = !!doc.querySelector('#btn-encerrar-sessao') && !doc.querySelector('input[type="password"]')
  if (!logado) return { logado: false, instancia: null, processo: null }
  const u = new URL(url)
  const classe = /\binstancia-(1g|2g)\b/.exec(doc.body?.className ?? '')?.[1] as Instancia | undefined
  const instancia: Instancia = classe ?? (u.hostname.startsWith('eproc2g.') ? '2g' : '1g')
  const num = u.searchParams.get('num_processo') ?? ''
  const processo = u.searchParams.get('acao') === 'processo_selecionar' && /^\d{20}$/.test(num) ? num : null
  return { logado, instancia, processo }
}
```

- [ ] **Step 4: Implementar `despacho.ts`**

`frontend/extensao/agente/lib/despacho.ts`:

```ts
import { ErroEproc, type TipoErro } from './erros.ts'
import { lerEstado, type DocLike, type Estado } from './estado.ts'

// Protocolo painel -> agente. B, C e D acrescentam tipos aqui.
export type Pedido = { tipo: 'estado' }
export type Resposta = { ok: true; estado: Estado } | { ok: false; erro: TipoErro }

export async function responder(msg: unknown, doc: DocLike, url: string): Promise<Resposta | null> {
  if ((msg as Pedido | null)?.tipo !== 'estado') return null
  try {
    return { ok: true, estado: lerEstado(doc, url) }
  } catch (e) {
    // Erro conhecido passa adiante; qualquer outro é tela que mudou.
    return { ok: false, erro: e instanceof ErroEproc ? e.tipo : 'LAYOUT' }
  }
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test extensao/agente/lib/estado.test.ts extensao/agente/lib/despacho.test.ts`
Expected: PASS, 9 testes.

- [ ] **Step 6: O content script de verdade**

`frontend/extensao/agente/index.ts`:

```ts
import { responder } from './lib/despacho.ts'

// Guarda contra listener duplicado: o manifest injeta este arquivo, e o painel
// reinjeta com chrome.scripting.executeScript em aba aberta antes da instalação.
const g = globalThis as { __agenteEprocSegundoCerebro?: boolean }
if (!g.__agenteEprocSegundoCerebro) {
  g.__agenteEprocSegundoCerebro = true
  chrome.runtime.onMessage.addListener((msg, _remetente, responderAoPainel) => {
    const pronto = responder(msg, document, location.href)
    pronto.then((r) => r && responderAoPainel(r))
    // true mantém o canal aberto para a resposta assíncrona — mas só quando a
    // mensagem é nossa, senão o remetente espera para sempre.
    return (msg as { tipo?: unknown } | null)?.tipo === 'estado'
  })
}
```

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add frontend/extensao/agente
git commit -m "extensao eproc: agente responde estado (logado, instancia, processo)"
```

---

### Task 5: Fluxo do painel e mensagens

**Files:**
- Create: `frontend/extensao/painel/fluxo.ts`, `frontend/extensao/painel/fluxo.test.ts`, `frontend/extensao/painel/mensagens.ts`, `frontend/extensao/painel/mensagens.test.ts`

**Interfaces:**
- Consumes: `TipoErro` (Task 2); `Estado`, `Resposta` (Task 4).
- Produces:
  - `type ErroPainel = TipoErro | 'SISTEMA_FORA'`
  - `type Aba = { id: number; ativa: boolean; descartada: boolean }`
  - `type Deps = { eu(): Promise<{ email: string }>; abasEproc(): Promise<Aba[]>; recarregar(id: number): Promise<void>; enviar(id: number, msg: { tipo: 'estado' }): Promise<unknown> }`
  - `type Tela = { tipo: 'sem_login' } | { tipo: 'erro'; erro: ErroPainel } | { tipo: 'pronto'; email: string; abaId: number; estado: Estado }`
  - `abrirPainel(deps: Deps): Promise<Tela>`
  - `type Acao = 'abrir_login' | 'abrir_eproc' | 'focar_eproc' | 'tentar_de_novo' | 'copiar_diagnostico' | null`
  - `MENSAGENS: Record<ErroPainel, { texto: string; acao: Acao }>`
  - `diagnostico(erro: ErroPainel, versao: string): string`

A reinjeção do agente ("Receiving end does not exist") fica **dentro** de `enviar`, no adaptador da Task 6. O fluxo não precisa saber disso.

- [ ] **Step 1: Escrever os testes**

`frontend/extensao/painel/fluxo.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrirPainel, type Aba, type Deps } from './fluxo.ts'

const ESTADO = { logado: true, instancia: '1g', processo: '50012345620204047100' } as const
const aba = (id: number, extra: Partial<Aba> = {}): Aba => ({ id, ativa: false, descartada: false, ...extra })

function deps(extra: Partial<Deps> = {}) {
  const chamadas: string[] = []
  const d: Deps = {
    eu: async () => ({ email: 'adv@exemplo.com.br' }),
    abasEproc: async () => [aba(7)],
    recarregar: async (id) => { chamadas.push('recarregar ' + id) },
    enviar: async (id) => { chamadas.push('enviar ' + id); return { ok: true, estado: ESTADO } },
    ...extra,
  }
  return { d, chamadas }
}
const erroHttp = (status: number) => Object.assign(new Error('http'), { status })

test('caminho feliz', async () => {
  const { d } = deps()
  assert.deepEqual(await abrirPainel(d), { tipo: 'pronto', email: 'adv@exemplo.com.br', abaId: 7, estado: ESTADO })
})

test('401 da nossa API: sem login, e não olha o eproc', async () => {
  const { d, chamadas } = deps({ eu: async () => { throw erroHttp(401) } })
  assert.deepEqual(await abrirPainel(d), { tipo: 'sem_login' })
  assert.deepEqual(chamadas, [])
})

test('nossa API fora (500 ou rede): SISTEMA_FORA, não "entre no sistema"', async () => {
  for (const falha of [erroHttp(500), new TypeError('Failed to fetch')]) {
    const { d } = deps({ eu: async () => { throw falha } })
    assert.deepEqual(await abrirPainel(d), { tipo: 'erro', erro: 'SISTEMA_FORA' })
  }
})

test('sem aba do eproc', async () => {
  const { d } = deps({ abasEproc: async () => [] })
  assert.deepEqual(await abrirPainel(d), { tipo: 'erro', erro: 'SEM_ABA_EPROC' })
})

test('várias abas: prefere a ativa; descartada é recarregada antes', async () => {
  const { d, chamadas } = deps({ abasEproc: async () => [aba(1), aba(2, { ativa: true, descartada: true }), aba(3)] })
  const t = await abrirPainel(d)
  assert.equal(t.tipo === 'pronto' && t.abaId, 2)
  assert.deepEqual(chamadas, ['recarregar 2', 'enviar 2'])
})

test('nenhuma ativa: usa a primeira', async () => {
  const { d, chamadas } = deps({ abasEproc: async () => [aba(4), aba(5)] })
  await abrirPainel(d)
  assert.deepEqual(chamadas, ['enviar 4'])
})

test('agente diz não logado', async () => {
  const { d } = deps({ enviar: async () => ({ ok: true, estado: { logado: false, instancia: null, processo: null } }) })
  assert.deepEqual(await abrirPainel(d), { tipo: 'erro', erro: 'NAO_LOGADO' })
})

test('agente devolve erro conhecido', async () => {
  const { d } = deps({ enviar: async () => ({ ok: false, erro: 'CAPTCHA' }) })
  assert.deepEqual(await abrirPainel(d), { tipo: 'erro', erro: 'CAPTCHA' })
})

test('resposta fora do formato (agente antigo, undefined, erro inventado): LAYOUT', async () => {
  for (const r of [undefined, null, 'x', { ok: true }, { ok: false, erro: 'INVENTADO' }, { ok: true, estado: { logado: 'sim' } }]) {
    const { d } = deps({ enviar: async () => r })
    assert.deepEqual(await abrirPainel(d), { tipo: 'erro', erro: 'LAYOUT' }, JSON.stringify(r))
  }
})

test('aba some ou não responde mesmo após reinjeção: SEM_ABA_EPROC', async () => {
  const { d } = deps({ enviar: async () => { throw new Error('No tab with id: 7') } })
  assert.deepEqual(await abrirPainel(d), { tipo: 'erro', erro: 'SEM_ABA_EPROC' })
})
```

`frontend/extensao/painel/mensagens.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diagnostico, MENSAGENS } from './mensagens.ts'

const TODOS = ['NAO_LOGADO', 'CAPTCHA', 'LAYOUT', 'EPROC_FORA', 'SIGILOSO', 'SEM_ABA_EPROC', 'SISTEMA_FORA'] as const

test('todo erro tem texto e ação definidos', () => {
  assert.deepEqual(Object.keys(MENSAGENS).sort(), [...TODOS].sort())
  for (const e of TODOS) assert.ok(MENSAGENS[e].texto.length > 10, e)
})

test('textos e ações do spec', () => {
  assert.deepEqual(MENSAGENS.SEM_ABA_EPROC, { texto: 'Abra o eproc do TJSC e faça login.', acao: 'abrir_eproc' })
  assert.deepEqual(MENSAGENS.SIGILOSO.acao, null)
  assert.deepEqual(MENSAGENS.LAYOUT.acao, 'copiar_diagnostico')
  assert.deepEqual(MENSAGENS.CAPTCHA.acao, 'tentar_de_novo')
})

test('diagnóstico não carrega dado de processo', () => {
  const d = diagnostico('LAYOUT', '0.1.0')
  assert.match(d, /0\.1\.0/)
  assert.match(d, /LAYOUT/)
  assert.doesNotMatch(d, /\d{20}/)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test extensao/painel/fluxo.test.ts extensao/painel/mensagens.test.ts`
Expected: FAIL, módulos não encontrados.

- [ ] **Step 3: Implementar `fluxo.ts`**

`frontend/extensao/painel/fluxo.ts`:

```ts
import type { TipoErro } from '../agente/lib/erros.ts'
import type { Estado } from '../agente/lib/estado.ts'

export type ErroPainel = TipoErro | 'SISTEMA_FORA'
export type Aba = { id: number; ativa: boolean; descartada: boolean }
export type Deps = {
  eu(): Promise<{ email: string }>
  abasEproc(): Promise<Aba[]>
  recarregar(id: number): Promise<void>
  enviar(id: number, msg: { tipo: 'estado' }): Promise<unknown>
}
export type Tela =
  | { tipo: 'sem_login' }
  | { tipo: 'erro'; erro: ErroPainel }
  | { tipo: 'pronto'; email: string; abaId: number; estado: Estado }

const ERROS_DO_AGENTE: readonly string[] = ['NAO_LOGADO', 'CAPTCHA', 'LAYOUT', 'EPROC_FORA', 'SIGILOSO', 'SEM_ABA_EPROC']
const erro = (e: ErroPainel): Tela => ({ tipo: 'erro', erro: e })

function estadoValido(x: unknown): x is Estado {
  const e = x as Estado | null
  return !!e && typeof e.logado === 'boolean'
}

export async function abrirPainel(d: Deps): Promise<Tela> {
  let email: string
  try {
    email = (await d.eu()).email
  } catch (e) {
    // Só 401 é "entre no sistema". Servidor fora não é falta de login, e dizer
    // que é mandaria o advogado para uma tela de login que também não abre.
    return (e as { status?: number }).status === 401 ? { tipo: 'sem_login' } : erro('SISTEMA_FORA')
  }

  const abas = await d.abasEproc()
  const aba = abas.find((a) => a.ativa) ?? abas[0]
  if (!aba) return erro('SEM_ABA_EPROC')

  let r: unknown
  try {
    if (aba.descartada) await d.recarregar(aba.id)
    r = await d.enviar(aba.id, { tipo: 'estado' })
  } catch {
    return erro('SEM_ABA_EPROC') // aba fechada no meio, ou sem resposta mesmo reinjetando
  }

  const resp = r as { ok?: unknown; erro?: unknown; estado?: unknown } | null
  if (resp?.ok === false && typeof resp.erro === 'string' && ERROS_DO_AGENTE.includes(resp.erro)) return erro(resp.erro as TipoErro)
  if (resp?.ok !== true || !estadoValido(resp.estado)) return erro('LAYOUT')
  if (!resp.estado.logado) return erro('NAO_LOGADO')
  return { tipo: 'pronto', email, abaId: aba.id, estado: resp.estado }
}
```

- [ ] **Step 4: Implementar `mensagens.ts`**

`frontend/extensao/painel/mensagens.ts`:

```ts
import type { ErroPainel } from './fluxo.ts'

export type Acao = 'abrir_login' | 'abrir_eproc' | 'focar_eproc' | 'tentar_de_novo' | 'copiar_diagnostico' | null

// Textos da tabela "Erros na tela" do spec. Record<ErroPainel, ...> faz o tsc
// recusar erro novo sem mensagem.
export const MENSAGENS: Record<ErroPainel, { texto: string; acao: Acao }> = {
  SISTEMA_FORA: { texto: 'O nosso sistema não respondeu. Tente de novo em instantes.', acao: 'tentar_de_novo' },
  SEM_ABA_EPROC: { texto: 'Abra o eproc do TJSC e faça login.', acao: 'abrir_eproc' },
  NAO_LOGADO: { texto: 'Sua sessão no eproc caiu. Entre de novo no eproc.', acao: 'focar_eproc' },
  CAPTCHA: {
    texto: 'O eproc pediu uma verificação. Faça uma consulta manual na aba do eproc e tente de novo.',
    acao: 'tentar_de_novo',
  },
  SIGILOSO: {
    texto: 'Este processo está em sigilo. Por segurança, a extensão não envia processos sigilosos para análise.',
    acao: null,
  },
  LAYOUT: { texto: 'O eproc mudou e a extensão não reconheceu a tela. Avise o suporte.', acao: 'copiar_diagnostico' },
  EPROC_FORA: { texto: 'O eproc não respondeu.', acao: 'tentar_de_novo' },
}

// Vai para o suporte: versão e erro, nunca número de processo nem nome.
export const diagnostico = (erro: ErroPainel, versao: string) =>
  `Segundo Cérebro — eproc ${versao}\nerro: ${erro}\nprimitiva: estado\nnavegador: ${globalThis.navigator?.userAgent ?? '?'}`
```

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test extensao/painel/fluxo.test.ts extensao/painel/mensagens.test.ts`
Expected: PASS, 13 testes.

- [ ] **Step 6: Commit**

```bash
git add frontend/extensao/painel/fluxo.ts frontend/extensao/painel/fluxo.test.ts frontend/extensao/painel/mensagens.ts frontend/extensao/painel/mensagens.test.ts
git commit -m "extensao eproc: fluxo de abertura do painel e mensagens de erro"
```

---

### Task 6: Painel ligado ao Chrome

**Files:**
- Create: `frontend/extensao/painel/chrome.ts`, `frontend/extensao/painel/Painel.tsx`, `frontend/extensao/painel/painel.css`
- Modify: `frontend/extensao/painel/main.tsx` (substitui o provisório)

**Interfaces:**
- Consumes: `abrirPainel`, `Deps`, `Tela` (Task 5); `MENSAGENS`, `diagnostico`, `Acao` (Task 5); `EPROC_HOSTS` (Task 1); `get` de `frontend/src/api.ts`.
- Produces: `depsChrome: Deps`; `executar(acao: Acao): Promise<void>`; `<Painel/>`.

Esta task não tem teste automatizado, porque só envolve `chrome.*` e UI. A verificação é `tsc`, build e o checklist manual da Task 8.

- [ ] **Step 1: Adaptadores**

`frontend/extensao/painel/chrome.ts`:

```ts
import { get } from '../../src/api.ts'
import { EPROC_HOSTS } from '../manifest.ts'
import type { Acao } from './mensagens.ts'
import type { Deps } from './fluxo.ts'

const EPROC_RE = /^https:\/\/eproc[12]g\.tjsc\.jus\.br\//
const AGENTE_AUSENTE = /Receiving end does not exist|Could not establish connection/i

async function esperarCarregar(id: number, limiteMs = 40000) {
  const inicio = Date.now()
  while (Date.now() - inicio < limiteMs) {
    const aba = await chrome.tabs.get(id)
    // 'complete' sozinho não basta: aba recém-criada reporta complete da
    // about:blank antes de navegar (armadilha 1 do guia).
    if (aba.status === 'complete' && EPROC_RE.test(aba.url ?? '')) return
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error('o eproc demorou demais para abrir')
}

export const depsChrome: Deps = {
  eu: () => get<{ email: string }>('/api/eu'),
  async abasEproc() {
    const abas = await chrome.tabs.query({ url: EPROC_HOSTS })
    return abas.filter((a) => a.id !== undefined).map((a) => ({ id: a.id!, ativa: a.active, descartada: a.discarded }))
  },
  async recarregar(id) {
    await chrome.tabs.reload(id)
    await esperarCarregar(id)
  },
  async enviar(id, msg) {
    try {
      return await chrome.tabs.sendMessage(id, msg)
    } catch (e) {
      // Aba aberta antes de instalar/atualizar a extensão não tem o agente.
      if (!AGENTE_AUSENTE.test(String((e as Error)?.message))) throw e
      await chrome.scripting.executeScript({ target: { tabId: id }, files: ['agente.js'] })
      return await chrome.tabs.sendMessage(id, msg)
    }
  },
}

export async function executar(acao: Acao) {
  const base = import.meta.env.VITE_API_BASE as string
  if (acao === 'abrir_login') await chrome.tabs.create({ url: base + '/' })
  if (acao === 'abrir_eproc') await chrome.tabs.create({ url: 'https://eproc1g.tjsc.jus.br/' })
  if (acao === 'focar_eproc') {
    const [aba] = await chrome.tabs.query({ url: EPROC_HOSTS })
    if (aba?.id !== undefined) await chrome.tabs.update(aba.id, { active: true })
    else await chrome.tabs.create({ url: 'https://eproc1g.tjsc.jus.br/' })
  }
}
```

- [ ] **Step 2: Tela**

`frontend/extensao/painel/Painel.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react'
import { executar, depsChrome } from './chrome.ts'
import { abrirPainel, type Tela } from './fluxo.ts'
import { diagnostico, MENSAGENS } from './mensagens.ts'

const VERSAO = chrome.runtime.getManifest().version
const formatar = (n: string) => n.replace(/^(\d{7})(\d{2})(\d{4})(\d)(\d{2})(\d{4})$/, '$1-$2.$3.$4.$5.$6')

export function Painel() {
  const [tela, setTela] = useState<Tela | null>(null)
  const carregar = useCallback(() => {
    setTela(null)
    abrirPainel(depsChrome).then(setTela, () => setTela({ tipo: 'erro', erro: 'LAYOUT' }))
  }, [])
  useEffect(carregar, [carregar])

  if (!tela) return <main className="painel"><p className="meta">Verificando…</p></main>

  if (tela.tipo === 'sem_login') {
    return (
      <main className="painel">
        <p>Entre no sistema para usar a extensão.</p>
        <button onClick={() => executar('abrir_login')}>Entrar no sistema</button>
        <button className="secundario" onClick={carregar}>Verificar de novo</button>
      </main>
    )
  }

  if (tela.tipo === 'erro') {
    const m = MENSAGENS[tela.erro]
    return (
      <main className="painel">
        <p role="alert">{m.texto}</p>
        {m.acao === 'tentar_de_novo' && <button onClick={carregar}>Tentar de novo</button>}
        {m.acao === 'abrir_eproc' && <button onClick={() => executar('abrir_eproc')}>Abrir o eproc</button>}
        {m.acao === 'focar_eproc' && <button onClick={() => executar('focar_eproc')}>Ir para o eproc</button>}
        {m.acao === 'copiar_diagnostico' && (
          <button onClick={() => navigator.clipboard.writeText(diagnostico(tela.erro, VERSAO))}>Copiar diagnóstico</button>
        )}
        {m.acao !== 'tentar_de_novo' && <button className="secundario" onClick={carregar}>Verificar de novo</button>}
      </main>
    )
  }

  const { estado, email } = tela
  return (
    <main className="painel">
      <p className="meta">{email}</p>
      <p>eproc do TJSC · {estado.instancia === '2g' ? '2º grau' : '1º grau'}</p>
      {estado.processo ? (
        <p>Processo aberto: <strong>{formatar(estado.processo)}</strong></p>
      ) : (
        <p className="meta">Nenhum processo aberto nesta aba.</p>
      )}
      <button className="secundario" onClick={carregar}>Atualizar</button>
    </main>
  )
}
```

`frontend/extensao/painel/painel.css`:

```css
body {
  margin: 0;
  background: var(--papel);
  color: var(--tinta);
  font: 14px/1.5 system-ui, sans-serif;
}

.painel {
  display: grid;
  gap: 12px;
  padding: 16px;
}

.painel p {
  margin: 0;
}

.meta {
  color: var(--tinta-3);
}

.painel button {
  justify-self: start;
  padding: 6px 12px;
  border: 1px solid var(--selo);
  border-radius: 4px;
  background: var(--selo);
  color: var(--papel);
  cursor: pointer;
}

.painel button.secundario {
  background: transparent;
  color: var(--selo);
}
```

`frontend/extensao/painel/main.tsx`:

```tsx
import { createRoot } from 'react-dom/client'
import '../../src/estilo/tokens.css'
import './painel.css'
import { Painel } from './Painel.tsx'

createRoot(document.getElementById('raiz')!).render(<Painel />)
```

- [ ] **Step 3: Checagem**

Run: `npx tsc --noEmit`
Expected: sem erros.

Run: `npx stylelint "extensao/**/*.css"`
Expected: sem erros. Se a config do stylelint reclamar de alguma regra, ajuste o CSS, não a config.

Run: `$env:EXT_API_BASE='http://localhost:5173'; npm run build:extensao`
Expected: build ok. `extensao/dist/agente.js` não contém `import ` no topo (é IIFE): `Select-String -Path extensao/dist/agente.js -Pattern '^import ' ` não encontra nada.

- [ ] **Step 4: Commit**

```bash
git add frontend/extensao/painel
git commit -m "extensao eproc: painel lateral ligado ao chrome"
```

---

### Task 7: Política de privacidade

**Files:**
- Create: `frontend/public/privacidade.html`

A página é um arquivo estático público: o Vite copia `public/` para `dist/`, e o FastAPI serve arquivo real de `dist/` sem login (`api/app.py:1164-1171`).

- [ ] **Step 1: Escrever a página**

`frontend/public/privacidade.html`:

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Privacidade — Segundo Cérebro</title>
    <style>
      body { margin: 0; background: #faf8f4; color: #1f1d1a; font: 16px/1.6 Georgia, serif; }
      main { max-width: 42rem; margin: 0 auto; padding: 32px 16px; }
      h1, h2 { font-weight: normal; }
      td, th { border-top: 1px solid #e2dcd1; padding: 8px 8px 8px 0; text-align: left; vertical-align: top; }
      table { border-collapse: collapse; width: 100%; }
    </style>
  </head>
  <body>
    <main>
      <h1>Privacidade da extensão Segundo Cérebro — eproc</h1>
      <p>Versão de 29/09/2026.</p>

      <h2>O que a extensão nunca faz</h2>
      <ul>
        <li>Não lê, não guarda e não envia cookies, senhas, códigos de verificação (2FA) ou qualquer credencial do eproc. As
          requisições ao eproc acontecem dentro da própria aba do eproc, e o navegador cuida da sessão.</li>
        <li>Não envia processos nem documentos em sigilo ou segredo de justiça.</li>
        <li>Não peticiona, não movimenta, não abre intimações e não altera nada no eproc.</li>
        <li>Não tenta resolver nem contornar verificações do eproc (captcha).</li>
        <li>Não vende dados e não os usa para anúncios.</li>
      </ul>

      <h2>O que sai do seu navegador, e para onde</h2>
      <table>
        <tr><th>Quando</th><th>O que é enviado</th><th>Para onde</th></tr>
        <tr><td>Ao abrir o painel</td><td>O cookie de sessão do nosso sistema, para confirmar a sua conta. Nenhum dado do eproc.</td><td>Nosso servidor</td></tr>
      </table>
      <p>Cada nova função da extensão acrescenta a sua linha a esta tabela antes de ser liberada.</p>

      <h2>Quem pode usar</h2>
      <p>A extensão só funciona com uma conta criada pela nossa equipe. Sem conta, ela não lê nada do eproc.</p>

      <h2>Contato</h2>
      <p>Dúvidas sobre dados pessoais: pelo contato do escritório responsável pela sua conta.</p>
    </main>
  </body>
</html>
```

- [ ] **Step 2: Verificar**

Run: `npm run build`
Expected: `dist/privacidade.html` existe.

Com a API rodando sobre o `dist` (`python -m uvicorn api.app:app --port 8000` na raiz), abra `http://127.0.0.1:8000/privacidade.html` numa janela anônima.
Expected: a página abre sem pedir login.

- [ ] **Step 3: Commit**

```bash
git add frontend/public/privacidade.html
git commit -m "politica de privacidade da extensao eproc"
```

---

### Task 8: `verificar.bat`, documentação e checklist manual

**Files:**
- Modify: `verificar.bat` (bloco `=== frontend (frontend/) ===`), `COMO_RODAR.md` (seção nova no fim)

- [ ] **Step 1: `verificar.bat` roda os testes e o build da extensão**

Em `verificar.bat`, dentro do `if exist "frontend\node_modules" (`, depois da linha do `stylelint`, acrescente:

```bat
  call npm run --silent test:extensao || set FALHOU=1
  set EXT_API_BASE=http://localhost:5173
  call npm run --silent build:extensao || set FALHOU=1
```

Run (raiz): `verificar.bat`
Expected: termina com `TUDO OK`, e a saída mostra os testes da extensão passando (e o HAR sendo usado ou pulado).

- [ ] **Step 2: Como gerar e carregar**

No fim de `COMO_RODAR.md`, acrescente:

````markdown
## Extensão do eproc (Chrome)

Gerar, a partir de `frontend/`, apontando para a API que a extensão vai usar:

```powershell
$env:EXT_API_BASE='https://seu-dominio'   # em dev: http://localhost:5173
npm run build:extensao
```

Carregar: `chrome://extensions` → ligar **Modo do desenvolvedor** → **Carregar sem compactação** →
escolher `frontend/extensao/dist`. Depois de cada build, clique em **Recarregar** no cartão da extensão.

Em dev, entre no sistema por `http://localhost:5173` no mesmo Chrome: o cookie de `localhost` vale para
qualquer porta, e a extensão chama a API pelo proxy do Vite.

Testes: `npm run test:extensao`. Se houver um `*.har` na raiz, parte dos testes roda contra ele; o HAR
nunca entra no git.
````

- [ ] **Step 3: Checklist manual (Pedro, sem eproc)**

Com `web.bat` rodando e a extensão carregada (build com `EXT_API_BASE=http://localhost:5173`):

1. Deslogado do sistema, clique no ícone. Expected: o painel abre com "Entre no sistema para usar a extensão.".
2. Entre no sistema em `http://localhost:5173` e clique em "Verificar de novo". Expected: "Abra o eproc do TJSC e faça login.". **Este é o risco nº 1 do spec: o cookie chegou.** Se continuar pedindo login, ative o plano B do spec (token por instalação) antes de seguir.
3. Pare a API e clique em "Verificar de novo". Expected: "O nosso sistema não respondeu…".

Registre o resultado do item 2 na mensagem de commit do Step 5.

- [ ] **Step 4: Checklist manual (na call com o advogado, eproc do TJSC)**

Os itens 2 a 4 da seção Testes do spec, seguindo o bloco "Se sobrar tempo" de `docs/eproc-roteiro-captura.md`:

1. Com o eproc aberto numa aba antiga (de antes de carregar a extensão), o painel responde (reinjeção funcionou).
2. Logado, num processo: o painel mostra a instância e o número formatado.
3. Logado, fora de processo: "Nenhum processo aberto nesta aba.".
4. Depois de sair do eproc: "Sua sessão no eproc caiu…".
5. Com uma aba do eproc aberta, clique em **Recarregar** no cartão da extensão em `chrome://extensions`, volte à aba e abra o painel: ele deve responder sem precisar atualizar a página do eproc (é o caso de atualização da extensão).

Se algum seletor falhar (por exemplo, o painel diz `NAO_LOGADO` estando logado), o HAR gravado na mesma call mostra o HTML certo. Ajuste `estado.ts` e o teste dele.

- [ ] **Step 5: Commit**

```bash
git add verificar.bat COMO_RODAR.md
git commit -m "verificar.bat roda testes e build da extensao; como carregar"
```

---

## Fora deste plano (de propósito)

- **Ícones e ficha da loja** (imagens, descrição, formulário de justificativa e declaração de dados). Só na hora de publicar. Carregar sem compactação não exige ícone.
- **Teste ponta a ponta com Chromium e eproc falso**: entra a partir de B, conforme o spec.
- **Plano B do cookie (token por instalação)**: só se o item 2 do checklist da Task 8 falhar.
