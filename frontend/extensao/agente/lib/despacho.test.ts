import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ehPedido, responder } from './despacho.ts'
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

test("tela irreconhecível vira {ok:false, erro:'LAYOUT'} via ErroEproc", async () => {
  const vazio: DocLike = { body: { className: '' }, querySelector: () => null }
  assert.deepEqual(await responder({ tipo: 'estado' }, vazio, URL_OK), { ok: false, erro: 'LAYOUT' })
})

const leitorFalso = (selecao: string, pagina: string) => ({ selecao: () => selecao, pagina: () => pagina })

test('pedido de texto: seleção minimizada, com a origem do texto', async () => {
  assert.deepEqual(await responder({ tipo: 'texto' }, logado, URL_OK, leitorFalso('trecho CPF 529.982.247-25', 'página')),
    { ok: true, texto: 'trecho CPF [CPF]', fonte: 'selecao', cortado: false })
})

test('pedido de texto sem leitor ou com leitor que quebra vira LAYOUT', async () => {
  assert.deepEqual(await responder({ tipo: 'texto' }, logado, URL_OK), { ok: false, erro: 'LAYOUT' })
  const quebrado = { selecao: () => { throw new Error('boom') }, pagina: () => '' }
  assert.deepEqual(await responder({ tipo: 'texto' }, logado, URL_OK, quebrado), { ok: false, erro: 'LAYOUT' })
})

test('ehPedido: só estado e texto são do agente (abrir_painel, lixo e nulos não são)', () => {
  assert.equal(ehPedido({ tipo: 'estado' }), true)
  assert.equal(ehPedido({ tipo: 'texto' }), true)
  for (const x of [{ tipo: 'abrir_painel' }, { tipo: 'outra' }, null, undefined, 'texto', 7, {}]) assert.equal(ehPedido(x), false, String(x))
})
