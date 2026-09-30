import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aplicar, andamentoInicial } from './andamento.ts'
import { criarLeitorSse, lerStream, type EventoSse } from './sse.ts'

const coletar = () => {
  const eventos: EventoSse[] = []
  return { eventos, ler: criarLeitorSse((e) => eventos.push(e)) }
}
const bloco = (id: number, tipo: string, dados: unknown) => `id: ${id}\nevent: ${tipo}\ndata: ${JSON.stringify(dados)}\n\n`

test('um evento completo vira {id, tipo, dados}', () => {
  const { eventos, ler } = coletar()
  ler(bloco(7, 'no_inicio', { no: 'triagem' }))
  assert.deepEqual(eventos, [{ id: 7, tipo: 'no_inicio', dados: { no: 'triagem' } }])
})

test('pedaços cortados em qualquer ponto dão o mesmo resultado', () => {
  const texto = bloco(1, 'inicio', {}) + bloco(2, 'log', { linha: 'olá ação' }) + bloco(3, 'fim', { segundos: 12.5 })
  const inteiro = coletar()
  inteiro.ler(texto)
  for (let corte = 1; corte < texto.length; corte += 7) {
    const c = coletar()
    c.ler(texto.slice(0, corte))
    c.ler(texto.slice(corte))
    assert.deepEqual(c.eventos, inteiro.eventos, 'corte em ' + corte)
  }
  assert.equal(inteiro.eventos.length, 3)
})

test('comentários (ping, conectado), blocos sem event e data ilegível são ignorados', () => {
  const { eventos, ler } = coletar()
  ler(': conectado\n\n: ping\n\n')
  ler('id: 1\ndata: {"x":1}\n\n') // sem event
  ler('id: 2\nevent: log\ndata: {isso não é json\n\n') // JSON inválido
  ler(bloco(3, 'fim', {}))
  assert.deepEqual(eventos.map((e) => e.tipo), ['fim'])
})

test('CRLF e várias linhas data são aceitos', () => {
  const { eventos, ler } = coletar()
  ler('id: 4\r\nevent: log\r\ndata: {"a":\r\ndata: 1}\r\n\r\n')
  assert.deepEqual(eventos, [{ id: 4, tipo: 'log', dados: { a: 1 } }])
})

test('lerStream entrega eventos de um ReadableStream cortado no meio de um caractere UTF-8', async () => {
  const bytes = new TextEncoder().encode(bloco(1, 'log', { linha: 'decisão' }) + bloco(2, 'fim', {}))
  const corte = bytes.indexOf(0xc3) + 1 // no meio do "ã" de "decisão"
  const corpo = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes.slice(0, corte))
      c.enqueue(bytes.slice(corte))
      c.close()
    },
  })
  const eventos: EventoSse[] = []
  await lerStream(corpo, (e) => eventos.push(e))
  assert.deepEqual(eventos.map((e) => e.tipo), ['log', 'fim'])
  assert.deepEqual(eventos[0].dados, { linha: 'decisão' })
})

test('andamento: nós, custo e fim', () => {
  let a = andamentoInicial()
  const ev = (tipo: string, dados: unknown): EventoSse => ({ id: 1, tipo, dados })
  a = aplicar(a, ev('no_inicio', { no: 'triagem' }))
  assert.equal(a.no, 'triagem')
  a = aplicar(a, ev('no_fim', { no: 'triagem', custos: [{ custo_usd: 0.01 }, { custo_usd: 0.02 }] }))
  assert.equal(a.no, null)
  assert.ok(Math.abs(a.custo_usd - 0.03) < 1e-9)
  a = aplicar(a, ev('no_inicio', { no: 'recuperar' }))
  a = aplicar(a, ev('no_inicio', { no: 'recuperar' })) // repetido não duplica
  assert.deepEqual(a.nos, ['triagem', 'recuperar'])
  a = aplicar(a, ev('fim', { segundos: 40, custo_usd: 0.5 }))
  assert.deepEqual([a.concluido, a.no, a.segundos, a.custo_usd, a.erro], [true, null, 40, 0.5, null])
})

test('andamento: erro marca conclusão com mensagem; "inicio" zera a tentativa mas mantém o custo', () => {
  const ev = (tipo: string, dados: unknown): EventoSse => ({ id: 1, tipo, dados })
  let a = aplicar(andamentoInicial(), ev('no_fim', { no: 'x', custos: [{ custo_usd: 0.1 }] }))
  a = aplicar(a, ev('erro', { mensagem: 'sem crédito', retomavel: true }))
  assert.deepEqual([a.concluido, a.erro, a.retomavel], [true, 'sem crédito', true])
  a = aplicar(a, ev('inicio', {}))
  assert.deepEqual([a.concluido, a.erro, a.retomavel], [false, null, false])
  assert.ok(Math.abs(a.custo_usd - 0.1) < 1e-9)
})

test('andamento: payload estranho não quebra nem inventa estado', () => {
  const ev = (tipo: string, dados: unknown): EventoSse => ({ id: 1, tipo, dados })
  const base = andamentoInicial()
  assert.deepEqual(aplicar(base, ev('no_inicio', null)), base)
  assert.deepEqual(aplicar(base, ev('no_inicio', { no: 7 })), base)
  assert.deepEqual(aplicar(base, ev('log', { linha: 'x' })), base)
  assert.equal(aplicar(base, ev('erro', {})).erro, 'a consulta falhou')
  assert.equal(aplicar(base, ev('no_fim', { no: 'a', custos: 'x' })).custo_usd, 0)
})

// timeout só para o teste NUNCA travar a suíte se a correção faltar
const comPrazo = <T,>(p: Promise<T>, ms = 1000) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('lerStream não terminou: travou esperando o servidor fechar')), ms))])

test('lerStream termina no evento fim mesmo que o servidor nunca feche a conexão', async () => {
  const bytes = new TextEncoder().encode(bloco(1, 'no_inicio', { no: 'triagem' }) + bloco(2, 'fim', { segundos: 1 }))
  let cancelado = false
  const corpo = new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(bytes) }, // nunca fecha
    cancel() { cancelado = true },
  })
  const eventos: EventoSse[] = []
  await comPrazo(lerStream(corpo, (e) => eventos.push(e)))
  assert.deepEqual(eventos.map((e) => e.tipo), ['no_inicio', 'fim'])
  assert.equal(cancelado, true)
})

test('o mesmo para erro, e nada depois do evento terminal é entregue', async () => {
  const bytes = new TextEncoder().encode(bloco(1, 'erro', { mensagem: 'sem crédito' }) + bloco(2, 'log', { linha: 'depois' }) + bloco(3, 'fim', {}))
  const corpo = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes) } })
  const eventos: EventoSse[] = []
  await comPrazo(lerStream(corpo, (e) => eventos.push(e)))
  assert.deepEqual(eventos.map((e) => e.tipo), ['erro'])
})

test('exceção do consumidor propaga (não é engolida) e o stream é cancelado', async () => {
  const { ler } = coletar()
  assert.doesNotThrow(() => ler('id: 1\nevent: log\ndata: {isso não é json\n\n')) // lixo continua ignorado
  const leitor = criarLeitorSse(() => { throw new Error('bug do consumidor') })
  assert.throws(() => leitor(bloco(1, 'log', {})), /bug do consumidor/)
  let cancelado = false
  const corpo = new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(new TextEncoder().encode(bloco(1, 'log', {}))) },
    cancel() { cancelado = true },
  })
  await assert.rejects(comPrazo(lerStream(corpo, () => { throw new Error('bug do consumidor') })), /bug do consumidor/)
  assert.equal(cancelado, true)
})

test('andamento: custos com item nulo não quebram a soma', () => {
  const ev = (tipo: string, dados: unknown): EventoSse => ({ id: 1, tipo, dados })
  const a = aplicar(andamentoInicial(), ev('no_fim', { no: 'x', custos: [null, { custo_usd: 0.01 }, 'lixo'] }))
  assert.ok(Math.abs(a.custo_usd - 0.01) < 1e-9)
})
