import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CORPO_CAPTCHA, corpoDaBusca, lerBusca, linkDoProcesso, partesDoCampo, textoSemHtml } from './busca.ts'
import { ErroEproc } from './erros.ts'

// Fixture FICTÍCIA, no formato do HAR da JFRS. Nada aqui é de processo real.
const LINK = 'controlador.php?acao=processo_selecionar&acao_origem=pesquisa_processo_doc_parte&acao_retorno=pesquisa_processo_doc_parte#_processo=50012345620208240023&hash=abc123'
const item = (extra: Record<string, unknown> = {}) => ({
  nr_processo: '50012345620208240023', autuacao: '20/05/2020 11:01:05', str_sig_orgao_juizo: 'RSPOA14S',
  linkProcessoAssinado: LINK, autor: 'S&amp;P EMPRESA EXEMPLO LTDA.<br>', reu: 'UNIÃO - FAZENDA NACIONAL<br>e outros',
  classe: 'MANDADO DE SEGURANÇA', ultimo_evento: '16/03/2022 14:13:37 - Baixa Definitiva',
  id_sigilo: '0', des_assuntos: 'PIS, Contribuições Sociais', des_situacao: 'BAIXADO', ...extra,
})
const eLayout = (e: unknown) => e instanceof ErroEproc && e.tipo === 'LAYOUT'

test('corpo da busca: 13 campos na ordem da página, fnValidacao[] repetido, documento mascarado', () => {
  const c = corpoDaBusca('11.222.333/0001-81')
  assert.equal(c.length, 13)
  assert.deepEqual(c.filter(([k]) => k === 'fnValidacao[]').map(([, v]) => v), ['gerenciadorTelaConsulta', 'executarValidacoes'])
  assert.deepEqual(c.find(([k]) => k === 'strDocParte'), ['strDocParte', '11.222.333/0001-81'])
  assert.deepEqual(c.find(([k]) => k === 'tipoPesquisa'), ['tipoPesquisa', 'CP'])
  assert.deepEqual(c.find(([k]) => k === 'chkExibirBaixados'), ['chkExibirBaixados', 'on'])
  for (const vazio of ['acao_retorno', 'numNrProcesso', 'selIdClasseSelecionados', 'strChave']) {
    assert.deepEqual(c.find(([k]) => k === vazio), [vazio, ''])
  }
  assert.equal(CORPO_CAPTCHA.length, 3)
})

test('textoSemHtml e partesDoCampo: <br>, entidades e "e outros"', () => {
  assert.equal(textoSemHtml('S&amp;P<br>LTDA &lt;x&gt;'), 'S&P LTDA <x>')
  assert.equal(textoSemHtml('&amp;lt;'), '&lt;') // não decodifica duas vezes
  assert.deepEqual(partesDoCampo('A<br>B<br>e outros'), ['A', 'B'])
  assert.deepEqual(partesDoCampo('A<BR/>B'), ['A', 'B'])
  assert.deepEqual(partesDoCampo(null), [])
  assert.equal(textoSemHtml('<script>x</script>oi'), 'xoi') // tira a tag; nunca vai para innerHTML
})

test('link: o fragmento vira num_processo e hash na query', () => {
  assert.equal(linkDoProcesso(LINK),
    'controlador.php?acao=processo_selecionar&acao_origem=pesquisa_processo_doc_parte&acao_retorno=pesquisa_processo_doc_parte&num_processo=50012345620208240023&hash=abc123')
  assert.equal(linkDoProcesso('controlador.php?acao=x&hash=h'), 'controlador.php?acao=x&hash=h')
  assert.throws(() => linkDoProcesso('controlador.php?acao=x#_processo=1'), eLayout)
  assert.throws(() => linkDoProcesso('controlador.php?acao=x#hash=h'), eLayout)
})

test('lista pública: campos limpos, partes separadas, link reconstruído', () => {
  const r = lerBusca({ resultados: [item()] })
  assert.equal(r.total, 1)
  assert.equal(r.sigilosos, 0)
  assert.equal(r.possivelCorte, false)
  assert.deepEqual(r.processos[0], {
    numero: '50012345620208240023', autuacao: '20/05/2020 11:01:05', juizo: 'RSPOA14S',
    classe: 'MANDADO DE SEGURANÇA', ultimoEvento: '16/03/2022 14:13:37 - Baixa Definitiva',
    situacao: 'BAIXADO', assuntos: 'PIS, Contribuições Sociais',
    autores: ['S&P EMPRESA EXEMPLO LTDA.'], reus: ['UNIÃO - FAZENDA NACIONAL'],
    link: linkDoProcesso(LINK),
  })
})

test('sigilosos só contados, e nunca aparecem na lista', () => {
  const r = lerBusca({ resultados: [item(), item({ nr_processo: '50099999920208240023', id_sigilo: '1' }), item({ id_sigilo: undefined })] })
  assert.equal(r.processos.length, 1)
  assert.equal(r.sigilosos, 2)
  assert.equal(r.total, 3)
  assert.ok(!JSON.stringify(r).includes('50099999920208240023'))
})

test('só sigilosos: lista vazia mas com contagem (a tela não pode dizer "nenhum processo")', () => {
  const r = lerBusca({ resultados: [item({ id_sigilo: '2' })] })
  assert.deepEqual([r.processos.length, r.sigilosos, r.total], [0, 1, 1])
})

test('lista vazia é resposta; resultados ausente ou de outro tipo é LAYOUT', () => {
  assert.deepEqual(lerBusca({ resultados: [] }), { processos: [], sigilosos: 0, total: 0, possivelCorte: false })
  for (const r of [{}, null, undefined, 'x', { resultados: 'x' }, { resultados: {} }]) {
    assert.throws(() => lerBusca(r), eLayout, JSON.stringify(r))
  }
})

test('resultado público sem número válido ou sem link é LAYOUT', () => {
  assert.throws(() => lerBusca({ resultados: [item({ nr_processo: '123' })] }), eLayout)
  assert.throws(() => lerBusca({ resultados: [item({ nr_processo: undefined })] }), eLayout)
  assert.throws(() => lerBusca({ resultados: [item({ linkProcessoAssinado: undefined })] }), eLayout)
})

test('30 resultados (o máximo visto) avisa que a lista pode estar incompleta', () => {
  assert.equal(lerBusca({ resultados: Array.from({ length: 30 }, () => item()) }).possivelCorte, true)
  assert.equal(lerBusca({ resultados: Array.from({ length: 29 }, () => item()) }).possivelCorte, false)
})

test('item nulo ou não-objeto na lista conta como sigiloso: fail closed, sem exceção crua', () => {
  const r = lerBusca({ resultados: [null, item(), 'x'] })
  assert.equal(r.processos.length, 1)
  assert.equal(r.sigilosos, 2)
})

test('link sem query antes do # ganha "?" (não "&")', () => {
  assert.equal(linkDoProcesso('controlador.php#_processo=1&hash=h'), 'controlador.php?num_processo=1&hash=h')
})

test('resultado público com número numérico, link vazio ou link não-string é LAYOUT', () => {
  assert.throws(() => lerBusca({ resultados: [item({ nr_processo: 50012345620208240023 })] }), eLayout)
  assert.throws(() => lerBusca({ resultados: [item({ linkProcessoAssinado: '' })] }), eLayout)
  assert.throws(() => lerBusca({ resultados: [item({ linkProcessoAssinado: 7 })] }), eLayout)
})
