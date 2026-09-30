import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cnpjValido, cpfValido, mascarar, normalizar, tipoDoDocumento } from './documento.ts'

test('normalizar: sem máscara, maiúsculas', () => {
  assert.equal(normalizar('11.222.333/0001-81'), '11222333000181')
  assert.equal(normalizar('12.abc.345/01de-35'), '12ABC34501DE35')
  assert.equal(normalizar(undefined as unknown as string), '')
})

test('CPF: válido, dígito errado, repetido, tamanho e letras', () => {
  assert.equal(cpfValido('52998224725'), true)
  assert.equal(cpfValido('52998224726'), false)
  assert.equal(cpfValido('11111111111'), false)
  assert.equal(cpfValido('5299822472'), false)
  assert.equal(cpfValido('5299822472A'), false)
})

test('CNPJ numérico e alfanumérico (o exemplo divulgado pela Receita)', () => {
  assert.equal(cnpjValido('11222333000181'), true)
  assert.equal(cnpjValido('11222333000182'), false)
  assert.equal(cnpjValido('12ABC34501DE35'), true)
  assert.equal(cnpjValido('12ABC34501DE36'), false)
  assert.equal(cnpjValido('00000000000000'), false)
  assert.equal(cnpjValido('12ABC34501DEAB'), false) // os dois últimos são dígitos
})

test('tipoDoDocumento: aceita máscara, minúsculas e diz qual é', () => {
  assert.equal(tipoDoDocumento('529.982.247-25'), 'cpf')
  assert.equal(tipoDoDocumento('11.222.333/0001-81'), 'cnpj')
  assert.equal(tipoDoDocumento('12.abc.345/01de-35'), 'cnpj')
  assert.equal(tipoDoDocumento('529.982.247-26'), null)
  assert.equal(tipoDoDocumento(''), null)
  assert.equal(tipoDoDocumento('ABCDEFGHIJK'), null)
})

test('mascarar: a máscara de cada tipo; inválido é null', () => {
  assert.equal(mascarar('52998224725'), '529.982.247-25')
  assert.equal(mascarar('529.982.247-25'), '529.982.247-25')
  assert.equal(mascarar('11222333000181'), '11.222.333/0001-81')
  assert.equal(mascarar('12abc34501de35'), '12.ABC.345/01DE-35')
  assert.equal(mascarar('52998224726'), null)
  assert.equal(mascarar('123'), null)
})
