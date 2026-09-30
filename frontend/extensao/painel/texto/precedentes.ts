import type { Precedente } from '../../../src/api.ts'

/** O que o painel usa de cada precedente que o servidor devolve (GET /api/corpus). */
export type PrecedenteResumo = Pick<Precedente, 'id' | 'numero' | 'classe' | 'orgao' | 'data' | 'resultado' | 'ementa'>
export type ResultadoPrecedentes = { total: number; itens: PrecedenteResumo[] }

export const EMENTA_MAX = 300

/** Corta no último espaço antes do limite e põe reticências; texto curto sai como está. */
export function resumirEmenta(ementa: string | null | undefined, max = EMENTA_MAX): string {
  const t = (ementa ?? '').replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const corte = t.slice(0, max)
  const espaco = corte.lastIndexOf(' ')
  return (espaco > max / 2 ? corte.slice(0, espaco) : corte).trimEnd() + '…'
}

/** As três linhas de cada precedente na lista do painel. */
export function linhaDoPrecedente(p: PrecedenteResumo): { titulo: string; meta: string; ementa: string } {
  return {
    titulo: p.classe ? `${p.numero} · ${p.classe}` : p.numero,
    meta: [p.orgao, p.data, p.resultado].filter((x): x is string => !!x).join(' · '),
    ementa: resumirEmenta(p.ementa),
  }
}
