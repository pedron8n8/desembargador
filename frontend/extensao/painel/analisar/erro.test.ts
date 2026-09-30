import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ErroEproc } from '../../agente/lib/erros.ts'
import { MENSAGENS } from '../mensagens.ts'
import { mensagemDoErro } from './erro.ts'

test('erro do agente: texto da tabela do painel, pelo tipo, sem o detalhe técnico', () => {
  const m = mensagemDoErro(new ErroEproc('LAYOUT', 'seletor x'))
  assert.equal(m, MENSAGENS.LAYOUT.texto)
  assert.ok(!m.includes('seletor'))
  assert.equal(mensagemDoErro(new ErroEproc('NAO_LOGADO', 'redirecionado')), MENSAGENS.NAO_LOGADO.texto)
  assert.equal(mensagemDoErro(new ErroEproc('SIGILOSO')), MENSAGENS.SIGILOSO.texto)
})

test('todo tipo de ErroEproc tem mensagem (nenhum vira texto vazio)', () => {
  for (const tipo of ['NAO_LOGADO', 'CAPTCHA', 'LAYOUT', 'EPROC_FORA', 'SIGILOSO', 'SEM_ABA_EPROC'] as const) {
    assert.ok(mensagemDoErro(new ErroEproc(tipo)).length > 10, tipo)
  }
})

test('outros erros mostram a própria mensagem; o que não é erro vira texto genérico', () => {
  assert.equal(mensagemDoErro(new Error('RTF ainda não é lido aqui')), 'RTF ainda não é lido aqui')
  assert.match(mensagemDoErro(new RangeError('Caso longo demais: 130000 caracteres')), /130000/)
  assert.equal(mensagemDoErro(new Error('')), 'Algo deu errado.')
  assert.equal(mensagemDoErro('texto solto'), 'Algo deu errado.')
  assert.equal(mensagemDoErro(undefined), 'Algo deu errado.')
})
