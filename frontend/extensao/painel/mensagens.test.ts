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
