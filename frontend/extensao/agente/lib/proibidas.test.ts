import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ErroEproc } from './erros.ts'
import { criarRede } from './rede.ts'
import { ACOES_PROIBIDAS, acaoProibida } from './proibidas.ts'

const BASE = 'https://eproc1g.tjsc.jus.br/eproc/controlador.php?acao=x'
const PROIBIDAS = ['registrar_ciencia', 'intimacao_abrir']
const resposta = (corpo: string) =>
  ({ ok: true, status: 200, url: BASE, redirected: false, arrayBuffer: async () => new TextEncoder().encode(corpo).buffer }) as unknown as Response

test('ação proibida em `acao` ou em `acao_ajax`, sem distinguir maiúsculas', () => {
  assert.equal(acaoProibida('controlador.php?acao=registrar_ciencia&hash=h', PROIBIDAS), 'registrar_ciencia')
  assert.equal(acaoProibida('controlador_ajax.php?acao_ajax=Intimacao_Abrir&hash=h', PROIBIDAS), 'Intimacao_Abrir')
  assert.equal(acaoProibida('https://eproc1g.tjsc.jus.br/eproc/controlador.php?acao=REGISTRAR_CIENCIA', PROIBIDAS), 'REGISTRAR_CIENCIA')
})

test('ação comum, URL sem ação e URL ilegível não são proibidas', () => {
  assert.equal(acaoProibida('controlador.php?acao=processo_selecionar&hash=h', PROIBIDAS), null)
  assert.equal(acaoProibida('index.php', PROIBIDAS), null)
  assert.equal(acaoProibida('http://', PROIBIDAS), null)
})

test('a lista padrão está vazia (nome exato só com o HAR do TJSC) e nada é proibido com ela', () => {
  assert.deepEqual([...ACOES_PROIBIDAS], [])
  assert.equal(acaoProibida('controlador.php?acao=registrar_ciencia'), null)
})

test('a rede recusa ação proibida ANTES de qualquer requisição, em postar e em baixarPagina', async () => {
  let chamadas = 0
  const rede = criarRede({
    base: BASE, proibidas: PROIBIDAS, esperar: async () => {}, agora: () => 0,
    fetch: async () => { chamadas++; return resposta('{}') },
  })
  const tipo = async (p: Promise<unknown>) => {
    try { await p; return 'sem erro' } catch (e) { return e instanceof ErroEproc ? e.tipo + ':' + e.message : String(e) }
  }
  assert.match(await tipo(rede.postar('controlador_ajax.php?acao_ajax=intimacao_abrir', [])), /^LAYOUT:.*ação proibida/)
  assert.match(await tipo(rede.baixarPagina('controlador.php?acao=registrar_ciencia&hash=h')), /^LAYOUT:.*ação proibida/)
  assert.equal(chamadas, 0)
  assert.deepEqual(await rede.postar('controlador_ajax.php?acao_ajax=consulta', []), {})
  assert.equal(chamadas, 1)
})

test('recusar uma ação proibida não gasta o intervalo da fila', async () => {
  const esperas: number[] = []
  const rede = criarRede({
    base: BASE, proibidas: PROIBIDAS, intervaloMs: 1000, agora: () => 0, esperar: async (ms) => { esperas.push(ms) },
    fetch: async () => resposta('{}'),
  })
  await rede.postar('a?acao=registrar_ciencia', []).catch(() => {})
  await rede.postar('a?acao=consulta', [])
  assert.deepEqual(esperas, [])
})
