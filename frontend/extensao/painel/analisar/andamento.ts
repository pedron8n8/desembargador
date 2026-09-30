import type { EventoSse } from './sse.ts'

// O que o painel mostra enquanto a consulta roda: em que nó está, quanto custou,
// se terminou. Mesma semântica de `useEventos` (frontend/src/hooks.ts), mais curta:
// o painel não desenha o grafo.
export type Andamento = {
  no: string | null // nó em execução agora
  nos: string[] // nós já iniciados, na ordem
  concluido: boolean
  erro: string | null
  retomavel: boolean
  segundos: number | null
  custo_usd: number
}

export const andamentoInicial = (): Andamento => ({
  no: null, nos: [], concluido: false, erro: null, retomavel: false, segundos: null, custo_usd: 0,
})

type Payload = Record<string, unknown>
const texto = (v: unknown) => (typeof v === 'string' ? v : '')
const numero = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

export function aplicar(a: Andamento, e: EventoSse): Andamento {
  const p = (e.dados && typeof e.dados === 'object' ? e.dados : {}) as Payload
  switch (e.tipo) {
    case 'inicio':
      // uma retomada publica 'inicio' de novo e o replay vem do começo: zera a
      // tentativa anterior (o erro velho não pode ficar na tela), mas mantém o custo
      return { ...andamentoInicial(), custo_usd: a.custo_usd }
    case 'no_inicio': {
      const no = texto(p.no)
      return no ? { ...a, no, nos: a.nos.includes(no) ? a.nos : [...a.nos, no] } : a
    }
    case 'no_fim': {
      const custos = Array.isArray(p.custos) ? (p.custos as Payload[]) : []
      const soma = custos.reduce((s, c) => s + numero(c.custo_usd), 0)
      return { ...a, no: a.no === texto(p.no) ? null : a.no, custo_usd: a.custo_usd + soma }
    }
    case 'fim':
      return { ...a, no: null, concluido: true, segundos: typeof p.segundos === 'number' ? p.segundos : a.segundos,
        custo_usd: typeof p.custo_usd === 'number' ? p.custo_usd : a.custo_usd }
    case 'erro':
      return { ...a, no: null, concluido: true, erro: texto(p.mensagem) || 'a consulta falhou', retomavel: !!p.retomavel }
    default:
      return a // 'log' e o que vier a existir: o painel não mostra
  }
}
