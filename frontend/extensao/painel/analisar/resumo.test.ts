import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ListaCerebros } from '../../../src/api.ts'
import { escolherCerebro } from './cerebro.ts'
import { resumirPrognostico } from './resumo.ts'

type Entrada = Parameters<typeof resumirPrognostico>[0]
const c = (prognostico: object, extra: object = {}) => ({ prognostico, caso_cortado: false, max_chars_caso: 20000, ...extra }) as Entrada

test('percentual calibrado: título, intervalo, resultado provável e precedentes', () => {
  const r = resumirPrognostico(c({ decide: true, probabilidade_pct: 61.6, intervalo_pct: [48.2, 74.9], resultado_provavel: 'reforma', n_precedentes: 12, calibrado: true }))
  assert.equal(r.titulo, '62% de chance de reforma')
  assert.deepEqual(r.linhas, ['intervalo de 80%: 48% a 75%', 'resultado mais provável: reforma', '12 precedentes analisados', 'Percentual calibrado.'])
  assert.equal(r.aviso, null)
})

test('sem calibrador o número ordena, mas não é probabilidade; um precedente no singular', () => {
  const r = resumirPrognostico(c({ decide: true, probabilidade_pct: 40, n_precedentes: 1, calibrado: false }))
  assert.ok(r.linhas.includes('1 precedente analisado'))
  assert.ok(r.linhas.includes('Sem calibrador treinado: o número ordena, mas não é uma probabilidade.'))
})

test('pediu um lado: nenhum percentual, mesmo que o servidor tenha mandado um', () => {
  const r = resumirPrognostico(c({ enviesado: true, probabilidade_pct: 99, decide: true }))
  assert.equal(r.titulo, 'SEM PROGNÓSTICO — você pediu um lado')
  assert.ok(!JSON.stringify(r).includes('99'))
})

test('"não decido": motivos do servidor, e nenhum percentual', () => {
  const r = resumirPrognostico(c({ decide: false, probabilidade_pct: 70, confianca: { por_que: ['amostra pequena', 'precedentes divididos'] } }))
  assert.equal(r.titulo, 'NÃO DECIDO')
  assert.deepEqual(r.linhas.slice(0, 2), ['amostra pequena', 'precedentes divididos'])
  assert.ok(!JSON.stringify(r).includes('70%'))
  assert.match(resumirPrognostico(c({ decide: false })).linhas[0], /não sustentam/)
})

test('decide mas sem percentual: indisponível, sem inventar número', () => {
  const r = resumirPrognostico(c({ decide: true, probabilidade_pct: null, n_precedentes: 3 }))
  assert.equal(r.titulo, 'Percentual indisponível')
  assert.ok(!r.titulo.includes('%'))
})

test('prognóstico vazio ou ausente: ainda não calculado', () => {
  assert.equal(resumirPrognostico(c({})).titulo, 'O prognóstico ainda não foi calculado.')
  assert.equal(resumirPrognostico({ caso_cortado: false, max_chars_caso: 1 } as unknown as Entrada).titulo, 'O prognóstico ainda não foi calculado.')
})

test('caso cortado: aviso com o limite formatado, em qualquer tipo de resultado', () => {
  const aviso = 'O caso passou de 20.000 caracteres e foi cortado antes da análise: o final não foi lido.'
  assert.equal(resumirPrognostico(c({ decide: true, probabilidade_pct: 50 }, { caso_cortado: true })).aviso, aviso)
  assert.equal(resumirPrognostico(c({ enviesado: true }, { caso_cortado: true })).aviso, aviso)
  assert.equal(resumirPrognostico(c({}, { caso_cortado: true })).aviso, aviso)
})

const lista = (itens: { slug: string; nome: string; ativo?: boolean; tem_indice?: boolean }[], padrao = 'rubens-schulz'): ListaCerebros =>
  ({ padrao, minimo_para_cravar: 1500, itens: itens.map((i) => ({ ativo: true, tem_indice: true, ...i })) }) as unknown as ListaCerebros

test('cérebro do relator quando existe, sem aviso', () => {
  const l = lista([{ slug: 'rubens-schulz', nome: 'Rubens Schulz' }, { slug: 'andre-luiz-dacol', nome: 'André Luiz Dacol' }])
  assert.deepEqual(escolherCerebro('ANDRE LUIZ DACOL', l), { slug: 'andre-luiz-dacol', aviso: null })
})

test('relator sem cérebro: usa o padrão e diz isso', () => {
  const l = lista([{ slug: 'rubens-schulz', nome: 'Rubens Schulz' }])
  assert.deepEqual(escolherCerebro('FULANO DE TAL', l), {
    slug: 'rubens-schulz', aviso: 'O relator deste processo (FULANO DE TAL) não tem cérebro no sistema; a análise usa o perfil de Rubens Schulz.',
  })
  assert.match(escolherCerebro(null, l).aviso ?? '', /não foi identificado/)
})

test('cérebro inativo ou sem índice nunca é escolhido; sem nenhum disponível, slug vazio e aviso', () => {
  const l = lista([{ slug: 'rubens-schulz', nome: 'Rubens Schulz', ativo: false }, { slug: 'x', nome: 'Outro', tem_indice: false }, { slug: 'y', nome: 'Terceiro' }])
  assert.equal(escolherCerebro('Rubens Schulz', l).slug, 'y') // o do relator está inativo: cai no primeiro disponível
  assert.deepEqual(escolherCerebro('Rubens Schulz', lista([{ slug: 'a', nome: 'A', ativo: false }])), { slug: '', aviso: 'Nenhum cérebro está disponível para analisar.' })
})
