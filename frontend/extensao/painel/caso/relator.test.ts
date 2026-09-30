import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cerebroDoRelator, normalizarNome } from './relator.ts'

const CEREBROS = [
  { slug: 'rubens-schulz', nome: 'Rubens Schulz' },
  { slug: 'andre-luiz-dacol', nome: 'André Luiz Dacol' },
]

test('normalizar: sem acento, sem caixa, sem título, espaços colapsados', () => {
  assert.equal(normalizarNome('  Desembargador   ANDRÉ  Luiz Dacol '), 'andre luiz dacol')
  assert.equal(normalizarNome('DES. Rubens Schulz'), 'rubens schulz')
  assert.equal(normalizarNome('Juíza Federal Maria Souza'), 'maria souza')
})

test('relator com cérebro: casa mesmo com caixa, acento e título diferentes', () => {
  assert.equal(cerebroDoRelator('RUBENS SCHULZ', CEREBROS), 'rubens-schulz')
  assert.equal(cerebroDoRelator('Desembargador André Luiz Dacol', CEREBROS), 'andre-luiz-dacol')
  assert.equal(cerebroDoRelator('ANDRE LUIZ DACOL', CEREBROS), 'andre-luiz-dacol')
})

test('relator sem cérebro, ausente ou vazio: null', () => {
  assert.equal(cerebroDoRelator('EVANDRO UBIRATAN PAIVA DA SILVEIRA', CEREBROS), null)
  assert.equal(cerebroDoRelator(null, CEREBROS), null)
  assert.equal(cerebroDoRelator('   ', CEREBROS), null)
  assert.equal(cerebroDoRelator('Rubens Schulz', []), null)
})

test('nada de parecido: nome parcial ou com sobrenome a mais não casa', () => {
  assert.equal(cerebroDoRelator('Rubens', CEREBROS), null)
  assert.equal(cerebroDoRelator('Rubens Schulz Filho', CEREBROS), null)
})

test('dois cérebros com o mesmo nome normalizado: ambíguo, null', () => {
  const dup = [...CEREBROS, { slug: 'rubens-schulz-2', nome: 'RUBENS SCHULZ' }]
  assert.equal(cerebroDoRelator('Rubens Schulz', dup), null)
})

test('relator que é só um título não casa com ninguém', () => {
  assert.equal(cerebroDoRelator('Desembargador', CEREBROS), null)
})
