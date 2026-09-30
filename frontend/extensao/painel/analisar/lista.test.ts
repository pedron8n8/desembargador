import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Peca } from '../../agente/lib/caso.ts'
import { TIPOS } from '../caso/pecas.ts'
import { alternar, marcadas, prepararLista } from './lista.ts'

const SENT = TIPOS.sentenca[0], REC = TIPOS.recurso[0], INIC = TIPOS.inicial[0], CONT = TIPOS.contestacao[0]
const p = (tipo: string, evento: number, extra: Partial<Peca> = {}): Peca => ({
  ref: `r${evento}`, tipo, rotulo: `${tipo} ${evento}`, evento, data: '01/01/2025', sigiloso: false, ...extra,
})
const PECAS = [p(INIC, 1), p(CONT, 8), p('ATOORD', 20), p(SENT, 45), p(REC, 52)]

test('a lista vem da mais recente para a mais antiga, com as escolhidas marcadas e as outras não', () => {
  const { itens } = prepararLista(PECAS)
  assert.deepEqual(itens.map((i) => i.peca.evento), [52, 45, 20, 8, 1])
  assert.deepEqual(itens.map((i) => [i.papel, i.marcada]),
    [['recurso', true], ['decisao', true], ['outra', false], ['contestacao', true], ['inicial', true]])
})

test('marcadas: prioridade do papel, e peças à mão depois, da mais antiga para a mais nova', () => {
  let { itens } = prepararLista([...PECAS, p('ATOORD', 30)])
  itens = alternar(alternar(itens, 'r30'), 'r20') // marca duas "outras"
  assert.deepEqual(marcadas(itens).map((m) => `${m.papel}:${m.peca.evento}`),
    ['decisao:45', 'recurso:52', 'inicial:1', 'contestacao:8', 'outra:20', 'outra:30'])
})

test('alternar desmarca e marca de novo, sem mexer na lista original', () => {
  const { itens } = prepararLista(PECAS)
  const sem = alternar(itens, 'r45')
  assert.equal(sem.find((i) => i.peca.ref === 'r45')?.marcada, false)
  assert.equal(itens.find((i) => i.peca.ref === 'r45')?.marcada, true)
  assert.equal(alternar(sem, 'r45').find((i) => i.peca.ref === 'r45')?.marcada, true)
  assert.deepEqual(marcadas(sem).map((m) => m.peca.evento), [52, 1, 8])
})

test('peça sigilosa nunca é marcada, nem à mão; e a tela recebe o aviso do papel bloqueado', () => {
  const pecas = [p(SENT, 45, { sigiloso: true }), p('DESPADEC', 30), p('ATOORD', 20, { sigiloso: true })]
  const { itens, bloqueadas } = prepararLista(pecas)
  assert.deepEqual(bloqueadas, ['decisao'])
  assert.equal(itens.find((i) => i.peca.ref === 'r45')?.marcada, false)
  assert.equal(alternar(itens, 'r45').find((i) => i.peca.ref === 'r45')?.marcada, false)
  assert.equal(alternar(itens, 'r20').find((i) => i.peca.ref === 'r20')?.marcada, false)
  assert.deepEqual(marcadas(itens).map((m) => m.peca.evento), [30])
})

test('lista vazia', () => {
  assert.deepEqual(prepararLista([]), { itens: [], bloqueadas: [] })
  assert.deepEqual(marcadas([]), [])
})
