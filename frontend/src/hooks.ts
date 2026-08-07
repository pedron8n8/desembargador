import { useEffect, useRef, useState } from 'react'

export const NOS = [
  'triagem',
  'recuperar',
  'triar',
  'prognostico',
  'redigir',
  'revisar',
  'julgar',
] as const

export type EstadoNo = 'pendente' | 'correndo' | 'pronto' | 'erro'

export type NoAoVivo = {
  estado: EstadoNo
  modelo?: string
  tokens_in?: number
  tokens_out?: number
  custo_usd?: number
  visitas: number
  inicio?: number
  ms?: number
}

export type Vivo = {
  nos: Record<string, NoAoVivo>
  logs: string[]
  concluido: boolean
  erro: string | null
  retomavel: boolean
  segundos: number | null
  custo_usd: number
  ultimoSeq: number
}

const zerado = (): Vivo => ({
  nos: {},
  logs: [],
  concluido: false,
  erro: null,
  retomavel: false,
  segundos: null,
  custo_usd: 0,
  ultimoSeq: 0,
})

/**
 * Consome os eventos SSE de uma consulta em andamento.
 *
 * O `id:` que o servidor manda em todo evento faz o EventSource nativo reenviar
 * Last-Event-ID sozinho ao reconectar — por isso não há retry manual aqui. O
 * servidor reproduz o que faltou a partir do banco antes de voltar a transmitir.
 */
export function useEventos(thread: string | undefined, ativo: boolean) {
  const [vivo, setVivo] = useState<Vivo>(zerado)
  const ref = useRef<EventSource | null>(null)

  useEffect(() => {
    if (!thread || !ativo) return
    setVivo(zerado())
    const es = new EventSource(`/api/consultas/${thread}/eventos`)
    ref.current = es

    const ouvir = (tipo: string, f: (p: any, seq: number) => void) =>
      es.addEventListener(tipo, (e) => {
        const ev = e as MessageEvent
        f(JSON.parse(ev.data), Number(ev.lastEventId || 0))
      })

    ouvir('no_inicio', (p, seq) =>
      setVivo((v) => {
        const antes = v.nos[p.no]
        return {
          ...v,
          ultimoSeq: seq,
          nos: {
            ...v.nos,
            [p.no]: {
              ...antes,
              estado: 'correndo',
              visitas: (antes?.visitas ?? 0) + 1,
              inicio: Date.now(),
            },
          },
        }
      }),
    )

    ouvir('no_fim', (p, seq) =>
      setVivo((v) => {
        const antes = v.nos[p.no] ?? { visitas: 1 }
        // um nó pode fazer 2 chamadas (refação por teto de tokens): somam
        const c = (p.custos ?? []) as any[]
        const usd = c.reduce((s, x) => s + (x.custo_usd ?? 0), 0)
        return {
          ...v,
          ultimoSeq: seq,
          custo_usd: v.custo_usd + usd,
          nos: {
            ...v.nos,
            [p.no]: {
              ...antes,
              estado: p.erro ? 'erro' : 'pronto',
              modelo: c[0]?.modelo ?? antes.modelo,
              tokens_in: (antes.tokens_in ?? 0) + c.reduce((s, x) => s + (x.tokens_in ?? 0), 0),
              tokens_out: (antes.tokens_out ?? 0) + c.reduce((s, x) => s + (x.tokens_out ?? 0), 0),
              custo_usd: (antes.custo_usd ?? 0) + usd,
              ms: antes.inicio ? Date.now() - antes.inicio : antes.ms,
            },
          },
        }
      }),
    )

    ouvir('log', (p, seq) =>
      setVivo((v) => ({ ...v, ultimoSeq: seq, logs: [...v.logs, p.linha].slice(-200) })),
    )

    ouvir('fim', (p, seq) =>
      setVivo((v) => ({
        ...v,
        ultimoSeq: seq,
        concluido: true,
        segundos: p.segundos,
        custo_usd: p.custo_usd ?? v.custo_usd,
      })),
    )

    ouvir('erro', (p, seq) =>
      setVivo((v) => ({
        ...v,
        ultimoSeq: seq,
        concluido: true,
        erro: p.mensagem,
        retomavel: !!p.retomavel,
      })),
    )

    return () => {
      es.close()
      ref.current = null
    }
  }, [thread, ativo])

  // fecha o stream assim que a consulta termina: nada a ouvir depois disso
  useEffect(() => {
    if (vivo.concluido) ref.current?.close()
  }, [vivo.concluido])

  return vivo
}

/** Formata US$ com 4 casas — a conta do OpenRouter é em centavos de centavo. */
export const usd = (v: number | null | undefined) =>
  v == null ? '—' : `US$ ${v.toFixed(4)}`

export const pct = (v: number | null | undefined, casas = 0) =>
  v == null ? '—' : `${v.toFixed(casas)}%`

export const dataBR = (s: string | null | undefined) => {
  if (!s) return '—'
  const d = new Date(s.length <= 10 ? `${s}T00:00:00` : s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString('pt-BR')
}
