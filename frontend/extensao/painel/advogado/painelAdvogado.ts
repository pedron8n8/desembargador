import { formatarNumeroProcesso } from '../../agente/lib/numero.ts'
import type { ItemPainel } from './fonteAdvogado.ts'

export type Situacao = 'vencido' | 'proximo' | 'normal' | 'sem_prazo'
export type LinhaPainel = {
  item: ItemPainel
  processoFormatado: string
  situacao: Situacao
  /** Dias corridos até o prazo final que o eproc informa (negativo = já passou); null sem data legível. */
  dias: number | null
  /** O eproc mandou uma data que não conseguimos ler: mostramos o texto dele e não destacamos nada. */
  dataIlegivel: boolean
}

/**
 * Janela do destaque, em dias CORRIDOS. O spec pede "até 5 dias úteis"; sem a tabela de
 * feriados não sabemos contar dias úteis, e errar para o lado de destacar MENOS seria o
 * erro perigoso. 7 corridos cobre 5 úteis (fora feriados) e destaca a mais, nunca a menos.
 * É só um destaque: o sistema NÃO calcula prazo processual, mostra o que o eproc informa.
 */
export const JANELA_DESTAQUE_DIAS = 7

const DIA = 86_400_000

/** dd/mm/aaaa -> dia do calendário (meia-noite UTC), ou null se não for uma data real. */
export function lerData(texto: string): number | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto.trim())
  if (!m) return null
  const [dia, mes, ano] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const t = Date.UTC(ano, mes - 1, dia)
  const d = new Date(t)
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia ? t : null
}

/** O dia do calendário de `hoje` (no fuso local) como meia-noite UTC, para subtrair dias inteiros. */
const diaDe = (hoje: Date) => Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())

function linha(item: ItemPainel, hoje: number): LinhaPainel {
  const base = { item, processoFormatado: formatarNumeroProcesso(item.processo) }
  if (item.prazoFinal === null) return { ...base, situacao: 'sem_prazo', dias: null, dataIlegivel: false }
  const t = lerData(item.prazoFinal)
  if (t === null) return { ...base, situacao: 'sem_prazo', dias: null, dataIlegivel: true }
  const dias = Math.round((t - hoje) / DIA)
  return { ...base, dias, dataIlegivel: false, situacao: dias < 0 ? 'vencido' : dias <= JANELA_DESTAQUE_DIAS ? 'proximo' : 'normal' }
}

/**
 * Prepara a lista: só os públicos (sigilosos viram contagem e nunca saem daqui), ordenados
 * pelo prazo final crescente (vencidos primeiro; sem data por último; empate por processo).
 */
export function prepararPainel(itens: ItemPainel[], hoje: Date): { linhas: LinhaPainel[]; sigilosos: number; total: number } {
  const dia = diaDe(hoje)
  const publicos = itens.filter((i) => !i.sigiloso)
  const linhas = publicos
    .map((i) => linha(i, dia))
    .sort((a, b) => (a.dias ?? Infinity) - (b.dias ?? Infinity) || a.item.processo.localeCompare(b.item.processo))
  return { linhas, sigilosos: itens.length - publicos.length, total: itens.length }
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

/** O aviso de sigilo que acompanha a lista; null quando não há nenhum. */
export function avisoSigilosos(n: number): string | null {
  return n > 0 ? `${plural(n, 'processo', 'processos')} em sigilo ${n === 1 ? 'não é mostrado' : 'não são mostrados'} pela extensão.` : null
}

/**
 * O texto para lista vazia. "Nenhuma intimação" só quando NÃO há nada em sigilo: dizer
 * "nenhuma" e "há sigilosos" na mesma tela se contradiz. Sempre diz a instância.
 */
export function mensagemVazia(r: { linhas: LinhaPainel[]; sigilosos: number }, instancia: '1g' | '2g' | null): string | null {
  if (r.linhas.length > 0) return null
  if (r.sigilosos > 0) return `Há ${plural(r.sigilosos, 'processo', 'processos')} em sigilo que a extensão não mostra.`
  return `Nenhuma intimação ou prazo pendente no eproc do TJSC (${instancia === '2g' ? '2º grau' : '1º grau'}).`
}

export const ROTULO_TIPO: Record<ItemPainel['tipo'], string> = { intimacao: 'Intimação', prazo: 'Prazo', outro: 'Outro' }
