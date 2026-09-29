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

test('timeout durante leitura do corpo vira EPROC_FORA', async () => {
  const respostaComTimeout = {
    ok: true,
    status: 200,
    url: BASE,
    redirected: false,
    arrayBuffer: async () => { throw new DOMException('t', 'TimeoutError') },
  } as unknown as Response
  const rede = criarRede({ base: BASE, ...semEspera, fetch: async () => respostaComTimeout })
  assert.equal(await tipoDe(rede.postar('a', [])), 'EPROC_FORA')
  assert.equal(await tipoDe(rede.baixarPagina('a')), 'EPROC_FORA')
})
