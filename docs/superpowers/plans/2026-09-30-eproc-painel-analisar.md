# Extensão eproc — fluxo "Analisar este processo" no painel (B, lado do painel): plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ligar o painel lateral da extensão ao sistema no fluxo do subprojeto B: o advogado, com um processo aberto, escolhe as peças, monta o caso, roda a consulta (com a `origem` do eproc) acompanhando o andamento ao vivo e vê o resumo do prognóstico, com botão para abrir a consulta completa no site.

**Architecture:** Contract-first, como no plano anterior. O painel só conhece duas interfaces: `Fonte` (o que o agente lê do eproc: capa, lista de peças, texto de uma peça) e `ApiAnalise` (o que o painel usa do nosso servidor). As primitivas de rede da `Fonte` dependem do HAR do TJSC e ficam para outro plano; aqui a `Fonte` real **não existe**, então no painel de verdade o botão "Analisar" nem aparece. A página de demonstração implementa as duas interfaces com dados fictícios e mostra o fluxo inteiro sem login e sem eproc. Toda a lógica é em módulos puros testados com `node --test`; só a tela React e o cliente real do servidor não têm teste de Node (são verificados por `tsc`, `stylelint` e o build).

**Tech Stack:** TypeScript (só sintaxe apagável: Node 25 roda `.ts` direto), React 19, `node --test`, Vite.

**Specs:** `docs/superpowers/specs/2026-09-29-eproc-analisar-processo-design.md` (seção "Fluxo") e `docs/superpowers/specs/2026-09-29-eproc-extensao-base-design.md`. Plano anterior (núcleos puros que este usa): `docs/superpowers/plans/2026-09-29-eproc-b-c-nucleos-sem-har.md`.

### O que fica de fora

- A `Fonte` real (primitivas `processo`, `eventos`, `documento` que leem o HTML do eproc do TJSC) e a ligação do botão no painel de verdade (`main.tsx` passaria `fonte` e `apiReal`): depende do HAR do TJSC.
- Teste manual no Chrome: por decisão do usuário, **todo o teste manual fica para o final**. Os testes automatizados de cada tarefa (TDD) rodam normalmente.
- Conversa sobre o processo, nota e feedback no painel, análise em lote: ver `docs/eproc-features-futuras.md`.

## Global Constraints

- Nenhum dado real de processo em código, teste, commit ou relatório: só os dados fictícios do guia (CNPJ `11.222.333/0001-81`, CPF `529.982.247-25`, processo `50012345620208240023`, OAB `OAB/SC 12.345`). Nunca abrir nem commitar `*.har` (há um na raiz, com dados reais).
- CPF, CNPJ e OAB saem do texto antes de ele sair do navegador: `montarCaso` e `corpoDaConsulta` minimizam, e isso vale também para texto editado à mão.
- Peça sigilosa nunca é lida, marcada nem enviada. Falha de uma peça não derruba a montagem; sessão caída e captcha derrubam.
- O prognóstico que o servidor se recusou a cravar (pediu um lado, "não decido", sem percentual) **nunca** aparece como percentual no painel.
- Não haver botão que não funciona: sem `fonte` e sem `api`, o painel de produção não mostra "Analisar este processo". A página de demonstração só entra no build com `EXT_DEMO=1`.
- TypeScript apagável apenas: sem `enum`, `namespace` ou parâmetro-propriedade. Imports com extensão `.ts`; imports só de tipos com `import type` (um `import` de valor de `frontend/src/api.ts` quebra no Node, porque esse arquivo usa parâmetro-propriedade e `import.meta.env`).
- Comentários em português, no estilo do código vizinho.
- Git: um commit por tarefa, só com os arquivos da tarefa (`git add <caminhos>`, nunca `git add -A`). **Nunca** `git commit --amend`, `rebase` ou `reset`. Mensagem em português, em minúsculas, seguida de linha em branco e de `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (use `git commit -F <arquivo>` com o arquivo fora do repositório).
- Comandos do frontend rodam em `frontend/`; no Windows use Git Bash. Não iniciar, parar nem mexer em servidores (a API e o Vite de desenvolvimento já estão rodando).

## Review Focus

1. **Stream SSE cortado em qualquer ponto** (inclusive no meio de um caractere UTF-8) e com CRLF: não pode perder nem duplicar evento. Teste na Task 1.
2. **Caso editado à mão com CPF/OAB** depois da montagem: tem de ser minimizado de novo antes de ir à rede. Teste na Task 2.
3. **Peça sigilosa marcada à mão** (ou por clique): nunca entra. Teste na Task 3.
4. **Uma peça que falha** não derruba as outras, mas sessão caída e captcha derrubam tudo. Teste na Task 4.
5. **Prognóstico recusado pelo servidor** nunca vira percentual. Teste na Task 5.

---

## Estrutura de arquivos

```
frontend/extensao/painel/
  analisar/
    sse.ts                 (novo) leitor de text/event-stream + lerStream
    andamento.ts           (novo) reducer do andamento da consulta
    sse.test.ts            (novo) cobre sse.ts e andamento.ts
    fonte.ts               (novo) interface Fonte e DocumentoLido
    apiAnalise.ts          (novo) interface ApiAnalise, LIMITE_ENVIO, corpoDaConsulta
    corpo.test.ts          (novo)
    lista.ts               (novo) lista de peças, marcar/desmarcar
    lista.test.ts          (novo)
    ler.ts                 (novo) lê o texto das peças marcadas
    ler.test.ts            (novo)
    resumo.ts              (novo) resumo do prognóstico
    cerebro.ts             (novo) escolhe o cérebro pelo relator
    resumo.test.ts         (novo) cobre resumo.ts e cerebro.ts
    demo-analise.ts        (novo) Fonte e ApiAnalise fictícias
    demo-analise.test.ts   (novo) o fluxo inteiro, ponta a ponta, em Node
    apiReal.ts             (novo) ApiAnalise de verdade (sem teste de Node)
    Analisar.tsx           (novo) a tela do fluxo
  caso/pecas.ts            (mod)  Papel ganha 'outra'
  caso/montagem.ts         (mod)  rótulo de 'outra'
  caso/montagem.test.ts    (mod)  teste de 'outra'
  Painel.tsx               (mod)  botão "Analisar este processo" quando há fonte e api
  chrome.ts                (mod)  abrirAba
  demo.tsx                 (mod)  passa fonte e api fictícias
  painel.css               (mod)  estilos da tela
COMO_RODAR.md              (mod)  uma frase sobre o fluxo na demonstração
```

`npm run test:extensao` já roda `extensao/**/*.test.ts` e `npx tsc --noEmit` já inclui `extensao`. Total esperado ao fim: **107 testes do início + 35 = 142**.

---

### Task 1: Leitor de SSE e andamento da consulta

**Files:**
- Create: `frontend/extensao/painel/analisar/sse.ts`, `frontend/extensao/painel/analisar/andamento.ts`
- Test: `frontend/extensao/painel/analisar/sse.test.ts` (cobre os dois módulos)

**Interfaces:**
- Produces: `type EventoSse = { id: number; tipo: string; dados: unknown }`; `criarLeitorSse(aoEvento): (pedaco: string) => void`; `lerStream(corpo: ReadableStream<Uint8Array>, aoEvento): Promise<void>`; `type Andamento`; `andamentoInicial(): Andamento`; `aplicar(a: Andamento, e: EventoSse): Andamento`.

- [ ] **Step 1: Escrever os testes que falham**

`frontend/extensao/painel/analisar/sse.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aplicar, andamentoInicial } from './andamento.ts'
import { criarLeitorSse, lerStream, type EventoSse } from './sse.ts'

const coletar = () => {
  const eventos: EventoSse[] = []
  return { eventos, ler: criarLeitorSse((e) => eventos.push(e)) }
}
const bloco = (id: number, tipo: string, dados: unknown) => `id: ${id}\nevent: ${tipo}\ndata: ${JSON.stringify(dados)}\n\n`

test('um evento completo vira {id, tipo, dados}', () => {
  const { eventos, ler } = coletar()
  ler(bloco(7, 'no_inicio', { no: 'triagem' }))
  assert.deepEqual(eventos, [{ id: 7, tipo: 'no_inicio', dados: { no: 'triagem' } }])
})

test('pedaços cortados em qualquer ponto dão o mesmo resultado', () => {
  const texto = bloco(1, 'inicio', {}) + bloco(2, 'log', { linha: 'olá ação' }) + bloco(3, 'fim', { segundos: 12.5 })
  const inteiro = coletar()
  inteiro.ler(texto)
  for (let corte = 1; corte < texto.length; corte += 7) {
    const c = coletar()
    c.ler(texto.slice(0, corte))
    c.ler(texto.slice(corte))
    assert.deepEqual(c.eventos, inteiro.eventos, 'corte em ' + corte)
  }
  assert.equal(inteiro.eventos.length, 3)
})

test('comentários (ping, conectado), blocos sem event e data ilegível são ignorados', () => {
  const { eventos, ler } = coletar()
  ler(': conectado\n\n: ping\n\n')
  ler('id: 1\ndata: {"x":1}\n\n') // sem event
  ler('id: 2\nevent: log\ndata: {isso não é json\n\n') // JSON inválido
  ler(bloco(3, 'fim', {}))
  assert.deepEqual(eventos.map((e) => e.tipo), ['fim'])
})

test('CRLF e várias linhas data são aceitos', () => {
  const { eventos, ler } = coletar()
  ler('id: 4\r\nevent: log\r\ndata: {"a":\r\ndata: 1}\r\n\r\n')
  assert.deepEqual(eventos, [{ id: 4, tipo: 'log', dados: { a: 1 } }])
})

test('lerStream entrega eventos de um ReadableStream cortado no meio de um caractere UTF-8', async () => {
  const bytes = new TextEncoder().encode(bloco(1, 'log', { linha: 'decisão' }) + bloco(2, 'fim', {}))
  const corte = bytes.indexOf(0xc3) + 1 // no meio do "ã" de "decisão"
  const corpo = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes.slice(0, corte))
      c.enqueue(bytes.slice(corte))
      c.close()
    },
  })
  const eventos: EventoSse[] = []
  await lerStream(corpo, (e) => eventos.push(e))
  assert.deepEqual(eventos.map((e) => e.tipo), ['log', 'fim'])
  assert.deepEqual(eventos[0].dados, { linha: 'decisão' })
})

test('andamento: nós, custo e fim', () => {
  let a = andamentoInicial()
  const ev = (tipo: string, dados: unknown): EventoSse => ({ id: 1, tipo, dados })
  a = aplicar(a, ev('no_inicio', { no: 'triagem' }))
  assert.equal(a.no, 'triagem')
  a = aplicar(a, ev('no_fim', { no: 'triagem', custos: [{ custo_usd: 0.01 }, { custo_usd: 0.02 }] }))
  assert.equal(a.no, null)
  assert.ok(Math.abs(a.custo_usd - 0.03) < 1e-9)
  a = aplicar(a, ev('no_inicio', { no: 'recuperar' }))
  a = aplicar(a, ev('no_inicio', { no: 'recuperar' })) // repetido não duplica
  assert.deepEqual(a.nos, ['triagem', 'recuperar'])
  a = aplicar(a, ev('fim', { segundos: 40, custo_usd: 0.5 }))
  assert.deepEqual([a.concluido, a.no, a.segundos, a.custo_usd, a.erro], [true, null, 40, 0.5, null])
})

test('andamento: erro marca conclusão com mensagem; "inicio" zera a tentativa mas mantém o custo', () => {
  const ev = (tipo: string, dados: unknown): EventoSse => ({ id: 1, tipo, dados })
  let a = aplicar(andamentoInicial(), ev('no_fim', { no: 'x', custos: [{ custo_usd: 0.1 }] }))
  a = aplicar(a, ev('erro', { mensagem: 'sem crédito', retomavel: true }))
  assert.deepEqual([a.concluido, a.erro, a.retomavel], [true, 'sem crédito', true])
  a = aplicar(a, ev('inicio', {}))
  assert.deepEqual([a.concluido, a.erro, a.retomavel], [false, null, false])
  assert.ok(Math.abs(a.custo_usd - 0.1) < 1e-9)
})

test('andamento: payload estranho não quebra nem inventa estado', () => {
  const ev = (tipo: string, dados: unknown): EventoSse => ({ id: 1, tipo, dados })
  const base = andamentoInicial()
  assert.deepEqual(aplicar(base, ev('no_inicio', null)), base)
  assert.deepEqual(aplicar(base, ev('no_inicio', { no: 7 })), base)
  assert.deepEqual(aplicar(base, ev('log', { linha: 'x' })), base)
  assert.equal(aplicar(base, ev('erro', {})).erro, 'a consulta falhou')
  assert.equal(aplicar(base, ev('no_fim', { no: 'a', custos: 'x' })).custo_usd, 0)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run (em `frontend/`): `node --test extensao/painel/analisar/sse.test.ts`
Expected: FAIL, `Cannot find module ... andamento.ts`.

- [ ] **Step 3: Implementar**

`frontend/extensao/painel/analisar/sse.ts`:

```ts
// Leitura de `text/event-stream` (o formato do GET /api/consultas/{thread}/eventos).
// O painel é uma página chrome-extension://, e o EventSource nativo não manda o
// cookie de sessão de forma confiável entre origens; por isso o stream é lido
// com fetch + ReadableStream e este parser, que é puro e testável.

export type EventoSse = { id: number; tipo: string; dados: unknown }

/**
 * Devolve uma função que recebe pedaços de texto (na ordem em que chegam, cortados
 * em qualquer ponto) e chama `aoEvento` a cada evento completo. Comentários
 * (`: ping`) e blocos sem `event:` são ignorados; `data:` ilegível (JSON inválido)
 * também: o servidor sempre manda JSON, então isso só pode ser lixo no meio do caminho.
 */
export function criarLeitorSse(aoEvento: (e: EventoSse) => void): (pedaco: string) => void {
  let resto = ''
  return (pedaco) => {
    resto += pedaco.replace(/\r\n?/g, '\n')
    let fim: number
    while ((fim = resto.indexOf('\n\n')) >= 0) {
      const bloco = resto.slice(0, fim)
      resto = resto.slice(fim + 2)
      let id = 0
      let tipo = ''
      const dados: string[] = []
      for (const linha of bloco.split('\n')) {
        if (linha.startsWith(':')) continue
        const i = linha.indexOf(':')
        const campo = i < 0 ? linha : linha.slice(0, i)
        const valor = i < 0 ? '' : linha.slice(i + 1).replace(/^ /, '')
        if (campo === 'id') id = Number(valor) || 0
        else if (campo === 'event') tipo = valor
        else if (campo === 'data') dados.push(valor)
      }
      if (!tipo) continue
      try {
        aoEvento({ id, tipo, dados: JSON.parse(dados.join('\n')) })
      } catch {
        /* data ilegível: ignora */
      }
    }
  }
}

/** Lê o corpo de uma resposta SSE até ele fechar, entregando cada evento. */
export async function lerStream(corpo: ReadableStream<Uint8Array>, aoEvento: (e: EventoSse) => void): Promise<void> {
  const ler = criarLeitorSse(aoEvento)
  const decodificador = new TextDecoder()
  const leitor = corpo.getReader()
  for (;;) {
    const { done, value } = await leitor.read()
    if (done) break
    ler(decodificador.decode(value, { stream: true }))
  }
}
```

`frontend/extensao/painel/analisar/andamento.ts`:

```ts
import type { EventoSse } from './sse.ts'

// O que o painel mostra enquanto a consulta roda: em que nó está, quanto custou,
// se terminou. Mesma semântica de `useEventos` (frontend/src/hooks.ts), mais curta:
// o painel não desenha o grafo.
export type Andamento = {
  no: string | null // nó em execução agora
  nos: string[] // nós já iniciados, na ordem
  concluido: boolean
  erro: string | null
  retomavel: boolean
  segundos: number | null
  custo_usd: number
}

export const andamentoInicial = (): Andamento => ({
  no: null, nos: [], concluido: false, erro: null, retomavel: false, segundos: null, custo_usd: 0,
})

type Payload = Record<string, unknown>
const texto = (v: unknown) => (typeof v === 'string' ? v : '')
const numero = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

export function aplicar(a: Andamento, e: EventoSse): Andamento {
  const p = (e.dados && typeof e.dados === 'object' ? e.dados : {}) as Payload
  switch (e.tipo) {
    case 'inicio':
      // uma retomada publica 'inicio' de novo e o replay vem do começo: zera a
      // tentativa anterior (o erro velho não pode ficar na tela), mas mantém o custo
      return { ...andamentoInicial(), custo_usd: a.custo_usd }
    case 'no_inicio': {
      const no = texto(p.no)
      return no ? { ...a, no, nos: a.nos.includes(no) ? a.nos : [...a.nos, no] } : a
    }
    case 'no_fim': {
      const custos = Array.isArray(p.custos) ? (p.custos as Payload[]) : []
      const soma = custos.reduce((s, c) => s + numero(c.custo_usd), 0)
      return { ...a, no: a.no === texto(p.no) ? null : a.no, custo_usd: a.custo_usd + soma }
    }
    case 'fim':
      return { ...a, no: null, concluido: true, segundos: typeof p.segundos === 'number' ? p.segundos : a.segundos,
        custo_usd: typeof p.custo_usd === 'number' ? p.custo_usd : a.custo_usd }
    case 'erro':
      return { ...a, no: null, concluido: true, erro: texto(p.mensagem) || 'a consulta falhou', retomavel: !!p.retomavel }
    default:
      return a // 'log' e o que vier a existir: o painel não mostra
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test extensao/painel/analisar/sse.test.ts`
Expected: PASS, 8 testes.

- [ ] **Step 5: Verificação geral e commit**

Run: `npx tsc --noEmit` (limpo) e `npm run test:extensao` (tudo passa).

```bash
git add frontend/extensao/painel/analisar/sse.ts frontend/extensao/painel/analisar/andamento.ts frontend/extensao/painel/analisar/sse.test.ts
git commit -F <arquivo-com-a-mensagem>   # assunto sugerido: "painel: leitor de SSE e andamento da consulta"
```

---

### Task 2: Contratos do painel e corpo da consulta

**Files:**
- Create: `frontend/extensao/painel/analisar/fonte.ts`, `frontend/extensao/painel/analisar/apiAnalise.ts`
- Test: `frontend/extensao/painel/analisar/corpo.test.ts`

**Interfaces:**
- Consumes: `Capa`, `Peca` (`agente/lib/caso.ts`); `minimizar` (`agente/lib/minimizacao.ts`); `EventoSse` (Task 1); tipos `Consulta`, `ListaCerebros` de `frontend/src/api.ts` (**só** `import type`).
- Produces: `type DocumentoLido`, `type Fonte = { capa(); pecas(); documento(ref) }`; `type Origem`, `type Tese`, `type CorpoConsulta`, `type ApiAnalise`, `LIMITE_ENVIO = 120_000`, `corpoDaConsulta(o)` (lança `Error` se o caso ou o cérebro estiver vazio e `RangeError` se passar de `LIMITE_ENVIO`).

- [ ] **Step 1: Escrever o teste que falha**

`frontend/extensao/painel/analisar/corpo.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { corpoDaConsulta, LIMITE_ENVIO, type Origem } from './apiAnalise.ts'

const ORIGEM: Origem = { eproc: '50012345620208240023', instancia: '1g' }
const base = { texto: 'caso de teste', cerebro: 'rubens-schulz', tese: 'neutra' as const, soPrognostico: false, origem: ORIGEM }

test('o corpo tem exatamente os campos que o servidor lê', () => {
  assert.deepEqual(corpoDaConsulta(base), {
    caso: 'caso de teste', tese: 'neutra', cerebro: 'rubens-schulz', so_prognostico: false, origem: ORIGEM,
  })
  assert.equal(corpoDaConsulta({ ...base, soPrognostico: true, tese: 'reformar' }).so_prognostico, true)
})

test('o texto editado à mão é minimizado de novo e aparado antes de sair', () => {
  const c = corpoDaConsulta({ ...base, texto: '  parte CPF 529.982.247-25, OAB/SC 12.345\n ' })
  assert.equal(c.caso, 'parte CPF [CPF], [OAB]')
})

test('caso vazio e cérebro vazio são recusados antes da rede', () => {
  assert.throws(() => corpoDaConsulta({ ...base, texto: '  \n ' }), /vazio/)
  assert.throws(() => corpoDaConsulta({ ...base, cerebro: '' }), /cérebro/)
})

test('acima do limite do servidor (413) é recusado aqui, com a mensagem de quanto passou', () => {
  assert.doesNotThrow(() => corpoDaConsulta({ ...base, texto: 'a'.repeat(LIMITE_ENVIO) }))
  assert.throws(() => corpoDaConsulta({ ...base, texto: 'a'.repeat(LIMITE_ENVIO + 1) }), (e) => e instanceof RangeError && /120000/.test(e.message))
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run (em `frontend/`): `node --test extensao/painel/analisar/corpo.test.ts`
Expected: FAIL, `Cannot find module ... apiAnalise.ts`.

- [ ] **Step 3: Implementar**

`frontend/extensao/painel/analisar/fonte.ts` (só tipos; sem teste próprio):

```ts
import type { Capa, Peca } from '../../agente/lib/caso.ts'

/** O que uma peça do processo devolve: já em texto (HTML lido na aba) ou um arquivo (PDF...) para o servidor extrair. */
export type DocumentoLido = { tipo: 'texto'; texto: string } | { tipo: 'arquivo'; nome: string; base64: string }

/**
 * O que o painel precisa do agente para analisar o processo aberto na aba.
 * É o contrato que as primitivas de rede da B (plano futuro, dependem do HAR do
 * TJSC) vão implementar; até lá o painel só conhece esta interface, e a página de
 * demonstração a implementa com dados fictícios. Tudo o que sai daqui já vem do
 * agente minimizado (CPF, CNPJ e OAB fora) e sem peça sigilosa.
 */
export type Fonte = {
  capa(): Promise<Capa>
  pecas(): Promise<Peca[]>
  documento(ref: string): Promise<DocumentoLido>
}
```

`frontend/extensao/painel/analisar/apiAnalise.ts`:

```ts
import type { Consulta, ListaCerebros } from '../../../src/api.ts'
import { minimizar } from '../../agente/lib/minimizacao.ts'
import type { EventoSse } from './sse.ts'

export type Origem = { eproc: string; instancia: '1g' | '2g' }
export type Tese = 'neutra' | 'reformar' | 'manter'

/** O corpo de POST /api/consultas (ver `rodar` e `_pedido` em api/app.py). */
export type CorpoConsulta = { caso: string; tese: Tese; cerebro: string; so_prognostico: boolean; origem: Origem }

/** O que o painel usa do nosso servidor. A implementação real fica em apiReal.ts; a demonstração tem a sua. */
export type ApiAnalise = {
  cerebros(): Promise<ListaCerebros>
  /** `busca.max_chars_caso` de GET /api/config: quantos caracteres do caso o pipeline lê. */
  limiteDoCaso(): Promise<number>
  /** PDF e afins -> texto, por POST /api/extrair. */
  extrair(nome: string, base64: string): Promise<string>
  rodar(corpo: CorpoConsulta): Promise<{ thread: string }>
  /** Entrega os eventos da consulta e só resolve quando o servidor fecha o stream. */
  acompanhar(thread: string, aoEvento: (e: EventoSse) => void): Promise<void>
  consulta(thread: string): Promise<Consulta>
  urlDoSite(thread: string): string
}

/** O servidor recusa com 413 acima disto (`MAX_CHARS_CASO` em api/app.py); recusamos antes de enviar. */
export const LIMITE_ENVIO = 120_000

/**
 * Monta o corpo da consulta. O texto é minimizado DE NOVO aqui (é idempotente):
 * o advogado pode ter editado o caso à mão depois da montagem, e este é o último
 * ponto antes de a rede.
 */
export function corpoDaConsulta(o: { texto: string; cerebro: string; tese: Tese; soPrognostico: boolean; origem: Origem }): CorpoConsulta {
  const caso = minimizar(o.texto).trim()
  if (!caso) throw new Error('O caso está vazio.')
  if (!o.cerebro) throw new Error('Escolha o cérebro que vai analisar.')
  if (caso.length > LIMITE_ENVIO) {
    throw new RangeError(`Caso longo demais: ${caso.length} caracteres (máximo ${LIMITE_ENVIO}). Desmarque peças ou corte o texto.`)
  }
  return { caso, tese: o.tese, cerebro: o.cerebro, so_prognostico: o.soPrognostico, origem: o.origem }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test extensao/painel/analisar/corpo.test.ts`
Expected: PASS, 4 testes.

- [ ] **Step 5: Verificação geral e commit**

Run: `npx tsc --noEmit` e `npm run test:extensao`.

```bash
git add frontend/extensao/painel/analisar/fonte.ts frontend/extensao/painel/analisar/apiAnalise.ts frontend/extensao/painel/analisar/corpo.test.ts
git commit -F <arquivo-com-a-mensagem>   # assunto sugerido: "painel: contratos Fonte e ApiAnalise e corpo da consulta minimizado"
```

---

### Task 3: Peças marcadas à mão e a lista do painel

**Files:**
- Modify: `frontend/extensao/painel/caso/pecas.ts`, `frontend/extensao/painel/caso/montagem.ts`, `frontend/extensao/painel/caso/montagem.test.ts`
- Create: `frontend/extensao/painel/analisar/lista.ts`
- Test: `frontend/extensao/painel/analisar/lista.test.ts`

**Interfaces:**
- Consumes: `Peca` (`agente/lib/caso.ts`); `preselecionar`, `bloqueadasPorSigilo`, `Papel` (`caso/pecas.ts`).
- Produces: `Papel` passa a incluir `'outra'` (peça marcada à mão; `preselecionar` nunca a devolve); `type ItemLista = { peca: Peca; papel: Papel; marcada: boolean }`; `prepararLista(pecas): { itens: ItemLista[]; bloqueadas: Papel[] }`; `alternar(itens, ref): ItemLista[]`; `marcadas(itens): { papel: Papel; peca: Peca }[]`.

- [ ] **Step 1: Escrever os testes que falham**

Em `frontend/extensao/painel/caso/montagem.test.ts`, acrescente ao fim:

```ts
test('peça marcada à mão entra com o rótulo OUTRA PEÇA', () => {
  const m = montarCaso(CAPA, [item('outra', 'ATO ORDINATÓRIO 1', 20, 'intime-se')], 20000)
  assert.ok(m.texto.includes('=== OUTRA PEÇA — ATO ORDINATÓRIO 1 (evento 20, 10/03/2025) ===\nintime-se'))
})
```

`frontend/extensao/painel/analisar/lista.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Peca } from '../../agente/lib/caso.ts'
import { TIPOS } from '../caso/pecas.ts'
import { alternar, marcadas, prepararLista } from './lista.ts'

const SENT = TIPOS.sentenca[0], REC = TIPOS.recurso[0], INIC = TIPOS.inicial[0], CONT = TIPOS.contestacao[0]
const p = (tipo: string, evento: number, extra: Partial<Peca> = {}): Peca => ({
  ref: `r${evento}`, tipo, rotulo: `${tipo} ${evento}`, evento, data: '01/01/2025', sigiloso: false, ...extra,
})
const PECAS = [p(INIC, 1), p(CONT, 8), p('ATOORD', 20), p(SENT, 45), p(REC, 52)]

test('a lista vem da mais recente para a mais antiga, com as escolhidas marcadas e as outras não', () => {
  const { itens } = prepararLista(PECAS)
  assert.deepEqual(itens.map((i) => i.peca.evento), [52, 45, 20, 8, 1])
  assert.deepEqual(itens.map((i) => [i.papel, i.marcada]),
    [['recurso', true], ['decisao', true], ['outra', false], ['contestacao', true], ['inicial', true]])
})

test('marcadas: prioridade do papel, e peças à mão depois, da mais antiga para a mais nova', () => {
  let { itens } = prepararLista([...PECAS, p('ATOORD', 30)])
  itens = alternar(alternar(itens, 'r30'), 'r20') // marca duas "outras"
  assert.deepEqual(marcadas(itens).map((m) => `${m.papel}:${m.peca.evento}`),
    ['decisao:45', 'recurso:52', 'inicial:1', 'contestacao:8', 'outra:20', 'outra:30'])
})

test('alternar desmarca e marca de novo, sem mexer na lista original', () => {
  const { itens } = prepararLista(PECAS)
  const sem = alternar(itens, 'r45')
  assert.equal(sem.find((i) => i.peca.ref === 'r45')?.marcada, false)
  assert.equal(itens.find((i) => i.peca.ref === 'r45')?.marcada, true)
  assert.equal(alternar(sem, 'r45').find((i) => i.peca.ref === 'r45')?.marcada, true)
  assert.deepEqual(marcadas(sem).map((m) => m.peca.evento), [52, 1, 8])
})

test('peça sigilosa nunca é marcada, nem à mão; e a tela recebe o aviso do papel bloqueado', () => {
  const pecas = [p(SENT, 45, { sigiloso: true }), p('DESPADEC', 30), p('ATOORD', 20, { sigiloso: true })]
  const { itens, bloqueadas } = prepararLista(pecas)
  assert.deepEqual(bloqueadas, ['decisao'])
  assert.equal(itens.find((i) => i.peca.ref === 'r45')?.marcada, false)
  assert.equal(alternar(itens, 'r45').find((i) => i.peca.ref === 'r45')?.marcada, false)
  assert.equal(alternar(itens, 'r20').find((i) => i.peca.ref === 'r20')?.marcada, false)
  assert.deepEqual(marcadas(itens).map((m) => m.peca.evento), [30])
})

test('lista vazia', () => {
  assert.deepEqual(prepararLista([]), { itens: [], bloqueadas: [] })
  assert.deepEqual(marcadas([]), [])
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run (em `frontend/`): `node --test extensao/painel/caso/montagem.test.ts extensao/painel/analisar/lista.test.ts`
Expected: FAIL. O teste novo de `montagem` falha porque o rótulo de `'outra'` ainda não existe (o texto sai com `undefined` no lugar dele), e `lista.test.ts` falha com `Cannot find module ... lista.ts`.

- [ ] **Step 3: Implementar**

Em `frontend/extensao/painel/caso/pecas.ts`, troque a linha

```ts
export type Papel = 'decisao' | 'recurso' | 'inicial' | 'contestacao'
```

por

```ts
// 'outra' é a peça que o advogado marca à mão; `preselecionar` nunca a devolve.
export type Papel = 'decisao' | 'recurso' | 'inicial' | 'contestacao' | 'outra'
```

Em `frontend/extensao/painel/caso/montagem.ts`, troque

```ts
  contestacao: 'CONTESTAÇÃO',
}
```

por

```ts
  contestacao: 'CONTESTAÇÃO',
  outra: 'OUTRA PEÇA',
}
```

`frontend/extensao/painel/analisar/lista.ts`:

```ts
import type { Peca } from '../../agente/lib/caso.ts'
import { bloqueadasPorSigilo, preselecionar, type Papel } from '../caso/pecas.ts'

export type ItemLista = { peca: Peca; papel: Papel; marcada: boolean }

// Ordem de prioridade do texto montado: o pipeline lê só os primeiros N
// caracteres, então o que menos importa vai para o fim (ver caso/pecas.ts).
const PRIORIDADE: Papel[] = ['decisao', 'recurso', 'inicial', 'contestacao', 'outra']

/**
 * A lista que o advogado vê: todas as peças, da mais recente para a mais antiga (como
 * o eproc mostra), com as escolhidas pela pré-seleção já marcadas. `bloqueadas`
 * diz quais peças-chave estão em sigilo, para a tela avisar.
 */
export function prepararLista(pecas: Peca[]): { itens: ItemLista[]; bloqueadas: Papel[] } {
  const escolhidas = new Map(preselecionar(pecas).map((s) => [s.peca.ref, s.papel]))
  const itens = [...pecas]
    .sort((a, b) => b.evento - a.evento)
    .map((peca) => ({ peca, papel: escolhidas.get(peca.ref) ?? ('outra' as Papel), marcada: escolhidas.has(peca.ref) }))
  return { itens, bloqueadas: bloqueadasPorSigilo(pecas) }
}

/** Liga ou desliga uma peça. Peça sigilosa nunca liga. Devolve uma lista nova. */
export function alternar(itens: ItemLista[], ref: string): ItemLista[] {
  return itens.map((i) => (i.peca.ref === ref && !i.peca.sigiloso ? { ...i, marcada: !i.marcada } : i))
}

/** As peças marcadas, na ordem em que entram no texto: prioridade do papel e, dentro dele, a mais antiga primeiro. */
export function marcadas(itens: ItemLista[]): { papel: Papel; peca: Peca }[] {
  return itens
    .filter((i) => i.marcada && !i.peca.sigiloso)
    .sort((a, b) => PRIORIDADE.indexOf(a.papel) - PRIORIDADE.indexOf(b.papel) || a.peca.evento - b.peca.evento)
    .map(({ papel, peca }) => ({ papel, peca }))
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test extensao/painel/caso/montagem.test.ts extensao/painel/analisar/lista.test.ts`
Expected: PASS (montagem com 10 testes, lista com 5).

- [ ] **Step 5: Verificação geral e commit**

Run: `npx tsc --noEmit` e `npm run test:extensao`.

```bash
git add frontend/extensao/painel/caso/pecas.ts frontend/extensao/painel/caso/montagem.ts frontend/extensao/painel/caso/montagem.test.ts frontend/extensao/painel/analisar/lista.ts frontend/extensao/painel/analisar/lista.test.ts
git commit -F <arquivo-com-a-mensagem>   # assunto sugerido: "painel: lista de pecas com marcacao a mao, sigilosa nunca marca"
```

---

### Task 4: Ler o texto das peças marcadas

**Files:**
- Create: `frontend/extensao/painel/analisar/ler.ts`
- Test: `frontend/extensao/painel/analisar/ler.test.ts`

**Interfaces:**
- Consumes: `ErroEproc` (`agente/lib/erros.ts`); `Peca` (`agente/lib/caso.ts`); `Item` (`caso/montagem.ts`); `Papel` (`caso/pecas.ts`); `Fonte` (Task 2); `ApiAnalise` (Task 2).
- Produces: `type FalhaDePeca = { rotulo: string; motivo: string }`; `lerPecas(fonte: Pick<Fonte,'documento'>, api: Pick<ApiAnalise,'extrair'>, escolhidas): Promise<{ itens: Item[]; falhas: FalhaDePeca[] }>`.

- [ ] **Step 1: Escrever os testes que falham**

`frontend/extensao/painel/analisar/ler.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ErroEproc } from '../../agente/lib/erros.ts'
import type { Peca } from '../../agente/lib/caso.ts'
import type { DocumentoLido } from './fonte.ts'
import { lerPecas } from './ler.ts'

const peca = (evento: number): Peca => ({ ref: `r${evento}`, tipo: 'X', rotulo: `PEÇA ${evento}`, evento, data: '01/01/2025', sigiloso: false })
const escolhidas = [1, 2, 3].map((n) => ({ papel: 'decisao' as const, peca: peca(n) }))
const api = { extrair: async (nome: string, base64: string) => `extraído de ${nome}:${base64}` }
const fonteDe = (f: (ref: string) => Promise<DocumentoLido>) => ({ documento: f })

test('texto direto e arquivo (extraído pelo servidor) entram na ordem recebida', async () => {
  const fonte = fonteDe(async (ref) => (ref === 'r2' ? { tipo: 'arquivo', nome: 'recurso.pdf', base64: 'QUJD' } : { tipo: 'texto', texto: `texto ${ref}` }))
  const { itens, falhas } = await lerPecas(fonte, api, escolhidas)
  assert.deepEqual(itens.map((i) => i.texto), ['texto r1', 'extraído de recurso.pdf:QUJD', 'texto r3'])
  assert.deepEqual(falhas, [])
})

test('uma peça que falha sai do texto com o motivo e não derruba as outras', async () => {
  const fonte = fonteDe(async (ref) => {
    if (ref === 'r1') throw new ErroEproc('SIGILOSO')
    if (ref === 'r2') throw new ErroEproc('LAYOUT', 'seletor x')
    return { tipo: 'texto', texto: 'ok' }
  })
  const { itens, falhas } = await lerPecas(fonte, api, escolhidas)
  assert.deepEqual(itens.map((i) => i.peca.ref), ['r3'])
  assert.deepEqual(falhas, [{ rotulo: 'PEÇA 1', motivo: 'em sigilo' }, { rotulo: 'PEÇA 2', motivo: 'o eproc não devolveu a peça' }])
})

test('erro do servidor na extração do arquivo vira motivo legível', async () => {
  const fonte = fonteDe(async () => ({ tipo: 'arquivo', nome: 'peca.rtf', base64: 'x' }))
  const apiRuim = { extrair: async () => { throw new Error('RTF ainda não é lido aqui') } }
  const { itens, falhas } = await lerPecas(fonte, apiRuim, [escolhidas[0]])
  assert.deepEqual(itens, [])
  assert.deepEqual(falhas, [{ rotulo: 'PEÇA 1', motivo: 'RTF ainda não é lido aqui' }])
})

test('peça sem texto (só espaços) vira falha, não item vazio', async () => {
  const fonte = fonteDe(async () => ({ tipo: 'texto', texto: '  \n ' }))
  const { itens, falhas } = await lerPecas(fonte, api, [escolhidas[0]])
  assert.deepEqual([itens.length, falhas.length], [0, 1])
})

test('sessão caída e captcha derrubam a montagem inteira (continuar não adianta)', async () => {
  for (const tipo of ['NAO_LOGADO', 'CAPTCHA'] as const) {
    const fonte = fonteDe(async () => { throw new ErroEproc(tipo) })
    await assert.rejects(lerPecas(fonte, api, escolhidas), (e) => e instanceof ErroEproc && e.tipo === tipo)
  }
})

test('nenhuma peça marcada: resultado vazio, sem chamar a fonte', async () => {
  let chamou = false
  const fonte = fonteDe(async () => { chamou = true; return { tipo: 'texto', texto: 'x' } })
  assert.deepEqual(await lerPecas(fonte, api, []), { itens: [], falhas: [] })
  assert.equal(chamou, false)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run (em `frontend/`): `node --test extensao/painel/analisar/ler.test.ts`
Expected: FAIL, `Cannot find module ... ler.ts`.

- [ ] **Step 3: Implementar**

`frontend/extensao/painel/analisar/ler.ts`:

```ts
import { ErroEproc } from '../../agente/lib/erros.ts'
import type { Peca } from '../../agente/lib/caso.ts'
import type { Item } from '../caso/montagem.ts'
import type { Papel } from '../caso/pecas.ts'
import type { ApiAnalise } from './apiAnalise.ts'
import type { Fonte } from './fonte.ts'

export type FalhaDePeca = { rotulo: string; motivo: string }

function motivoDaFalha(e: unknown): string {
  if (e instanceof ErroEproc) return e.tipo === 'SIGILOSO' ? 'em sigilo' : 'o eproc não devolveu a peça'
  return e instanceof Error && e.message ? e.message : 'não foi possível ler a peça'
}

/**
 * Lê o texto de cada peça marcada, uma por vez (o agente já serializa as
 * requisições ao eproc). Uma peça que falha sai do texto e entra em `falhas` com o
 * motivo: não derruba a montagem. Sessão caída e captcha derrubam (continuar não
 * adianta: o eproc vai falhar igual em todas) e sobem como ErroEproc.
 */
export async function lerPecas(
  fonte: Pick<Fonte, 'documento'>,
  api: Pick<ApiAnalise, 'extrair'>,
  escolhidas: { papel: Papel; peca: Peca }[],
): Promise<{ itens: Item[]; falhas: FalhaDePeca[] }> {
  const itens: Item[] = []
  const falhas: FalhaDePeca[] = []
  for (const { papel, peca } of escolhidas) {
    try {
      const doc = await fonte.documento(peca.ref)
      const texto = doc.tipo === 'texto' ? doc.texto : await api.extrair(doc.nome, doc.base64)
      if (texto.trim()) itens.push({ papel, peca, texto })
      else falhas.push({ rotulo: peca.rotulo, motivo: 'a peça não tem texto' })
    } catch (e) {
      if (e instanceof ErroEproc && (e.tipo === 'NAO_LOGADO' || e.tipo === 'CAPTCHA')) throw e
      falhas.push({ rotulo: peca.rotulo, motivo: motivoDaFalha(e) })
    }
  }
  return { itens, falhas }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test extensao/painel/analisar/ler.test.ts`
Expected: PASS, 6 testes.

- [ ] **Step 5: Verificação geral e commit**

Run: `npx tsc --noEmit` e `npm run test:extensao`.

```bash
git add frontend/extensao/painel/analisar/ler.ts frontend/extensao/painel/analisar/ler.test.ts
git commit -F <arquivo-com-a-mensagem>   # assunto sugerido: "painel: leitura das pecas marcadas; falha de uma nao derruba as outras"
```

---

### Task 5: Resumo do prognóstico e escolha do cérebro

**Files:**
- Create: `frontend/extensao/painel/analisar/resumo.ts`, `frontend/extensao/painel/analisar/cerebro.ts`
- Test: `frontend/extensao/painel/analisar/resumo.test.ts` (cobre os dois módulos)

**Interfaces:**
- Consumes: tipos `Consulta`, `ListaCerebros` de `frontend/src/api.ts` (**só** `import type`); `cerebroDoRelator` (`caso/relator.ts`).
- Produces: `type Resumo = { titulo: string; linhas: string[]; aviso: string | null }`; `resumirPrognostico(c: Pick<Consulta,'prognostico'|'caso_cortado'|'max_chars_caso'>): Resumo`; `escolherCerebro(relator: string | null, lista: ListaCerebros): { slug: string; aviso: string | null }`.

- [ ] **Step 1: Escrever os testes que falham**

`frontend/extensao/painel/analisar/resumo.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ListaCerebros } from '../../../src/api.ts'
import { escolherCerebro } from './cerebro.ts'
import { resumirPrognostico } from './resumo.ts'

type Entrada = Parameters<typeof resumirPrognostico>[0]
const c = (prognostico: object, extra: object = {}) => ({ prognostico, caso_cortado: false, max_chars_caso: 20000, ...extra }) as Entrada

test('percentual calibrado: título, intervalo, resultado provável e precedentes', () => {
  const r = resumirPrognostico(c({ decide: true, probabilidade_pct: 61.6, intervalo_pct: [48.2, 74.9], resultado_provavel: 'reforma', n_precedentes: 12, calibrado: true }))
  assert.equal(r.titulo, '62% de chance de reforma')
  assert.deepEqual(r.linhas, ['intervalo de 80%: 48% a 75%', 'resultado mais provável: reforma', '12 precedentes analisados', 'Percentual calibrado.'])
  assert.equal(r.aviso, null)
})

test('sem calibrador o número ordena, mas não é probabilidade; um precedente no singular', () => {
  const r = resumirPrognostico(c({ decide: true, probabilidade_pct: 40, n_precedentes: 1, calibrado: false }))
  assert.ok(r.linhas.includes('1 precedente analisado'))
  assert.ok(r.linhas.includes('Sem calibrador treinado: o número ordena, mas não é uma probabilidade.'))
})

test('pediu um lado: nenhum percentual, mesmo que o servidor tenha mandado um', () => {
  const r = resumirPrognostico(c({ enviesado: true, probabilidade_pct: 99, decide: true }))
  assert.equal(r.titulo, 'SEM PROGNÓSTICO — você pediu um lado')
  assert.ok(!JSON.stringify(r).includes('99'))
})

test('"não decido": motivos do servidor, e nenhum percentual', () => {
  const r = resumirPrognostico(c({ decide: false, probabilidade_pct: 70, confianca: { por_que: ['amostra pequena', 'precedentes divididos'] } }))
  assert.equal(r.titulo, 'NÃO DECIDO')
  assert.deepEqual(r.linhas.slice(0, 2), ['amostra pequena', 'precedentes divididos'])
  assert.ok(!JSON.stringify(r).includes('70%'))
  assert.match(resumirPrognostico(c({ decide: false })).linhas[0], /não sustentam/)
})

test('decide mas sem percentual: indisponível, sem inventar número', () => {
  const r = resumirPrognostico(c({ decide: true, probabilidade_pct: null, n_precedentes: 3 }))
  assert.equal(r.titulo, 'Percentual indisponível')
  assert.ok(!r.titulo.includes('%'))
})

test('prognóstico vazio ou ausente: ainda não calculado', () => {
  assert.equal(resumirPrognostico(c({})).titulo, 'O prognóstico ainda não foi calculado.')
  assert.equal(resumirPrognostico({ caso_cortado: false, max_chars_caso: 1 } as unknown as Entrada).titulo, 'O prognóstico ainda não foi calculado.')
})

test('caso cortado: aviso com o limite formatado, em qualquer tipo de resultado', () => {
  const aviso = 'O caso passou de 20.000 caracteres e foi cortado antes da análise: o final não foi lido.'
  assert.equal(resumirPrognostico(c({ decide: true, probabilidade_pct: 50 }, { caso_cortado: true })).aviso, aviso)
  assert.equal(resumirPrognostico(c({ enviesado: true }, { caso_cortado: true })).aviso, aviso)
  assert.equal(resumirPrognostico(c({}, { caso_cortado: true })).aviso, aviso)
})

const lista = (itens: { slug: string; nome: string; ativo?: boolean; tem_indice?: boolean }[], padrao = 'rubens-schulz'): ListaCerebros =>
  ({ padrao, minimo_para_cravar: 1500, itens: itens.map((i) => ({ ativo: true, tem_indice: true, ...i })) }) as unknown as ListaCerebros

test('cérebro do relator quando existe, sem aviso', () => {
  const l = lista([{ slug: 'rubens-schulz', nome: 'Rubens Schulz' }, { slug: 'andre-luiz-dacol', nome: 'André Luiz Dacol' }])
  assert.deepEqual(escolherCerebro('ANDRE LUIZ DACOL', l), { slug: 'andre-luiz-dacol', aviso: null })
})

test('relator sem cérebro: usa o padrão e diz isso', () => {
  const l = lista([{ slug: 'rubens-schulz', nome: 'Rubens Schulz' }])
  assert.deepEqual(escolherCerebro('FULANO DE TAL', l), {
    slug: 'rubens-schulz', aviso: 'O relator deste processo (FULANO DE TAL) não tem cérebro no sistema; a análise usa o perfil de Rubens Schulz.',
  })
  assert.match(escolherCerebro(null, l).aviso ?? '', /não foi identificado/)
})

test('cérebro inativo ou sem índice nunca é escolhido; sem nenhum disponível, slug vazio e aviso', () => {
  const l = lista([{ slug: 'rubens-schulz', nome: 'Rubens Schulz', ativo: false }, { slug: 'x', nome: 'Outro', tem_indice: false }, { slug: 'y', nome: 'Terceiro' }])
  assert.equal(escolherCerebro('Rubens Schulz', l).slug, 'y') // o do relator está inativo: cai no primeiro disponível
  assert.deepEqual(escolherCerebro('Rubens Schulz', lista([{ slug: 'a', nome: 'A', ativo: false }])), { slug: '', aviso: 'Nenhum cérebro está disponível para analisar.' })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run (em `frontend/`): `node --test extensao/painel/analisar/resumo.test.ts`
Expected: FAIL, `Cannot find module ... cerebro.ts`.

- [ ] **Step 3: Implementar**

`frontend/extensao/painel/analisar/resumo.ts`:

```ts
import type { Consulta } from '../../../src/api.ts'

export type Resumo = { titulo: string; linhas: string[]; aviso: string | null }

const pct = (v: number) => `${Math.round(v)}%`
const milhares = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')

/**
 * O prognóstico em poucas linhas, com as MESMAS recusas do site (Consulta.tsx):
 * pediu um lado -> sem percentual, porque a amostra foi escolhida pela tese;
 * "não decido" -> sem percentual, com os motivos; caso cortado -> aviso de que o
 * final não foi lido. Um número que o sistema se recusou a cravar nunca aparece aqui.
 */
export function resumirPrognostico(c: Pick<Consulta, 'prognostico' | 'caso_cortado' | 'max_chars_caso'>): Resumo {
  const p = c.prognostico ?? {}
  const aviso = c.caso_cortado
    ? `O caso passou de ${typeof c.max_chars_caso === 'number' ? milhares(c.max_chars_caso) : 'o limite de'} caracteres e foi cortado antes da análise: o final não foi lido.`
    : null
  if (Object.keys(p).length === 0) return { titulo: 'O prognóstico ainda não foi calculado.', linhas: [], aviso }

  if (p.enviesado) {
    return {
      titulo: 'SEM PROGNÓSTICO — você pediu um lado',
      linhas: [
        'Os precedentes foram escolhidos por sustentarem a tese pedida; um percentual mediria a própria escolha.',
        'Para o número calibrado, rode a mesma consulta em modo neutro.',
      ],
      aviso,
    }
  }
  if (p.decide === false) {
    const motivos = p.confianca?.por_que?.length ? p.confianca.por_que : ['Os dados não sustentam um prognóstico neste caso.']
    return { titulo: 'NÃO DECIDO', linhas: [...motivos, 'As evidências continuam válidas: é com elas que se decide, não com o percentual.'], aviso }
  }

  const linhas: string[] = []
  if (Array.isArray(p.intervalo_pct) && p.intervalo_pct.length === 2) linhas.push(`intervalo de 80%: ${pct(p.intervalo_pct[0])} a ${pct(p.intervalo_pct[1])}`)
  if (typeof p.resultado_provavel === 'string' && p.resultado_provavel) linhas.push(`resultado mais provável: ${p.resultado_provavel}`)
  if (typeof p.n_precedentes === 'number') linhas.push(p.n_precedentes === 1 ? '1 precedente analisado' : `${p.n_precedentes} precedentes analisados`)
  if (typeof p.probabilidade_pct !== 'number') {
    return { titulo: 'Percentual indisponível', linhas: ['O sistema não crava um percentual neste caso; veja as evidências no site.', ...linhas], aviso }
  }
  linhas.push(p.calibrado ? 'Percentual calibrado.' : 'Sem calibrador treinado: o número ordena, mas não é uma probabilidade.')
  return { titulo: `${pct(p.probabilidade_pct)} de chance de reforma`, linhas, aviso }
}
```

`frontend/extensao/painel/analisar/cerebro.ts`:

```ts
import type { ListaCerebros } from '../../../src/api.ts'
import { cerebroDoRelator } from '../caso/relator.ts'

/**
 * Qual cérebro analisa o processo. Só entram cérebros ativos e com índice (um que
 * não tem acervo responderia com zero precedente e pareceria defeito). Se o relator
 * do processo tem cérebro, é ele; senão o padrão do sistema, com um aviso dizendo
 * isso: nunca uma escolha calada.
 */
export function escolherCerebro(relator: string | null, lista: ListaCerebros): { slug: string; aviso: string | null } {
  const disponiveis = lista.itens.filter((c) => c.ativo && c.tem_indice)
  const doRelator = cerebroDoRelator(relator, disponiveis)
  if (doRelator) return { slug: doRelator, aviso: null }
  const padrao = disponiveis.find((c) => c.slug === lista.padrao) ?? disponiveis[0]
  if (!padrao) return { slug: '', aviso: 'Nenhum cérebro está disponível para analisar.' }
  const quem = relator ? `O relator deste processo (${relator}) não tem cérebro no sistema` : 'O relator do processo não foi identificado'
  return { slug: padrao.slug, aviso: `${quem}; a análise usa o perfil de ${padrao.nome}.` }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test extensao/painel/analisar/resumo.test.ts`
Expected: PASS, 10 testes.

- [ ] **Step 5: Verificação geral e commit**

Run: `npx tsc --noEmit` e `npm run test:extensao`.

```bash
git add frontend/extensao/painel/analisar/resumo.ts frontend/extensao/painel/analisar/cerebro.ts frontend/extensao/painel/analisar/resumo.test.ts
git commit -F <arquivo-com-a-mensagem>   # assunto sugerido: "painel: resumo do prognostico com as recusas do site e escolha do cerebro pelo relator"
```

---

### Task 6: Dados da demonstração e o fluxo de ponta a ponta

**Files:**
- Create: `frontend/extensao/painel/analisar/demo-analise.ts`
- Test: `frontend/extensao/painel/analisar/demo-analise.test.ts`

**Interfaces:**
- Consumes: todos os módulos das Tasks 1 a 5 e `montarCaso` (`caso/montagem.ts`).
- Produces: `fonteDemo(pausaMs = 300): Fonte`; `apiDemo(pausaMs = 400): ApiAnalise & { ultimoCorpo(): CorpoConsulta | null }`. Tudo fictício; nada toca rede.

- [ ] **Step 1: Escrever o teste que falha**

`frontend/extensao/painel/analisar/demo-analise.test.ts`:

```ts
// O fluxo inteiro do "Analisar este processo", ponta a ponta, só com as peças puras e
// os dados da demonstração (sem navegador, sem rede). Se um módulo mudar de contrato,
// este teste quebra antes de a apresentação mostrar a coisa errada.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { montarCaso } from '../caso/montagem.ts'
import { aplicar, andamentoInicial } from './andamento.ts'
import { corpoDaConsulta } from './apiAnalise.ts'
import { escolherCerebro } from './cerebro.ts'
import { apiDemo, fonteDemo } from './demo-analise.ts'
import { lerPecas } from './ler.ts'
import { marcadas, prepararLista } from './lista.ts'
import { resumirPrognostico } from './resumo.ts'

test('do processo aberto ao resumo do prognóstico', async () => {
  const fonte = fonteDemo(0)
  const api = apiDemo(0)
  const [capa, pecas, cerebros, limite] = await Promise.all([fonte.capa(), fonte.pecas(), api.cerebros(), api.limiteDoCaso()])

  const { itens, bloqueadas } = prepararLista(pecas)
  assert.deepEqual(bloqueadas, [])
  assert.deepEqual(marcadas(itens).map((m) => m.papel), ['decisao', 'recurso', 'inicial', 'contestacao'])
  const escolha = escolherCerebro(capa.relator, cerebros)
  assert.deepEqual(escolha, { slug: 'rubens-schulz', aviso: null })

  const { itens: lidos, falhas } = await lerPecas(fonte, api, marcadas(itens))
  assert.deepEqual(falhas, [])
  const m = montarCaso(capa, lidos, limite)
  assert.equal(m.excede, false)
  assert.deepEqual([...m.texto.matchAll(/=== ([A-ZÇÃÕ ]+) —/g)].map((x) => x[1]), ['DECISÃO RECORRIDA', 'RECURSO', 'PETIÇÃO INICIAL', 'CONTESTAÇÃO'])
  assert.ok(m.texto.includes('reforma da sentença'), 'o recurso em arquivo deveria ter passado pela extração')
  assert.ok(m.texto.includes('[CNPJ]') && m.texto.includes('[OAB]'))
  assert.ok(!/11\.222\.333|12\.345/.test(m.texto), 'CNPJ e OAB da inicial deveriam ter saído do texto')
  assert.ok(!m.texto.includes('RESERVADO'), 'peça sigilosa não pode entrar')

  const corpo = corpoDaConsulta({ texto: m.texto, cerebro: escolha.slug, tese: 'neutra', soPrognostico: false, origem: { eproc: capa.numero, instancia: '1g' } })
  const { thread } = await api.rodar(corpo)
  assert.deepEqual(api.ultimoCorpo()?.origem, { eproc: '50012345620208240023', instancia: '1g' })

  let andamento = andamentoInicial()
  await api.acompanhar(thread, (e) => { andamento = aplicar(andamento, e) })
  assert.deepEqual([andamento.concluido, andamento.erro], [true, null])
  assert.deepEqual(andamento.nos, ['triagem', 'recuperar', 'triar', 'prognostico'])

  const resumo = resumirPrognostico(await api.consulta(thread))
  assert.equal(resumo.titulo, '62% de chance de reforma')
  assert.equal(resumo.aviso, null)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run (em `frontend/`): `node --test extensao/painel/analisar/demo-analise.test.ts`
Expected: FAIL, `Cannot find module ... demo-analise.ts`.

- [ ] **Step 3: Implementar**

`frontend/extensao/painel/analisar/demo-analise.ts`:

```ts
// Um processo de mentira para apresentar o fluxo "Analisar este processo" sem eproc
// e sem login no sistema (página de demonstração, demo.tsx). Tudo FICTÍCIO: o número
// do processo é o do guia técnico, e o CNPJ e a OAB no texto da inicial estão ali de
// propósito, para a minimização aparecer no caso montado. Nada aqui toca rede.
import type { Capa, Peca } from '../../agente/lib/caso.ts'
import type { Consulta, ListaCerebros } from '../../../src/api.ts'
import { TIPOS } from '../caso/pecas.ts'
import type { ApiAnalise, CorpoConsulta } from './apiAnalise.ts'
import type { DocumentoLido, Fonte } from './fonte.ts'
import type { EventoSse } from './sse.ts'

const NUMERO = '50012345620208240023'
const codificar = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)))
const decodificar = (b: string) => new TextDecoder().decode(Uint8Array.from(atob(b), (c) => c.charCodeAt(0)))
const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

const CAPA: Capa = {
  numero: NUMERO, classe: 'APELAÇÃO CÍVEL', orgao: '6ª Câmara de Direito Comercial', relator: 'RUBENS SCHULZ',
  assuntos: ['PIS', 'Contribuições Sociais'], poloAtivo: ['EMPRESA EXEMPLO LTDA'], poloPassivo: ['UNIÃO - FAZENDA NACIONAL'],
}

const peca = (evento: number, tipo: string, rotulo: string, data: string, sigiloso = false): Peca =>
  ({ ref: `demo-${evento}`, tipo, rotulo, evento, data, sigiloso })

const PECAS: Peca[] = [
  peca(1, TIPOS.inicial[0], 'PETIÇÃO INICIAL 1', '20/05/2020'),
  peca(8, TIPOS.contestacao[0], 'CONTESTAÇÃO 1', '10/08/2020'),
  peca(12, TIPOS.decisao[0], 'DESPACHO/DECISÃO 1', '01/09/2020'),
  peca(20, 'ATOORD', 'ATO ORDINATÓRIO 1', '15/02/2021'),
  peca(30, 'ATOORD', 'DOCUMENTO RESERVADO 1', '20/06/2021', true),
  peca(45, TIPOS.sentenca[0], 'SENTENÇA 1', '10/03/2022'),
  peca(52, TIPOS.recurso[0], 'APELAÇÃO 1', '02/05/2022'),
]

const TEXTOS: Record<string, DocumentoLido> = {
  'demo-1': { tipo: 'texto', texto: 'EMPRESA EXEMPLO LTDA (CNPJ 11.222.333/0001-81), por seu advogado (OAB/SC 12.345), pede a exclusão do ICMS da base de cálculo do PIS e da Cofins e a restituição do que foi pago a maior.' },
  'demo-8': { tipo: 'texto', texto: 'A União sustenta a legalidade da cobrança e pede a improcedência do pedido.' },
  'demo-12': { tipo: 'texto', texto: 'Cite-se a União para contestar no prazo legal.' },
  'demo-20': { tipo: 'texto', texto: 'Intime-se a autora para réplica.' },
  'demo-45': { tipo: 'texto', texto: 'Julgo improcedente o pedido. Condeno a autora ao pagamento das custas e dos honorários advocatícios.' },
  // o recurso vem como arquivo, para o fluxo passar pela extração do servidor
  'demo-52': { tipo: 'arquivo', nome: 'apelacao.pdf', base64: codificar('A apelante requer a reforma da sentença, com base na tese firmada pelo Supremo Tribunal Federal sobre a exclusão do ICMS.') },
}

export function fonteDemo(pausaMs = 300): Fonte {
  return {
    async capa() { await esperar(pausaMs); return CAPA },
    async pecas() { await esperar(pausaMs); return PECAS },
    async documento(ref) {
      await esperar(pausaMs)
      const d = TEXTOS[ref]
      if (!d) throw new Error('peça desconhecida na demonstração')
      return d
    },
  }
}

const CEREBROS = {
  padrao: 'rubens-schulz',
  minimo_para_cravar: 1500,
  itens: [
    { slug: 'rubens-schulz', nome: 'Rubens Schulz', titulo: 'Desembargador', tribunal: 'TJSC', ativo: true, n_decisoes: 20363, n_merito: 15000, tem_indice: true, tem_floresta: true, calibrado: true, crava: true },
    { slug: 'andre-luiz-dacol', nome: 'André Luiz Dacol', titulo: 'Desembargador', tribunal: 'TJSC', ativo: true, n_decisoes: 9000, n_merito: 6000, tem_indice: true, tem_floresta: true, calibrado: true, crava: true },
  ],
} as ListaCerebros

const NOS = ['triagem', 'recuperar', 'triar', 'prognostico']

export function apiDemo(pausaMs = 400): ApiAnalise & { ultimoCorpo(): CorpoConsulta | null } {
  let corpo: CorpoConsulta | null = null
  return {
    async cerebros() { await esperar(pausaMs); return CEREBROS },
    async limiteDoCaso() { return 20000 },
    async extrair(_nome, base64) { await esperar(pausaMs); return decodificar(base64) },
    async rodar(c) { await esperar(pausaMs); corpo = c; return { thread: 'demo-001' } },
    async acompanhar(_thread, aoEvento) {
      const ev = (tipo: string, dados: unknown): EventoSse => ({ id: 0, tipo, dados })
      aoEvento(ev('inicio', {}))
      for (const no of NOS) {
        aoEvento(ev('no_inicio', { no }))
        await esperar(pausaMs * 2)
        aoEvento(ev('no_fim', { no, custos: [{ custo_usd: 0.004 }] }))
      }
      aoEvento(ev('fim', { segundos: 38.2, custo_usd: 0.016 }))
    },
    async consulta() {
      return {
        prognostico: { decide: true, probabilidade_pct: 61.6, intervalo_pct: [48.2, 74.9], resultado_provavel: 'reforma', n_precedentes: 12, calibrado: true },
        caso_cortado: false,
        max_chars_caso: 20000,
      } as unknown as Consulta
    },
    urlDoSite: (thread) => `#consulta-${thread}`,
    ultimoCorpo: () => corpo,
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test extensao/painel/analisar/demo-analise.test.ts`
Expected: PASS, 1 teste.

- [ ] **Step 5: Verificação geral e commit**

Run: `npx tsc --noEmit` e `npm run test:extensao`.

```bash
git add frontend/extensao/painel/analisar/demo-analise.ts frontend/extensao/painel/analisar/demo-analise.test.ts
git commit -F <arquivo-com-a-mensagem>   # assunto sugerido: "painel: processo ficticio da demonstracao e teste do fluxo inteiro em Node"
```

---

### Task 7: A tela, o cliente real e a demonstração

Esta tarefa não tem teste de Node (é tela e cliente de rede). A verificação é `tsc`, `stylelint`, o build de produção e o build de demonstração.

**Files:**
- Create: `frontend/extensao/painel/analisar/apiReal.ts`, `frontend/extensao/painel/analisar/Analisar.tsx`
- Modify: `frontend/extensao/painel/Painel.tsx`, `frontend/extensao/painel/chrome.ts`, `frontend/extensao/painel/demo.tsx`, `frontend/extensao/painel/painel.css`, `COMO_RODAR.md`

**Interfaces:**
- Consumes: todos os módulos das Tasks 1 a 6.
- Produces: `apiReal: ApiAnalise` (usa o cliente do site e o stream por `fetch`); `<Analisar fonte api origem abrir sair />`; `abrirAba(url)` em `chrome.ts`; o `<Painel>` ganha as props opcionais `fonte`, `api` e `abrir`.

- [ ] **Step 1: O cliente real do servidor**

`frontend/extensao/painel/analisar/apiReal.ts`:

```ts
import { get, post, type Consulta, type ListaCerebros } from '../../../src/api.ts'
import type { ApiAnalise } from './apiAnalise.ts'
import { lerStream } from './sse.ts'

// Mesmo padrão do cliente do site (src/api.ts): VITE_API_BASE prefixa a rota e o
// cookie vai com credentials: 'include' (o painel é uma página chrome-extension://).
// Não tem teste de Node: importa o cliente do site, que usa import.meta.env.
const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''

export const apiReal: ApiAnalise = {
  cerebros: () => get<ListaCerebros>('/api/cerebros'),
  async limiteDoCaso() {
    const c = await get<{ busca?: { max_chars_caso?: number } }>('/api/config')
    return c.busca?.max_chars_caso ?? 20000
  },
  async extrair(nome, base64) {
    return (await post<{ texto: string }>('/api/extrair', { nome, dados: base64 })).texto
  },
  rodar: (corpo) => post<{ thread: string }>('/api/consultas', corpo),
  async acompanhar(thread, aoEvento) {
    // fetch + stream, e não EventSource: o cookie entre origens não é confiável nele
    const r = await fetch(`${BASE}/api/consultas/${thread}/eventos`, {
      credentials: 'include',
      headers: { Accept: 'text/event-stream' },
    })
    if (!r.ok || !r.body) throw new Error('Não foi possível acompanhar a consulta.')
    await lerStream(r.body, aoEvento)
  },
  consulta: (thread) => get<Consulta>(`/api/consultas/${thread}`),
  urlDoSite: (thread) => `${BASE}/consulta/${thread}`,
}
```

- [ ] **Step 2: A tela**

`frontend/extensao/painel/analisar/Analisar.tsx`:

```tsx
import { useEffect, useState } from 'react'
import type { Capa } from '../../agente/lib/caso.ts'
import type { ListaCerebros } from '../../../src/api.ts'
import { montarCaso, type Montagem } from '../caso/montagem.ts'
import type { Papel } from '../caso/pecas.ts'
import { aplicar, andamentoInicial, type Andamento } from './andamento.ts'
import { corpoDaConsulta, type ApiAnalise, type Origem, type Tese } from './apiAnalise.ts'
import { escolherCerebro } from './cerebro.ts'
import type { Fonte } from './fonte.ts'
import { lerPecas, type FalhaDePeca } from './ler.ts'
import { alternar, marcadas, prepararLista, type ItemLista } from './lista.ts'
import { resumirPrognostico, type Resumo } from './resumo.ts'

type Lista = { capa: Capa; itens: ItemLista[]; bloqueadas: Papel[]; cerebros: ListaCerebros; aviso: string | null; limite: number }
type Etapa =
  | { t: 'carregando' }
  | { t: 'lista'; l: Lista }
  | { t: 'montando' }
  | { t: 'texto'; l: Lista; m: Montagem; falhas: FalhaDePeca[] }
  | { t: 'rodando'; andamento: Andamento }
  | { t: 'pronto'; thread: string; resumo: Resumo; custo: number }
  | { t: 'erro'; mensagem: string; thread?: string }

const PAPEL: Record<Papel, string> = {
  decisao: 'a decisão recorrida', recurso: 'o recurso', inicial: 'a petição inicial', contestacao: 'a contestação', outra: 'uma peça',
}
const NO: Record<string, string> = {
  triagem: 'lendo o caso', recuperar: 'buscando precedentes', triar: 'escolhendo os análogos', prognostico: 'calculando o prognóstico',
  redigir: 'redigindo a minuta', revisar: 'revisando a minuta', julgar: 'avaliando a minuta',
}
const mensagemDe = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Algo deu errado.')

type Props = { fonte: Fonte; api: ApiAnalise; origem: Origem; abrir: (url: string) => void; sair: () => void }

export function Analisar({ fonte, api, origem, abrir, sair }: Props) {
  const [etapa, setEtapa] = useState<Etapa>({ t: 'carregando' })
  const [texto, setTexto] = useState('')
  const [tese, setTese] = useState<Tese>('neutra')
  const [soPrognostico, setSoPrognostico] = useState(false)
  const [cerebro, setCerebro] = useState('')
  const falhou = (e: unknown, thread?: string) => setEtapa({ t: 'erro', mensagem: mensagemDe(e), thread })

  useEffect(() => {
    let vivo = true
    Promise.all([fonte.capa(), fonte.pecas(), api.cerebros(), api.limiteDoCaso()]).then(
      ([capa, pecas, cerebros, limite]) => {
        if (!vivo) return
        const { itens, bloqueadas } = prepararLista(pecas)
        const escolha = escolherCerebro(capa.relator, cerebros)
        setCerebro(escolha.slug)
        setEtapa({ t: 'lista', l: { capa, itens, bloqueadas, cerebros, aviso: escolha.aviso, limite } })
      },
      (e) => vivo && falhou(e),
    )
    return () => { vivo = false }
  }, [fonte, api])

  async function montar(l: Lista) {
    setEtapa({ t: 'montando' })
    try {
      const { itens, falhas } = await lerPecas(fonte, api, marcadas(l.itens))
      const m = montarCaso(l.capa, itens, l.limite)
      setTexto(m.texto)
      setEtapa({ t: 'texto', l, m, falhas })
    } catch (e) {
      falhou(e)
    }
  }

  async function rodar() {
    let thread: string | undefined
    try {
      const { thread: t } = await api.rodar(corpoDaConsulta({ texto, cerebro, tese, soPrognostico, origem }))
      thread = t
      let andamento = andamentoInicial()
      setEtapa({ t: 'rodando', andamento })
      await api.acompanhar(t, (e) => {
        andamento = aplicar(andamento, e)
        setEtapa({ t: 'rodando', andamento })
      })
      if (andamento.erro) return falhou(new Error(andamento.erro), t)
      if (!andamento.concluido) return falhou(new Error('Perdi a conexão com o acompanhamento. A consulta continua rodando no sistema.'), t)
      setEtapa({ t: 'pronto', thread: t, resumo: resumirPrognostico(await api.consulta(t)), custo: andamento.custo_usd })
    } catch (e) {
      falhou(e, thread)
    }
  }

  switch (etapa.t) {
    case 'carregando':
      return <main className="painel"><p className="meta">Lendo o processo…</p></main>

    case 'montando':
      return <main className="painel"><p className="meta">Lendo as peças…</p></main>

    case 'lista': {
      const { l } = etapa
      const escolhidas = marcadas(l.itens).length
      return (
        <main className="painel">
          <p className="meta">Peças que a análise vai ler</p>
          {l.bloqueadas.map((p) => (
            <p key={p} className="aviso" role="alert">Atenção: {PAPEL[p]} está em sigilo e não pode ser lida.</p>
          ))}
          <ul className="lista">
            {l.itens.map((i) => (
              <li key={i.peca.ref}>
                <label>
                  <input type="checkbox" checked={i.marcada} disabled={i.peca.sigiloso}
                    onChange={() => setEtapa({ t: 'lista', l: { ...l, itens: alternar(l.itens, i.peca.ref) } })} />
                  {' '}{i.peca.rotulo} <span className="meta">· evento {i.peca.evento}{i.peca.sigiloso ? ' · sigilo' : ''}</span>
                </label>
              </li>
            ))}
          </ul>
          <button disabled={escolhidas === 0} onClick={() => montar(l)}>Montar o caso</button>
          <button className="secundario" onClick={sair}>Voltar</button>
        </main>
      )
    }

    case 'texto': {
      const { l, m, falhas } = etapa
      const passou = texto.length > m.limite
      const cerebrosAtivos = l.cerebros.itens.filter((c) => c.ativo && c.tem_indice)
      return (
        <main className="painel">
          {l.aviso && <p className="aviso" role="alert">{l.aviso}</p>}
          {falhas.map((f) => <p key={f.rotulo} className="aviso" role="alert">{f.rotulo}: {f.motivo}; ficou de fora.</p>)}
          <textarea className="caso" value={texto} onChange={(e) => setTexto(e.target.value)} rows={12} aria-label="Texto do caso" />
          <p className={passou ? 'aviso' : 'meta'}>
            {texto.length.toLocaleString('pt-BR')} de {m.limite.toLocaleString('pt-BR')} caracteres
            {passou && `: o sistema lê só os primeiros ${m.limite.toLocaleString('pt-BR')}; o final não entra na análise${m.cortadas.length ? ` (${m.cortadas.join('; ')})` : ''}.`}
          </p>
          <label>Cérebro{' '}
            <select value={cerebro} onChange={(e) => setCerebro(e.target.value)}>
              {cerebrosAtivos.map((c) => <option key={c.slug} value={c.slug}>{c.nome}</option>)}
            </select>
          </label>
          <label>Tese{' '}
            <select value={tese} onChange={(e) => setTese(e.target.value as Tese)}>
              <option value="neutra">neutra</option>
              <option value="reformar">reformar a decisão</option>
              <option value="manter">manter a decisão</option>
            </select>
          </label>
          <label><input type="checkbox" checked={soPrognostico} onChange={(e) => setSoPrognostico(e.target.checked)} /> Só o prognóstico (mais rápido e barato)</label>
          <button disabled={!texto.trim() || !cerebro} onClick={rodar}>Rodar a análise</button>
          <button className="secundario" onClick={() => setEtapa({ t: 'lista', l })}>Voltar às peças</button>
        </main>
      )
    }

    case 'rodando': {
      const { andamento } = etapa
      return (
        <main className="painel">
          <p role="status">{andamento.no ? `Analisando: ${NO[andamento.no] ?? andamento.no}…` : 'Na fila do sistema…'}</p>
          <p className="meta">etapas concluídas: {Math.max(0, andamento.nos.length - (andamento.no ? 1 : 0))}</p>
        </main>
      )
    }

    case 'pronto': {
      const { resumo, thread, custo } = etapa
      return (
        <main className="painel">
          <h2 className="resumo">{resumo.titulo}</h2>
          {resumo.aviso && <p className="aviso" role="alert">{resumo.aviso}</p>}
          {resumo.linhas.map((x) => <p key={x} className="meta">{x}</p>)}
          <p className="meta">custo: US$ {custo.toFixed(4)}</p>
          <button onClick={() => abrir(api.urlDoSite(thread))}>Abrir no sistema</button>
          <button className="secundario" onClick={sair}>Fechar</button>
        </main>
      )
    }

    case 'erro':
      return (
        <main className="painel">
          <p role="alert">{etapa.mensagem}</p>
          {etapa.thread && <button onClick={() => abrir(api.urlDoSite(etapa.thread!))}>Abrir no sistema</button>}
          <button className="secundario" onClick={sair}>Voltar</button>
        </main>
      )
  }
}
```

- [ ] **Step 3: `abrirAba` em `chrome.ts`**

Em `frontend/extensao/painel/chrome.ts`, troque

```ts
export async function executar(acao: Acao) {
```

por

```ts
/** Abre uma página (por exemplo, a consulta no sistema) numa aba nova. */
export const abrirAba = (url: string) => {
  void chrome.tabs.create({ url })
}

export async function executar(acao: Acao) {
```

- [ ] **Step 4: O `Painel` passa a oferecer o botão**

Em `frontend/extensao/painel/Painel.tsx` faça as cinco trocas abaixo, nesta ordem.

(a) Troque

```tsx
import { executar, depsChrome } from './chrome.ts'
import { abrirPainel, type Deps, type Tela } from './fluxo.ts'
import { diagnostico, MENSAGENS } from './mensagens.ts'
```

por

```tsx
import { Analisar } from './analisar/Analisar.tsx'
import type { ApiAnalise } from './analisar/apiAnalise.ts'
import type { Fonte } from './analisar/fonte.ts'
import { abrirAba, executar, depsChrome } from './chrome.ts'
import { abrirPainel, type Deps, type Tela } from './fluxo.ts'
import { diagnostico, MENSAGENS } from './mensagens.ts'
```

(b) Troque

```tsx
// `deps` só muda na página de demonstração (demo.tsx), que injeta um eproc de mentira.
export function Painel({ deps = depsChrome }: { deps?: Deps }) {
  const [tela, setTela] = useState<Tela | null>(null)
```

por

```tsx
// `deps`, `fonte`, `api` e `abrir` só são passados na página de demonstração (demo.tsx),
// que injeta um eproc e um servidor de mentira. No painel de verdade `fonte` fica
// indefinida até as primitivas de rede da B existirem, e sem ela o botão "Analisar"
// nem aparece: nenhum botão que não funciona.
type Props = { deps?: Deps; fonte?: Fonte; api?: ApiAnalise; abrir?: (url: string) => void }

export function Painel({ deps = depsChrome, fonte, api, abrir = abrirAba }: Props) {
  const [tela, setTela] = useState<Tela | null>(null)
  const [analisando, setAnalisando] = useState(false)
```

(c) Troque

```tsx
  const { estado, email } = tela
  return (
```

por

```tsx
  const { estado, email } = tela
  if (analisando && fonte && api && estado.processo && estado.instancia) {
    return (
      <Analisar fonte={fonte} api={api} origem={{ eproc: estado.processo, instancia: estado.instancia }}
        abrir={abrir} sair={() => setAnalisando(false)} />
    )
  }
  return (
```

(d) Troque

```tsx
      <button className="secundario" onClick={carregar}>Atualizar</button>
    </main>
  )
}
```

por

```tsx
      {estado.processo && fonte && api && <button onClick={() => setAnalisando(true)}>Analisar este processo</button>}
      <button className="secundario" onClick={carregar}>Atualizar</button>
    </main>
  )
}
```

(e) Nada mais muda no `Painel.tsx`.

- [ ] **Step 5: A demonstração passa a fonte e a api fictícias**

Em `frontend/extensao/painel/demo.tsx`:

(a) Troque `import { cenarios } from './demo-cenarios.ts'` por

```tsx
import { apiDemo, fonteDemo } from './analisar/demo-analise.ts'
import { cenarios } from './demo-cenarios.ts'
```

(b) Troque `  const lista = useMemo(() => cenarios(), [])` por

```tsx
  const lista = useMemo(() => cenarios(), [])
  const fonte = useMemo(() => fonteDemo(), [])
  const api = useMemo(() => apiDemo(), [])
```

(c) Troque `<Painel key={lista[i].id} deps={lista[i].deps} />` por

```tsx
<Painel key={lista[i].id} deps={lista[i].deps} fonte={fonte} api={api} abrir={() => {}} />
```

- [ ] **Step 6: Estilos**

Acrescente ao fim de `frontend/extensao/painel/painel.css`:

```css

.lista {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 6px;
}

.aviso {
  color: var(--alerta);
}

.resumo {
  margin: 0;
  font-size: 18px;
  font-weight: normal;
}

textarea.caso {
  box-sizing: border-box;
  width: 100%;
  border: 1px solid var(--linha-forte);
  border-radius: var(--raio);
  background: var(--papel);
  color: var(--tinta);
  font: inherit;
}

.painel button:disabled {
  opacity: 0.5;
  cursor: default;
}
```

Se o `stylelint` recusar alguma regra, ajuste o CSS; nunca a configuração (ela vale para o projeto inteiro).

- [ ] **Step 7: Documentar**

Em `COMO_RODAR.md`, na seção "Demonstração da extensão (sem login e sem eproc)", depois da frase que termina em `a página de demonstração só existe nele.`, acrescente um parágrafo:

```
Nos cenários com processo aberto, o botão **Analisar este processo** percorre o fluxo inteiro com dados
fictícios: escolher as peças, montar o caso (com CPF, CNPJ e OAB já removidos), rodar, acompanhar e ver o
resumo do prognóstico. No painel de verdade esse botão só aparece quando as primitivas de leitura do eproc
do TJSC existirem.
```

- [ ] **Step 8: Verificar (tudo junto)**

Run (em `frontend/`): `npx tsc --noEmit` — limpo.
Run: `npx stylelint "extensao/**/*.css" "src/**/*.css"` — limpo.
Run: `npm run test:extensao` — tudo passa, **142** testes.
Run (build de produção, pasta temporária fora do repositório): `EXT_API_BASE=http://localhost:5173 EXT_OUT_DIR=<pasta-temporaria> npm run build:extensao` — ok; a pasta **não** contém `demo.html`, e `grep -c "demo-001" <pasta>/painel.js` dá `0` (nenhum dado da demonstração no pacote de produção).
Run (build de demonstração, outra pasta temporária): `EXT_DEMO=1 EXT_API_BASE=http://localhost:5173 EXT_OUT_DIR=<outra-pasta-temporaria> npm run build:extensao` — ok; a pasta contém `demo.html` e `demo.js`.
Apague as duas pastas temporárias ao fim. **Não** rode nada contra `frontend/extensao/dist` nem `dist-demo`.

Run (na raiz): `cmd /c ".\verificar.bat"` (em PowerShell) — termina com `TUDO OK`.

- [ ] **Step 9: Commit**

```bash
git add frontend/extensao/painel/analisar/apiReal.ts frontend/extensao/painel/analisar/Analisar.tsx frontend/extensao/painel/Painel.tsx frontend/extensao/painel/chrome.ts frontend/extensao/painel/demo.tsx frontend/extensao/painel/painel.css COMO_RODAR.md
git commit -F <arquivo-com-a-mensagem>   # assunto sugerido: "painel: fluxo Analisar este processo (tela, cliente real e demonstracao)"
```
