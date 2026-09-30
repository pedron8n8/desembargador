import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ultimaValida } from './ultimaValida.ts'

test('só a chamada mais recente vale', () => {
  const u = ultimaValida()
  const a = u.iniciar()
  assert.equal(a(), true)
  const b = u.iniciar()
  assert.equal(a(), false)
  assert.equal(b(), true)
})

test('invalidar descarta as chamadas em voo, mas não as seguintes', () => {
  const u = ultimaValida()
  const a = u.iniciar()
  u.invalidar()
  assert.equal(a(), false)
  assert.equal(u.iniciar()(), true)
})

test('depois de encerrar (unmount) nada vale', () => {
  const u = ultimaValida()
  const a = u.iniciar()
  u.encerrar()
  assert.equal(a(), false)
  assert.equal(u.iniciar()(), false)
})
