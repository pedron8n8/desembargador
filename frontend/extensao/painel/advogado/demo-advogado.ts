// Intimações e prazos de MENTIRA para apresentar o painel do advogado sem eproc e sem
// login (página de demonstração). Tudo FICTÍCIO; as datas são relativas a `hoje`, para
// o destaque de prazo próximo aparecer sempre, em qualquer dia da apresentação.
import type { FonteAdvogado, ItemPainel } from './fonteAdvogado.ts'

const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const dd = (n: number) => String(n).padStart(2, '0')

/** `hoje` mais `dias`, como dd/mm/aaaa (o formato que o eproc mostra). */
export function dataEm(hoje: Date, dias: number): string {
  const d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + dias)
  return `${dd(d.getDate())}/${dd(d.getMonth() + 1)}/${d.getFullYear()}`
}

export function itensDemo(hoje: Date): ItemPainel[] {
  const item = (n: number, tipo: ItemPainel['tipo'], evento: string, inicio: number, prazo: number | null, extra: Partial<ItemPainel> = {}): ItemPainel => ({
    ref: `adv-${n}`, processo: `5001234562020824${String(n).padStart(4, '0')}`, classe: 'APELAÇÃO CÍVEL', tipo, evento,
    inicio: dataEm(hoje, inicio), prazoFinal: prazo === null ? null : dataEm(hoje, prazo), sigiloso: false, ...extra,
  })
  return [
    item(23, 'prazo', 'Intimação para contrarrazões', -3, 2),
    item(7, 'prazo', 'Prazo para manifestação sobre o laudo', -15, -1),
    item(41, 'intimacao', 'Intimação da decisão de saneamento', -1, 20, { classe: 'PROCEDIMENTO COMUM CÍVEL' }),
    item(58, 'intimacao', 'Intimação para ciência do despacho', 0, null, { classe: 'MANDADO DE SEGURANÇA' }),
    item(90, 'prazo', 'Prazo reservado', -2, 4, { sigiloso: true }),
  ]
}

export function fonteAdvogadoDemo(pausaMs = 300, hoje: () => Date = () => new Date()): FonteAdvogado & { abertas(): string[] } {
  const abertas: string[] = []
  return {
    async painel() { await esperar(pausaMs); return itensDemo(hoje()) },
    async abrir(ref) { await esperar(pausaMs); abertas.push(ref) },
    abertas: () => abertas,
  }
}
