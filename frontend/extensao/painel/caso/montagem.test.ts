import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Capa, Peca } from '../../agente/lib/caso.ts'
import { montarCaso, type Item } from './montagem.ts'
import { ErroEproc } from '../../agente/lib/erros.ts'

const CAPA: Capa = {
  numero: '50012345620208240023', classe: 'APELAÇÃO CÍVEL', orgao: '6ª Câmara de Direito Comercial',
  relator: 'RUBENS SCHULZ', assuntos: ['PIS', 'Contribuições Sociais'],
  poloAtivo: ['EMPRESA EXEMPLO LTDA'], poloPassivo: ['UNIÃO - FAZENDA NACIONAL'],
}
const peca = (rotulo: string, evento: number): Peca =>
  ({ ref: 'r', tipo: 'X', rotulo, evento, data: '10/03/2025', sigiloso: false })
const item = (papel: Item['papel'], rotulo: string, evento: number, texto: string): Item =>
  ({ papel, peca: peca(rotulo, evento), texto })

test('cabeçalho e blocos, na ordem recebida, com evento e data', () => {
  const m = montarCaso(CAPA, [item('decisao', 'SENTENÇA 1', 45, 'julgo improcedente'), item('inicial', 'INICIAL 1', 1, 'pede a reforma')], 20000)
  assert.equal(m.texto, [
    'PROCESSO 5001234-56.2020.8.24.0023 — APELAÇÃO CÍVEL — 6ª Câmara de Direito Comercial',
    'Relator: RUBENS SCHULZ',
    'Assuntos: PIS; Contribuições Sociais',
    'Polo ativo: EMPRESA EXEMPLO LTDA',
    'Polo passivo: UNIÃO - FAZENDA NACIONAL',
    '',
    '=== DECISÃO RECORRIDA — SENTENÇA 1 (evento 45, 10/03/2025) ===',
    'julgo improcedente',
    '',
    '=== PETIÇÃO INICIAL — INICIAL 1 (evento 1, 10/03/2025) ===',
    'pede a reforma',
  ].join('\n'))
  assert.equal(m.chars, m.texto.length)
  assert.equal(m.excede, false)
  assert.deepEqual(m.cortadas, [])
})

test('sem relator nem assuntos, as linhas somem; polo vazio vira travessão', () => {
  const m = montarCaso({ ...CAPA, relator: null, assuntos: [], poloPassivo: [] }, [], 20000)
  assert.ok(!m.texto.includes('Relator:'))
  assert.ok(!m.texto.includes('Assuntos:'))
  assert.ok(m.texto.endsWith('Polo passivo: —'))
})

test('limite: quem termina depois dele é listado como cortado, na ordem', () => {
  const grande = 'x'.repeat(500)
  const itens = [item('decisao', 'SENTENÇA 1', 45, grande), item('recurso', 'APELAÇÃO 1', 50, grande), item('inicial', 'INICIAL 1', 1, grande)]
  const m = montarCaso(CAPA, itens, 800)
  assert.equal(m.excede, true)
  assert.equal(m.limite, 800)
  assert.deepEqual(m.cortadas, ['RECURSO — APELAÇÃO 1', 'PETIÇÃO INICIAL — INICIAL 1'])
})

test('exatamente no limite não excede', () => {
  const base = montarCaso(CAPA, [item('decisao', 'S', 1, 'abc')], 20000)
  const m = montarCaso(CAPA, [item('decisao', 'S', 1, 'abc')], base.chars)
  assert.equal(m.excede, false)
  assert.deepEqual(m.cortadas, [])
})

test('espaços nas pontas do texto da peça são aparados', () => {
  const m = montarCaso(CAPA, [item('decisao', 'S', 1, '  \n texto \n ')], 20000)
  assert.ok(m.texto.endsWith('===\ntexto'))
})

test('limite inválido (NaN, zero, negativo, indefinido, infinito) falha em vez de esconder o aviso de corte', () => {
  for (const l of [NaN, 0, -1, undefined as unknown as number, Infinity]) {
    assert.throws(() => montarCaso(CAPA, [], l), RangeError, String(l))
  }
})

test('última barreira: CPF, CNPJ e OAB que sobraram no cabeçalho ou no corpo saem do texto', () => {
  const capa = { ...CAPA, poloAtivo: ['FULANO (CPF 529.982.247-25)'] }
  const m = montarCaso(capa, [item('decisao', 'S', 1, 'parte no CNPJ 11.222.333/0001-81, advogado OAB/SC 12.345')], 20000)
  assert.ok(m.texto.includes('FULANO (CPF [CPF])'))
  assert.ok(m.texto.includes('CNPJ [CNPJ], advogado [OAB]'))
  assert.ok(!/529\.982|11\.222|12\.345/.test(m.texto))
})

test('peça sigilosa é recusada com SIGILOSO, nunca montada', () => {
  const sigilosa = item('decisao', 'S', 1, 'texto secreto')
  sigilosa.peca.sigiloso = true
  assert.throws(() => montarCaso(CAPA, [sigilosa], 20000), (e) => e instanceof ErroEproc && e.tipo === 'SIGILOSO')
})

test('um caractere abaixo do limite exato já excede e lista a peça', () => {
  const base = montarCaso(CAPA, [item('decisao', 'S', 1, 'abc')], 20000)
  const m = montarCaso(CAPA, [item('decisao', 'S', 1, 'abc')], base.chars - 1)
  assert.equal(m.excede, true)
  assert.deepEqual(m.cortadas, ['DECISÃO RECORRIDA — S'])
})
