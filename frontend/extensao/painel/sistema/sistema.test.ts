import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ehAcompanhado, linhaDoHistorico, montarCarregamento, type ItemHistorico } from './apiSistema.ts'
import { apiSistemaDemo } from './demo-sistema.ts'

const H = (x: Partial<ItemHistorico> = {}): ItemHistorico => ({
  thread: 't', criado_em: '2026-09-21T10:00:00', resumo: '', cerebro_nome: 'Rubens', estado: 'pronto', decide: true, probabilidade_pct: 63.4, ...x,
})

test('linhaDoHistorico: data brasileira, cérebro e percentual arredondado', () => {
  assert.deepEqual(linhaDoHistorico(H()), { titulo: '21/09/2026 · Rubens', estado: '63% de reforma' })
})

test('linhaDoHistorico: estados que não são resultado; "não decidiu" nunca mostra número', () => {
  assert.equal(linhaDoHistorico(H({ estado: 'fila' })).estado, 'rodando')
  assert.equal(linhaDoHistorico(H({ estado: 'rodando' })).estado, 'rodando')
  assert.equal(linhaDoHistorico(H({ estado: 'interrompido' })).estado, 'interrompida')
  assert.equal(linhaDoHistorico(H({ estado: 'erro' })).estado, 'erro')
  assert.equal(linhaDoHistorico(H({ decide: false, probabilidade_pct: 55 })).estado, 'não decidiu')
  assert.equal(linhaDoHistorico(H({ decide: null, probabilidade_pct: null })).estado, '—')
  assert.equal(linhaDoHistorico(H({ criado_em: '' })).titulo, 'Rubens')
})

test('ehAcompanhado confere o número exato', () => {
  const l = [{ processo: '1'.repeat(20), instancia: null, criado_em: '' }]
  assert.ok(ehAcompanhado(l, '1'.repeat(20)))
  assert.ok(!ehAcompanhado(l, '2'.repeat(20)))
})

test('demonstração: acompanhar é idempotente e parar remove', async () => {
  const a = apiSistemaDemo()
  const antes = (await a.acompanhados()).length
  await a.acompanhar('7'.repeat(20), '2g')
  await a.acompanhar('7'.repeat(20), '2g')
  assert.equal((await a.acompanhados()).length, antes + 1)
  await a.parar('7'.repeat(20))
  assert.equal((await a.acompanhados()).length, antes)
  assert.deepEqual(await a.historico('9'.repeat(20)), [])
})

test('montarCarregamento: falha parcial mantém a parte que carregou e avisa', () => {
  const ok = { status: 'fulfilled', value: [] } as PromiseFulfilledResult<never[]>
  const ruim = { status: 'rejected', reason: new Error('x') } as PromiseRejectedResult
  const m = (e: unknown) => (e as Error).message
  const lista = [{ processo: '1'.repeat(20), instancia: null, criado_em: '' }]
  const a = montarCarregamento(ruim, { status: 'fulfilled', value: lista }, m)
  assert.deepEqual(a.dados?.lista, lista)
  assert.match(a.aviso ?? '', /Histórico indisponível: x/)
  const b = montarCarregamento(ok, ruim, m)
  assert.deepEqual(b.dados?.lista, [])
  assert.match(b.aviso ?? '', /acompanhados indisponível/)
  assert.deepEqual(montarCarregamento(ok, ok, m), { dados: { historico: [], lista: [] }, aviso: null })
  assert.deepEqual(montarCarregamento(ruim, ruim, m), { dados: null, aviso: 'x' })
})
