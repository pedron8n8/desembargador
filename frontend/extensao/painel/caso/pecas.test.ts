import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Peca } from '../../agente/lib/caso.ts'
import { bloqueadasPorSigilo, preselecionar, TIPOS } from './pecas.ts'

const SENT = TIPOS.sentenca[0], DEC = TIPOS.decisao[0], REC = TIPOS.recurso[0], INIC = TIPOS.inicial[0], CONT = TIPOS.contestacao[0]
const p = (tipo: string, evento: number, extra: Partial<Peca> = {}): Peca => ({
  ref: `r${evento}`, tipo, rotulo: `${tipo} ${evento}`, evento, data: '01/01/2025', sigiloso: false, ...extra,
})
const resumo = (ps: Peca[]) => preselecionar(ps).map((s) => `${s.papel}:${s.peca.evento}`)

test('ordem de prioridade, não cronológica: decisão, recurso, inicial, contestação', () => {
  assert.deepEqual(resumo([p(INIC, 1), p(CONT, 5), p(SENT, 40), p(REC, 45)]),
    ['decisao:40', 'recurso:45', 'inicial:1', 'contestacao:5'])
})

test('várias sentenças: a de maior evento; sem sentença, a última decisão', () => {
  assert.deepEqual(resumo([p(SENT, 10), p(SENT, 30)]), ['decisao:30'])
  assert.deepEqual(resumo([p(DEC, 10), p(DEC, 22), p(INIC, 1)]), ['decisao:22', 'inicial:1'])
})

test('a sentença ganha da decisão, mesmo que a decisão seja mais recente', () => {
  assert.deepEqual(resumo([p(SENT, 10), p(DEC, 50)]), ['decisao:10'])
})

test('recurso anterior à decisão é ignorado; com vários, o mais recente', () => {
  assert.deepEqual(resumo([p(REC, 5), p(SENT, 40)]), ['decisao:40'])
  assert.deepEqual(resumo([p(SENT, 40), p(REC, 44), p(REC, 47)]), ['decisao:40', 'recurso:47'])
})

test('sem decisão, qualquer recurso vale (o mais recente)', () => {
  assert.deepEqual(resumo([p(REC, 3), p(REC, 9)]), ['recurso:9'])
})

test('petição inicial e contestação: a primeira de cada', () => {
  assert.deepEqual(resumo([p(INIC, 7), p(INIC, 2), p(CONT, 9), p(CONT, 4)]), ['inicial:2', 'contestacao:4'])
})

test('peça sigilosa nunca é selecionada; a próxima candidata a substitui', () => {
  assert.deepEqual(resumo([p(SENT, 40, { sigiloso: true }), p(DEC, 30)]), ['decisao:30'])
  assert.deepEqual(resumo([p(INIC, 1, { sigiloso: true })]), [])
})

test('lista vazia e tipos desconhecidos não selecionam nada', () => {
  assert.deepEqual(resumo([]), [])
  assert.deepEqual(resumo([p('ATOORD', 3), p('OUTRO', 4)]), [])
})

test('empate de número de evento é resolvido de forma estável (a primeira da lista)', () => {
  const a = p(SENT, 10, { ref: 'a' }), b = p(SENT, 10, { ref: 'b' })
  assert.equal(preselecionar([a, b])[0].peca.ref, 'a')
  assert.equal(preselecionar([b, a])[0].peca.ref, 'b')
})

test('bloqueadasPorSigilo: diz quais papéis têm a peça escolhida em sigilo', () => {
  assert.deepEqual(bloqueadasPorSigilo([p(SENT, 40, { sigiloso: true }), p(DEC, 30)]), ['decisao'])
  assert.deepEqual(bloqueadasPorSigilo([p(INIC, 1, { sigiloso: true }), p(SENT, 40)]), ['inicial'])
  assert.deepEqual(bloqueadasPorSigilo([p(SENT, 40), p(REC, 45, { sigiloso: true })]), ['recurso'])
})

test('bloqueadasPorSigilo: nada em sigilo, ou nada a escolher, dá lista vazia', () => {
  assert.deepEqual(bloqueadasPorSigilo([p(SENT, 40), p(INIC, 1)]), [])
  assert.deepEqual(bloqueadasPorSigilo([]), [])
})

test('preselecionar não muda: continua ignorando as sigilosas', () => {
  assert.deepEqual(resumo([p(SENT, 40, { sigiloso: true }), p(DEC, 30)]), ['decisao:30'])
})
