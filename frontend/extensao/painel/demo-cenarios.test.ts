// Trava os cenários da página de demonstração: se o fluxo do painel mudar e um
// cenário deixar de produzir a tela que o nome promete, este teste quebra em vez
// de a apresentação mostrar a coisa errada.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { abrirPainel } from './fluxo.ts'
import { cenarios } from './demo-cenarios.ts'

const todos = cenarios(0)

test('cada cenário da demonstração produz exatamente a tela esperada', async () => {
  for (const c of todos) assert.deepEqual(await abrirPainel(c.deps), c.esperado, c.nome)
})

test('a demonstração cobre todos os erros do painel e as telas prontas', () => {
  const tipos = new Set(todos.map((c) => (c.esperado.tipo === 'erro' ? c.esperado.erro : c.esperado.tipo)))
  for (const t of ['pronto', 'sem_login', 'SEM_ABA_EPROC', 'NAO_LOGADO', 'CAPTCHA', 'SIGILOSO', 'LAYOUT', 'EPROC_FORA', 'SISTEMA_FORA']) {
    assert.ok(tipos.has(t), 'falta cenário: ' + t)
  }
})

test('os cenários usam o número de processo fictício do guia', () => {
  assert.match(JSON.stringify(todos.map((c) => c.esperado)), /50012345620208240023/)
})
