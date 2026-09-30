import type { ListaCerebros } from '../../../src/api.ts'
import { cerebroDoRelator } from '../caso/relator.ts'

/**
 * Qual cérebro analisa o processo. Só entram cérebros ativos e com índice (um que
 * não tem acervo responderia com zero precedente e pareceria defeito). Se o relator
 * do processo tem cérebro, é ele; senão o padrão do sistema, com um aviso dizendo
 * isso: nunca uma escolha calada.
 */
export function escolherCerebro(relator: string | null, lista: ListaCerebros): { slug: string; aviso: string | null } {
  const disponiveis = lista.itens.filter((c) => c.ativo && c.tem_indice)
  const doRelator = cerebroDoRelator(relator, disponiveis)
  if (doRelator) return { slug: doRelator, aviso: null }
  const padrao = disponiveis.find((c) => c.slug === lista.padrao) ?? disponiveis[0]
  if (!padrao) return { slug: '', aviso: 'Nenhum cérebro está disponível para analisar.' }
  const quem = relator ? `O relator deste processo (${relator}) não tem cérebro no sistema` : 'O relator do processo não foi identificado'
  return { slug: padrao.slug, aviso: `${quem}; a análise usa o perfil de ${padrao.nome}.` }
}
