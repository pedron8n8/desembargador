import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ErroEproc } from '../../agente/lib/erros.ts'
import type { ItemPainel } from './fonteAdvogado.ts'
import { avisoSigilosos, JANELA_DESTAQUE_DIAS, lerData, mensagemVazia, prepararPainel } from './painelAdvogado.ts'

const HOJE = new Date('2026-09-30T18:30:00Z') // 30/09/2026 15:30 em Brasília: o dia é o que vale
const item = (n: number, prazoFinal: string | null, extra: Partial<ItemPainel> = {}): ItemPainel => ({
  ref: `r${n}`, processo: `5001234562020824${String(n).padStart(4, '0')}`, classe: 'APELAÇÃO CÍVEL', tipo: 'prazo',
  inicio: '01/09/2026', prazoFinal, evento: 'Intimação', sigiloso: false, ...extra,
})

test('lerData: só data real no formato dd/mm/aaaa', () => {
  assert.equal(lerData('30/09/2026'), Date.UTC(2026, 8, 30))
  assert.equal(lerData(' 01/01/2027 '), Date.UTC(2027, 0, 1))
  for (const ruim of ['31/02/2026', '2026-09-30', '30/9/2026', '', 'amanhã', '00/01/2026', '30/13/2026']) {
    assert.equal(lerData(ruim), null, ruim)
  }
})

test('situação pelo prazo final que o eproc informa: vencido, próximo (até 7 dias corridos), normal', () => {
  const { linhas } = prepararPainel(
    [item(1, '29/09/2026'), item(2, '30/09/2026'), item(3, '07/10/2026'), item(4, '08/10/2026')], HOJE)
  const por = Object.fromEntries(linhas.map((l) => [l.item.ref, [l.situacao, l.dias]]))
  assert.deepEqual(por, { r1: ['vencido', -1], r2: ['proximo', 0], r3: ['proximo', 7], r4: ['normal', 8] })
  assert.equal(JANELA_DESTAQUE_DIAS, 7)
})

test('ordem: data ilegível no topo com os vencidos, prazo crescente, sem prazo por último, empate por processo', () => {
  const { linhas } = prepararPainel(
    [item(5, null), item(4, '20/10/2026'), item(3, '31/02/2026'), item(2, '01/10/2026'), item(1, '28/09/2026'), item(6, '01/10/2026')], HOJE)
  assert.deepEqual(linhas.map((l) => l.item.ref), ['r3', 'r1', 'r2', 'r6', 'r4', 'r5'])
})

test('ordem: ilegível antes de vencido e null depois de tudo, mesmo quando o nº do processo inverteria', () => {
  // só o desempate por processo daria r1(null), r2(vencido), r3, r9(ilegível): errado
  const { linhas } = prepararPainel([item(1, null), item(2, '01/09/2026'), item(9, 'semana que vem'), item(3, '15/10/2026')], HOJE)
  assert.deepEqual(linhas.map((l) => l.item.ref), ['r9', 'r2', 'r3', 'r1'])
})

test('data ilegível vai para o topo e é marcada, mas nunca chamada de vencida; sem prazo segue no fim', () => {
  const { linhas } = prepararPainel([item(1, 'semana que vem'), item(2, null)], HOJE)
  assert.deepEqual(linhas.map((l) => [l.situacao, l.dias, l.dataIlegivel]), [['sem_prazo', null, true], ['sem_prazo', null, false]])
})

test('dia de hoje é o do calendário em Brasília, não o da máquina', () => {
  const prazo = [item(1, '29/09/2026')]
  assert.equal(prepararPainel(prazo, new Date('2026-09-30T02:30:00Z')).linhas[0].dias, 0) // ainda 29/09 em Brasília
  assert.equal(prepararPainel(prazo, new Date('2026-09-30T03:30:00Z')).linhas[0].dias, -1) // já 30/09
})

test('sigiloso só é público se for exatamente false; true conta; qualquer outro valor é LAYOUT', () => {
  const r = prepararPainel([item(1, null), item(2, null, { sigiloso: true })], HOJE)
  assert.equal(r.linhas.length, 1)
  assert.equal(r.sigilosos, 1)
  for (const ruim of [undefined, 'false', 'true', 0, 1, null]) {
    assert.throws(() => prepararPainel([item(1, null, { sigiloso: ruim as never })], HOJE), (e) => e instanceof ErroEproc && e.tipo === 'LAYOUT', String(ruim))
  }
})

test('tipo desconhecido vindo do agente é LAYOUT', () => {
  for (const tipo of ['intimacao', 'prazo', 'outro']) assert.equal(prepararPainel([item(1, null, { tipo: tipo as never })], HOJE).linhas.length, 1)
  for (const ruim of ['despacho', undefined, '', 'constructor']) {
    assert.throws(() => prepararPainel([item(1, null, { tipo: ruim as never })], HOJE), (e) => e instanceof ErroEproc && e.tipo === 'LAYOUT', String(ruim))
  }
})

test('sigilosos saem da lista e viram só contagem; o total conta todos', () => {
  const r = prepararPainel([item(1, '01/10/2026'), item(2, '01/10/2026', { sigiloso: true }), item(3, null, { sigiloso: true })], HOJE)
  assert.equal(r.linhas.length, 1)
  assert.equal(r.sigilosos, 2)
  assert.equal(r.total, 3)
  assert.ok(!JSON.stringify(r).includes('50012345620208240002'))
})

test('número do processo formatado; lista e entrada vazias', () => {
  assert.equal(prepararPainel([item(1, null)], HOJE).linhas[0].processoFormatado, '5001234-56.2020.8.24.0001')
  assert.deepEqual(prepararPainel([], HOJE), { linhas: [], sigilosos: 0, total: 0 })
})

test('mensagem de lista vazia: nunca "nenhuma" junto de sigilosos, e sempre a instância', () => {
  assert.equal(mensagemVazia({ linhas: [], sigilosos: 0 }, '1g'), 'Nenhuma intimação ou prazo pendente no eproc do TJSC (1º grau).')
  assert.equal(mensagemVazia({ linhas: [], sigilosos: 0 }, '2g'), 'Nenhuma intimação ou prazo pendente no eproc do TJSC (2º grau).')
  assert.equal(mensagemVazia({ linhas: [], sigilosos: 1 }, '1g'), 'Há 1 processo em sigilo que a extensão não mostra.')
  assert.ok(!/nenhuma/i.test(mensagemVazia({ linhas: [], sigilosos: 3 }, '1g') ?? ''))
  assert.equal(mensagemVazia({ linhas: [{} as never], sigilosos: 2 }, '1g'), null)
})

test('aviso de sigilo: singular, plural e ausência', () => {
  assert.equal(avisoSigilosos(0), null)
  assert.equal(avisoSigilosos(1), '1 processo em sigilo não é mostrado pela extensão.')
  assert.equal(avisoSigilosos(4), '4 processos em sigilo não são mostrados pela extensão.')
  assert.equal(mensagemVazia({ linhas: [], sigilosos: 4 }, '1g'), 'Há 4 processos em sigilo que a extensão não mostra.')
})
