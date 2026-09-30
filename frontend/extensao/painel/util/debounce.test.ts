import { test } from 'node:test'
import assert from 'node:assert/strict'
import { debounce } from './debounce.ts'

const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

test('várias chamadas seguidas viram uma só, depois do silêncio', async () => {
  let n = 0
  const d = debounce(() => n++, 30)
  d(); d(); d()
  assert.equal(n, 0)
  await esperar(80)
  assert.equal(n, 1)
})

test('chamadas espaçadas além do prazo disparam cada uma', async () => {
  let n = 0
  const d = debounce(() => n++, 20)
  d()
  await esperar(60)
  d()
  await esperar(60)
  assert.equal(n, 2)
})

test('cada nova chamada adia o disparo', async () => {
  let n = 0
  const d = debounce(() => n++, 50)
  d()
  await esperar(30)
  d()
  await esperar(30) // 60 ms desde a primeira, mas só 30 desde a segunda
  assert.equal(n, 0)
  await esperar(60)
  assert.equal(n, 1)
})

test('cancelar descarta a chamada pendente', async () => {
  let n = 0
  const d = debounce(() => n++, 20)
  d()
  d.cancelar()
  await esperar(60)
  assert.equal(n, 0)
  d.cancelar() // sem nada pendente: não quebra
})
