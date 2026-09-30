import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ErroEproc } from './erros.ts'
import { criarRede } from './rede.ts'
import { ACOES_PROIBIDAS, acaoProibida, acaoProibidaNosPares } from './proibidas.ts'

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

test('mecanismo com lista injetada: só o que está na lista é barrado', () => {
  assert.equal(acaoProibida('controlador.php?acao=registrar_ciencia', ['registrar_ciencia']), 'registrar_ciencia')
  assert.equal(acaoProibida('controlador.php?acao=registrar_ciencia', ['outra']), null)
  assert.equal(acaoProibida('controlador.php?acao=registrar_ciencia', []), null)
})

// O padrão é a própria lista do módulo: estes dois testes falham se alguém trocar o default por [].
const NOME = 'acao_proibida_de_teste'
async function comNomeNaListaPadrao(fn: () => void | Promise<void>) {
  const lista = ACOES_PROIBIDAS as string[]
  lista.push(NOME)
  try { await fn() } finally { lista.pop() }
}

test('acaoProibida sem lista injetada usa ACOES_PROIBIDAS', () =>
  comNomeNaListaPadrao(() => assert.equal(acaoProibida('c.php?acao=' + NOME), NOME)))

test('a rede usa ACOES_PROIBIDAS por padrão quando `proibidas` não é passado', () =>
  comNomeNaListaPadrao(async () => {
    let chamadas = 0
    const rede = criarRede({ base: BASE, esperar: async () => {}, agora: () => 0, fetch: async () => { chamadas++; return resposta('{}') } })
    await assert.rejects(rede.postar('c.php?acao=' + NOME, []), /ação proibida/)
    assert.equal(chamadas, 0)
  }))

test('o PHP usa o ÚLTIMO valor repetido: qualquer valor proibido em `acao` ou `acao_ajax` barra', () => {
  assert.equal(acaoProibida('controlador.php?acao=processo_selecionar&acao=registrar_ciencia', PROIBIDAS), 'registrar_ciencia')
  assert.equal(acaoProibida('controlador.php?acao=registrar_ciencia&acao=processo_selecionar', PROIBIDAS), 'registrar_ciencia')
  assert.equal(acaoProibida('c.php?acao_ajax=x&acao_ajax=INTIMACAO_ABRIR', PROIBIDAS), 'INTIMACAO_ABRIR')
})

test('acaoProibidaNosPares: chaves acao e acao_ajax do corpo, todos os valores', () => {
  assert.equal(acaoProibidaNosPares([['acao', 'registrar_ciencia']], PROIBIDAS), 'registrar_ciencia')
  assert.equal(acaoProibidaNosPares([['acao_ajax', 'ok'], ['acao_ajax', 'Intimacao_Abrir']], PROIBIDAS), 'Intimacao_Abrir')
  assert.equal(acaoProibidaNosPares([['outro', 'registrar_ciencia'], ['acao', 'consulta']], PROIBIDAS), null)
})

test('postar barra ação proibida que vem no CORPO, antes de requisitar', async () => {
  let chamadas = 0
  const rede = criarRede({ base: BASE, proibidas: PROIBIDAS, esperar: async () => {}, agora: () => 0, fetch: async () => { chamadas++; return resposta('{}') } })
  await assert.rejects(rede.postar('controlador_ajax.php', [['acao_ajax', 'registrar_ciencia']]), /ação proibida/)
  await assert.rejects(rede.postar('controlador_ajax.php', [['acao', 'x'], ['acao', 'registrar_ciencia']]), /ação proibida/)
  assert.equal(chamadas, 0)
})

test('redirecionamento para ação proibida: erro e o corpo NÃO é devolvido', async () => {
  const destino = 'https://eproc1g.tjsc.jus.br/eproc/controlador.php?acao=registrar_ciencia&hash=h'
  const rede = criarRede({
    base: BASE, proibidas: PROIBIDAS, esperar: async () => {}, agora: () => 0,
    fetch: async () => ({ ok: true, status: 200, url: destino, redirected: true, arrayBuffer: async () => new TextEncoder().encode('SEGREDO').buffer }) as unknown as Response,
  })
  const r = await rede.baixarPagina('controlador.php?acao=consulta').then((t) => 'devolveu:' + t, (e) => (e instanceof ErroEproc ? e.tipo + ':' + e.message : String(e)))
  assert.match(r, /^LAYOUT:.*ação proibida/)
  assert.ok(!r.includes('SEGREDO'))
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
