import type { Peca } from '../../agente/lib/caso.ts'
import { bloqueadasPorSigilo, preselecionar, type Papel } from '../caso/pecas.ts'

export type ItemLista = { peca: Peca; papel: Papel; marcada: boolean }

// Ordem de prioridade do texto montado: o pipeline lê só os primeiros N
// caracteres, então o que menos importa vai para o fim (ver caso/pecas.ts).
const PRIORIDADE: Papel[] = ['decisao', 'recurso', 'inicial', 'contestacao', 'outra']

/**
 * A lista que o advogado vê: todas as peças, da mais recente para a mais antiga (como
 * o eproc mostra), com as escolhidas pela pré-seleção já marcadas. `bloqueadas`
 * diz quais peças-chave estão em sigilo, para a tela avisar.
 */
export function prepararLista(pecas: Peca[]): { itens: ItemLista[]; bloqueadas: Papel[] } {
  const escolhidas = new Map(preselecionar(pecas).map((s) => [s.peca.ref, s.papel]))
  const itens = [...pecas]
    .sort((a, b) => b.evento - a.evento)
    .map((peca) => ({ peca, papel: escolhidas.get(peca.ref) ?? ('outra' as Papel), marcada: escolhidas.has(peca.ref) }))
  return { itens, bloqueadas: bloqueadasPorSigilo(pecas) }
}

/** Liga ou desliga uma peça. Peça sigilosa nunca liga. Devolve uma lista nova. */
export function alternar(itens: ItemLista[], ref: string): ItemLista[] {
  return itens.map((i) => (i.peca.ref === ref && !i.peca.sigiloso ? { ...i, marcada: !i.marcada } : i))
}

/** As peças marcadas, na ordem em que entram no texto: prioridade do papel e, dentro dele, a mais antiga primeiro. */
export function marcadas(itens: ItemLista[]): { papel: Papel; peca: Peca }[] {
  return itens
    .filter((i) => i.marcada && !i.peca.sigiloso)
    .sort((a, b) => PRIORIDADE.indexOf(a.papel) - PRIORIDADE.indexOf(b.papel) || a.peca.evento - b.peca.evento)
    .map(({ papel, peca }) => ({ papel, peca }))
}
