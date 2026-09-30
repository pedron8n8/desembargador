import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ErroEproc } from '../../agente/lib/erros.ts'
import { podeEnviar, origemDoTexto } from './envio.ts'
import { lerRespostaTexto } from './fonteTexto.ts'
import { EMENTA_MAX, linhaDoPrecedente, resumirEmenta, type PrecedenteResumo } from './precedentes.ts'
import { termosDeBusca } from './termos.ts'

const eLayout = (e: unknown) => e instanceof ErroEproc && e.tipo === 'LAYOUT'

test('resposta de texto válida passa; erro conhecido do agente vira ErroEproc do mesmo tipo', () => {
  assert.deepEqual(lerRespostaTexto({ ok: true, texto: 'abc', fonte: 'selecao', cortado: false }), { texto: 'abc', fonte: 'selecao', cortado: false })
  assert.throws(() => lerRespostaTexto({ ok: false, erro: 'NAO_LOGADO' }), (e) => e instanceof ErroEproc && e.tipo === 'NAO_LOGADO')
})

test('resposta fora do formato é LAYOUT, nunca texto vazio', () => {
  for (const r of [undefined, null, 'x', {}, { ok: true }, { ok: true, texto: 1, fonte: 'pagina', cortado: false },
    { ok: true, texto: 'a', fonte: 'outra', cortado: false }, { ok: true, texto: 'a', fonte: 'pagina' },
    { ok: false, erro: 'INVENTADO' }, { ok: false, erro: 'toString' }, { ok: false }]) {
    assert.throws(() => lerRespostaTexto(r), eLayout, JSON.stringify(r))
  }
})

test('termosDeBusca: palavras de conteúdo, mais frequentes primeiro, separadas por ponto e vírgula', () => {
  // frequência primeiro (exclusão aparece 2x); no empate, a palavra mais longa; "tese", "icms" e "base" têm menos de 5 letras
  const t = 'A tese do PIS e da Cofins: a exclusão do ICMS da base de cálculo do PIS. A tese foi firmada; exclusão confirmada.'
  assert.equal(termosDeBusca(t, 3), 'exclusão;confirmada;cálculo')
  assert.equal(termosDeBusca(t, 12), 'exclusão;confirmada;cálculo;firmada;cofins')
})

test('termosDeBusca: sem palavras comuns, sem números, sem as curtas, respeitando o máximo', () => {
  assert.equal(termosDeBusca('sobre o processo e a parte 12345 com 6789 ao'), '')
  assert.equal(termosDeBusca(''), '')
  assert.equal(termosDeBusca('alfa bravo charlie delta echo foxtrot golf hotel india juliet', 3).split(';').length, 3)
  assert.equal(termosDeBusca('prescrição intercorrente'), 'intercorrente;prescrição')
})

test('termosDeBusca: mesmo texto, mesmo resultado (empate por tamanho e ordem alfabética)', () => {
  const t = 'zebra maçãs zebra maçãs pêssego'
  assert.equal(termosDeBusca(t), 'maçãs;zebra;pêssego')
  assert.equal(termosDeBusca(t), termosDeBusca(t))
})

test('termosDeBusca: o marcador de minimização não vira termo', () => {
  assert.equal(termosDeBusca('parte [CPF] devedora [CNPJ] [OAB]'), 'devedora')
})

const P = (extra: Partial<PrecedenteResumo> = {}): PrecedenteResumo => ({
  id: 1, numero: '5001234-56.2020.8.24.0023', classe: 'APELAÇÃO CÍVEL', orgao: '6ª Câmara de Direito Comercial',
  data: '2024-03-10', resultado: 'provido', ementa: 'Ementa curta.', ...extra,
})

test('resumirEmenta: curta fica como está; longa corta no espaço com reticências; espaços colapsam', () => {
  assert.equal(resumirEmenta('  uma   ementa\ncurta '), 'uma ementa curta')
  const longa = 'palavra '.repeat(100)
  const r = resumirEmenta(longa)
  assert.ok(r.endsWith('…') && r.length <= EMENTA_MAX + 1)
  assert.ok(!r.slice(0, -1).endsWith(' '))
  assert.equal(resumirEmenta(null), '')
  assert.equal(resumirEmenta('x'.repeat(400)).length, EMENTA_MAX + 1) // sem espaço para cortar: corta seco
})

test('linhaDoPrecedente: título, meta só com o que existe, ementa resumida', () => {
  assert.deepEqual(linhaDoPrecedente(P()), {
    titulo: '5001234-56.2020.8.24.0023 · APELAÇÃO CÍVEL', meta: '6ª Câmara de Direito Comercial · 2024-03-10 · provido', ementa: 'Ementa curta.',
  })
  const l = linhaDoPrecedente(P({ classe: null, orgao: null, resultado: null }))
  assert.equal(l.titulo, '5001234-56.2020.8.24.0023')
  assert.equal(l.meta, '2024-03-10')
})

test('podeEnviar: página inteira exige confirmação de sigilo; seleção não; texto vazio nunca', () => {
  assert.equal(podeEnviar({ fonte: 'pagina', confirmou: false, texto: 'abc' }), false)
  assert.equal(podeEnviar({ fonte: 'pagina', confirmou: true, texto: 'abc' }), true)
  assert.equal(podeEnviar({ fonte: 'selecao', confirmou: false, texto: 'abc' }), true)
  assert.equal(podeEnviar({ fonte: 'selecao', confirmou: true, texto: '  ' }), false)
  assert.equal(podeEnviar({ fonte: 'pagina', confirmou: true, texto: '' }), false)
})

test('origemDoTexto: só com seleção a origem segue na consulta', () => {
  const o = { eproc: '1', instancia: '1g' }
  assert.equal(origemDoTexto('selecao', o), o)
  assert.equal(origemDoTexto('pagina', o), undefined)
  assert.equal(origemDoTexto('selecao', undefined), undefined)
})
