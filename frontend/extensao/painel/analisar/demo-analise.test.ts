// O fluxo inteiro do "Analisar este processo", ponta a ponta, só com as peças puras e
// os dados da demonstração (sem navegador, sem rede). Se um módulo mudar de contrato,
// este teste quebra antes de a apresentação mostrar a coisa errada.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { montarCaso } from '../caso/montagem.ts'
import { aplicar, andamentoInicial } from './andamento.ts'
import { corpoDaConsulta } from './apiAnalise.ts'
import { escolherCerebro } from './cerebro.ts'
import { apiDemo, fonteDemo } from './demo-analise.ts'
import { lerPecas } from './ler.ts'
import { marcadas, prepararLista } from './lista.ts'
import { resumirPrognostico } from './resumo.ts'

test('do processo aberto ao resumo do prognóstico', async () => {
  const fonte = fonteDemo(0)
  const api = apiDemo(0)
  const [capa, pecas, cerebros, limite] = await Promise.all([fonte.capa(), fonte.pecas(), api.cerebros(), api.limiteDoCaso()])

  const { itens, bloqueadas } = prepararLista(pecas)
  assert.deepEqual(bloqueadas, [])
  assert.deepEqual(marcadas(itens).map((m) => m.papel), ['decisao', 'recurso', 'inicial', 'contestacao'])
  const escolha = escolherCerebro(capa.relator, cerebros)
  assert.deepEqual(escolha, { slug: 'rubens-schulz', aviso: null })

  const { itens: lidos, falhas } = await lerPecas(fonte, api, marcadas(itens))
  assert.deepEqual(falhas, [])
  const m = montarCaso(capa, lidos, limite)
  assert.equal(m.excede, false)
  assert.deepEqual([...m.texto.matchAll(/=== ([A-ZÇÃÕ ]+) —/g)].map((x) => x[1]), ['DECISÃO RECORRIDA', 'RECURSO', 'PETIÇÃO INICIAL', 'CONTESTAÇÃO'])
  assert.ok(m.texto.includes('reforma da sentença'), 'o recurso em arquivo deveria ter passado pela extração')
  assert.ok(m.texto.includes('[CNPJ]') && m.texto.includes('[OAB]'))
  assert.ok(!/11\.222\.333|12\.345/.test(m.texto), 'CNPJ e OAB da inicial deveriam ter saído do texto')
  assert.ok(!m.texto.includes('RESERVADO'), 'peça sigilosa não pode entrar')

  const corpo = corpoDaConsulta({ texto: m.texto, cerebro: escolha.slug, tese: 'neutra', soPrognostico: false, origem: { eproc: capa.numero, instancia: '1g' } })
  const { thread } = await api.rodar(corpo)
  assert.deepEqual(api.ultimoCorpo()?.origem, { eproc: '50012345620208240023', instancia: '1g' })

  let andamento = andamentoInicial()
  await api.acompanhar(thread, (e) => { andamento = aplicar(andamento, e) })
  assert.deepEqual([andamento.concluido, andamento.erro], [true, null])
  assert.deepEqual(andamento.nos, ['triagem', 'recuperar', 'triar', 'prognostico'])

  const resumo = resumirPrognostico(await api.consulta(thread))
  assert.equal(resumo.titulo, '62% de chance de reforma')
  assert.equal(resumo.aviso, null)
})
