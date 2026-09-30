import { ErroEproc } from '../../agente/lib/erros.ts'
import type { Peca } from '../../agente/lib/caso.ts'
import type { Item } from '../caso/montagem.ts'
import type { Papel } from '../caso/pecas.ts'
import type { ApiAnalise } from './apiAnalise.ts'
import type { Fonte } from './fonte.ts'

export type FalhaDePeca = { rotulo: string; motivo: string }

function motivoDaFalha(e: unknown): string {
  if (e instanceof ErroEproc) return e.tipo === 'SIGILOSO' ? 'em sigilo' : 'o eproc não devolveu a peça'
  return e instanceof Error && e.message ? e.message : 'não foi possível ler a peça'
}

/**
 * Lê o texto de cada peça marcada, uma por vez (o agente já serializa as
 * requisições ao eproc). Uma peça que falha sai do texto e entra em `falhas` com o
 * motivo: não derruba a montagem. Sessão caída e captcha derrubam (continuar não
 * adianta: o eproc vai falhar igual em todas) e sobem como ErroEproc.
 */
export async function lerPecas(
  fonte: Pick<Fonte, 'documento'>,
  api: Pick<ApiAnalise, 'extrair'>,
  escolhidas: { papel: Papel; peca: Peca }[],
): Promise<{ itens: Item[]; falhas: FalhaDePeca[] }> {
  const itens: Item[] = []
  const falhas: FalhaDePeca[] = []
  for (const { papel, peca } of escolhidas) {
    try {
      const doc = await fonte.documento(peca.ref)
      const texto = doc.tipo === 'texto' ? doc.texto : await api.extrair(doc.nome, doc.base64)
      if (texto.trim()) itens.push({ papel, peca, texto })
      else falhas.push({ rotulo: peca.rotulo, motivo: 'a peça não tem texto' })
    } catch (e) {
      if (e instanceof ErroEproc && (e.tipo === 'NAO_LOGADO' || e.tipo === 'CAPTCHA')) throw e
      falhas.push({ rotulo: peca.rotulo, motivo: motivoDaFalha(e) })
    }
  }
  return { itens, falhas }
}
