// Busca por documento da parte (CPF/CNPJ): monta o corpo do POST e lê a resposta.
// Formatos vistos no HAR da JFRS (25/09/2026); conferir contra o TJSC quando o
// HAR de lá chegar. Nada aqui faz requisição: a rede é do `rede.ts`.
import { ErroEproc } from './erros.ts'
import { separar } from './sigilo.ts'

export type Par = [string, string]

/** Corpo da verificação de captcha que o eproc faz antes de buscar. */
export const CORPO_CAPTCHA: Par[] = [
  ['strIdForm', 'frmProcessoListaAjax'],
  ['fnValidacao[]', 'gerenciadorTelaConsulta'],
  ['fnValidacao[]', 'executarValidacoes'],
]

/**
 * Os 13 campos do POST, na ordem da página. `fnValidacao[]` aparece duas vezes
 * (por isso lista de pares, e não objeto) e os vazios vão vazios. O documento
 * vai MASCARADO, como o campo da página o envia (ver lib/documento.ts).
 */
export function corpoDaBusca(documentoMascarado: string): Par[] {
  return [
    ['hdnInfraTipoPagina', '1'],
    ['strIdForm', 'frmProcessoListaAjax'],
    ['fnValidacao[]', 'gerenciadorTelaConsulta'],
    ['fnValidacao[]', 'executarValidacoes'],
    ['acao_origem', 'consultar'],
    ['acao_retorno', ''],
    ['acao', 'pesquisa_processo_doc_parte'],
    ['tipoPesquisa', 'CP'],
    ['numNrProcesso', ''],
    ['strDocParte', documentoMascarado],
    ['selIdClasseSelecionados', ''],
    ['strChave', ''],
    ['chkExibirBaixados', 'on'],
  ]
}

/** `autor` e `reu` vêm como HTML: nunca vão para innerHTML, sempre por aqui. */
export function textoSemHtml(v: unknown): string {
  return String(v ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/gi, '&') // por último, para não decodificar duas vezes
    .replace(/\s+/g, ' ')
    .trim()
}

/** "A<br>B<br>e outros" vira ["A", "B"]. */
export function partesDoCampo(v: unknown): string[] {
  return String(v ?? '')
    .split(/<br\s*\/?>/i)
    .map(textoSemHtml)
    .filter((p) => p && !/^e outros$/i.test(p))
}

/**
 * O link do resultado vem com `#_processo=<n>&hash=<h>` depois de um `#`; o
 * navegador da própria página o transforma em `num_processo=<n>&hash=<h>` na
 * query. Reconstruímos isso. Sem `#`, o link já está pronto.
 */
export function linkDoProcesso(linkAssinado: string): string {
  const i = linkAssinado.indexOf('#')
  if (i < 0) return linkAssinado
  const frag = new URLSearchParams(linkAssinado.slice(i + 1))
  const numero = frag.get('_processo')
  const hash = frag.get('hash')
  if (!numero || !hash) throw new ErroEproc('LAYOUT', 'link do processo sem número ou hash')
  const params = new URLSearchParams({ num_processo: numero, hash })
  const antes = linkAssinado.slice(0, i)
  return `${antes}${antes.includes('?') ? '&' : '?'}${params.toString()}`
}

export type ProcessoDaLista = {
  numero: string // 20 dígitos; formatar só na hora de exibir (lib/numero.ts)
  autuacao: string
  juizo: string
  classe: string
  ultimoEvento: string
  situacao: string
  assuntos: string
  autores: string[]
  reus: string[]
  link: string // relativo à página, pronto para abrir em aba nova
}
export type ResultadoBusca = {
  processos: ProcessoDaLista[] // só os públicos
  sigilosos: number // só a contagem; o conteúdo nunca sai
  total: number // o que o eproc devolveu, sigilosos incluídos
  possivelCorte: boolean // 30 é o máximo visto na JFRS: a lista pode estar incompleta
}

export const TETO_OBSERVADO = 30
const texto = (v: unknown) => textoSemHtml(v)

/**
 * `resultados` ausente é ERRO DE LAYOUT, nunca "nenhum processo": um falso
 * "nunca litigou" é o pior erro possível aqui. Lista vazia é uma resposta.
 */
export function lerBusca(resposta: unknown): ResultadoBusca {
  const lista = (resposta as { resultados?: unknown } | null)?.resultados
  if (!Array.isArray(lista)) throw new ErroEproc('LAYOUT', 'resposta da busca sem resultados')
  const { publicos, sigilosos } = separar(lista as { id_sigilo?: unknown }[])
  const processos = publicos.map((p) => {
    const r = p as Record<string, unknown>
    if (typeof r.nr_processo !== 'string' || !/^\d{20}$/.test(r.nr_processo)) {
      throw new ErroEproc('LAYOUT', 'resultado sem número de processo válido')
    }
    if (typeof r.linkProcessoAssinado !== 'string' || !r.linkProcessoAssinado) throw new ErroEproc('LAYOUT', 'resultado sem link do processo')
    return {
      numero: r.nr_processo,
      autuacao: texto(r.autuacao),
      juizo: texto(r.str_sig_orgao_juizo),
      classe: texto(r.classe),
      ultimoEvento: texto(r.ultimo_evento),
      situacao: texto(r.des_situacao),
      assuntos: texto(r.des_assuntos),
      autores: partesDoCampo(r.autor),
      reus: partesDoCampo(r.reu),
      link: linkDoProcesso(r.linkProcessoAssinado),
    }
  })
  return { processos, sigilosos, total: lista.length, possivelCorte: lista.length >= TETO_OBSERVADO }
}
