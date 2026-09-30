import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dataEm, fonteAdvogadoDemo, itensDemo } from './demo-advogado.ts'
import { avisoSigilosos, prepararPainel } from './painelAdvogado.ts'

test('dataEm: dias a partir de hoje, atravessando mês e ano, sempre dd/mm/aaaa', () => {
  const hoje = new Date(2026, 11, 30) // 30/12/2026
  assert.equal(dataEm(hoje, 0), '30/12/2026')
  assert.equal(dataEm(hoje, 3), '02/01/2027')
  assert.equal(dataEm(hoje, -30), '30/11/2026')
})

test('a demonstração mostra um vencido, um próximo, um normal, um sem prazo e um sigiloso, em qualquer dia', async () => {
  for (const hoje of [new Date(2026, 8, 30), new Date(2027, 0, 2), new Date(2028, 1, 28)]) {
    const fonte = fonteAdvogadoDemo(0, () => hoje)
    const r = prepararPainel(await fonte.painel(), hoje)
    assert.deepEqual(r.linhas.map((l) => l.situacao), ['vencido', 'proximo', 'normal', 'sem_prazo'], hoje.toDateString())
    assert.equal(r.sigilosos, 1)
    assert.equal(avisoSigilosos(r.sigilosos), '1 processo em sigilo não é mostrado pela extensão.')
    assert.ok(!JSON.stringify(r).includes('Prazo reservado'), 'o item sigiloso não pode aparecer')
  }
})

test('abrir registra só a referência do processo (o link assinado nunca passa pelo painel)', async () => {
  const fonte = fonteAdvogadoDemo(0)
  await fonte.abrir('adv-23')
  assert.deepEqual(fonte.abertas(), ['adv-23'])
  assert.ok(itensDemo(new Date()).every((i) => /^\d{20}$/.test(i.processo) && !('link' in i)))
})
