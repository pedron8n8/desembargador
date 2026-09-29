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
