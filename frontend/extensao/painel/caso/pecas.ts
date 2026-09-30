import type { Peca } from '../../agente/lib/caso.ts'

// Códigos de tipo de documento. Vistos no HAR da JFRS: SENT, DESPADEC, ATOORD
// (e INIC segundo o guia). APELACAO, AGRAVO e CONT são PALPITES — conferir no
// HAR do TJSC e ajustar SÓ aqui; os testes usam estas listas, não os literais.
export const TIPOS = {
  sentenca: ['SENT'],
  decisao: ['DESPADEC'],
  recurso: ['APELACAO', 'AGRAVO'],
  inicial: ['INIC'],
  contestacao: ['CONT'],
}

export type Papel = 'decisao' | 'recurso' | 'inicial' | 'contestacao'
export type Selecao = { papel: Papel; peca: Peca }

const ultima = (ps: Peca[]) => ps.reduce<Peca | undefined>((a, p) => (!a || p.evento > a.evento ? p : a), undefined)
const primeira = (ps: Peca[]) => ps.reduce<Peca | undefined>((a, p) => (!a || p.evento < a.evento ? p : a), undefined)

function escolher(pecas: Peca[]): Selecao[] {
  const de = (tipos: string[]) => pecas.filter((p) => tipos.includes(p.tipo))

  const decisao = ultima(de(TIPOS.sentenca)) ?? ultima(de(TIPOS.decisao))
  const recursos = de(TIPOS.recurso).filter((p) => !decisao || p.evento > decisao.evento)
  const alvos: [Papel, Peca | undefined][] = [
    ['decisao', decisao],
    ['recurso', ultima(recursos)],
    ['inicial', primeira(de(TIPOS.inicial))],
    ['contestacao', primeira(de(TIPOS.contestacao))],
  ]
  return alvos.flatMap(([papel, peca]) => (peca ? [{ papel, peca }] : []))
}

/**
 * Pré-marca as peças que a análise mais precisa, NA ORDEM DE PRIORIDADE (não
 * cronológica): decisão recorrida, recurso, petição inicial, contestação. A
 * ordem importa porque o pipeline lê só os primeiros `max_chars_caso`
 * caracteres do caso; se o texto passar do limite, o corte leva o que menos importa.
 * Peça sigilosa nunca é selecionada.
 */
export function preselecionar(pecas: Peca[]): Selecao[] {
  return escolher(pecas.filter((p) => !p.sigiloso))
}

/**
 * Papéis cuja peça "de verdade" (a que seria escolhida se nada fosse sigiloso) está em
 * sigilo. `preselecionar` troca essa peça pela próxima candidata pública; a tela tem de
 * avisar ("a sentença está em sigilo e não pode ser lida"), senão uma decisão mais antiga
 * passa por "decisão recorrida" sem ninguém perceber.
 */
export function bloqueadasPorSigilo(pecas: Peca[]): Papel[] {
  return escolher(pecas).filter((s) => s.peca.sigiloso).map((s) => s.papel)
}
