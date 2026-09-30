import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatarNumeroProcesso } from './numero.ts'
import { minimizar } from './minimizacao.ts'

test('número do processo: 20 dígitos ganham a pontuação CNJ; o resto volta como veio', () => {
  assert.equal(formatarNumeroProcesso('50012345620208240023'), '5001234-56.2020.8.24.0023')
  assert.equal(formatarNumeroProcesso('123'), '123')
  assert.equal(formatarNumeroProcesso('5001234-56.2020.8.24.0023'), '5001234-56.2020.8.24.0023')
})

test('CPF e CNPJ com máscara, inclusive o CNPJ alfanumérico', () => {
  assert.equal(minimizar('CPF 529.982.247-25 e CNPJ 11.222.333/0001-81.'), 'CPF [CPF] e CNPJ [CNPJ].')
  assert.equal(minimizar('empresa 12.ABC.345/01DE-35 ltda'), 'empresa [CNPJ] ltda')
})

test('CPF e CNPJ sem máscara (11 e 14 dígitos isolados)', () => {
  assert.equal(minimizar('doc 52998224725 e 11222333000181'), 'doc [CPF] e [CNPJ]')
})

test('o número do processo nunca é tocado', () => {
  for (const n of ['50012345620208240023', '5001234-56.2020.8.24.0023']) {
    assert.equal(minimizar('processo ' + n + ' distribuído'), 'processo ' + n + ' distribuído')
  }
})

test('OAB em todas as formas vistas', () => {
  assert.equal(minimizar('OAB/SC 12.345'), '[OAB]')
  assert.equal(minimizar('OAB-RS nº 123456'), '[OAB]')
  assert.equal(minimizar('OAB RS 12345A'), '[OAB]')
  assert.equal(minimizar('oab/sc 12345'), '[OAB]')
  assert.equal(minimizar('Advogado: FULANO DE TAL (RS012345)'), 'Advogado: FULANO DE TAL ([OAB])')
})

test('texto sem identificador fica igual, e minimizar é idempotente', () => {
  const t = 'O autor pede a reforma da sentença de 10/03/2025, valor de R$ 1.500,00.'
  assert.equal(minimizar(t), t)
  const sujo = 'CPF 529.982.247-25 OAB/SC 12.345'
  assert.equal(minimizar(minimizar(sujo)), minimizar(sujo))
})

test('sigla de juízo parecida com UF não é confundida com OAB', () => {
  assert.equal(minimizar('juízo RSPOA14S'), 'juízo RSPOA14S')
})

test('texto vazio e texto enorme: termina, sem travar nas expressões regulares', () => {
  assert.equal(minimizar(''), '')
  const enorme = 'a1 '.repeat(40000) + '529.982.247-25 ' + '12.345.678/9012'.repeat(5000)
  assert.ok(minimizar(enorme).includes('[CPF]'))
})

test('OAB seguido de muito espaço em branco não trava (tempo linear)', () => {
  for (const sujo of ['OAB' + ' '.repeat(200000) + 'x', 'OAB '.repeat(50000), 'OAB/SC' + ' '.repeat(200000) + 'x']) {
    const t0 = performance.now()
    minimizar(sujo)
    assert.ok(performance.now() - t0 < 1000, 'demorou demais: ' + Math.round(performance.now() - t0) + ' ms')
  }
})

test('as formas de OAB continuam sendo reconhecidas com espaço antes da barra', () => {
  assert.equal(minimizar('OAB /SC 12.345'), '[OAB]')
  assert.equal(minimizar('OAB  -  RS  nº  123456'), '[OAB]')
})
