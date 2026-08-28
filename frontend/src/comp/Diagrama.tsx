import { useEffect, useRef, useState } from 'react'

/* Um diagrama de nós e setas, topo→baixo.
 *
 * Existe porque duas seções pediam o mesmo desenho: a CONTA (dois estimadores
 * que confluem, viram escala e passam por um portão) e a PROVA (400 casos que
 * se dividem em responde/cala e depois em acerta/erra). As duas são árvores —
 * uma converge, a outra abre — e escrever dois SVGs à mão para isso seria
 * manter dois layouts que fazem a mesma coisa.
 *
 * Caixa, e não círculo como na árvore da floresta: aqui cada nó carrega um
 * número e uma frase, e texto centrado em cima de um círculo ou vaza ou
 * encolhe até deixar de ser texto.
 */

export type NoDiag = {
  id: string
  /** o que o nó é */
  rotulo: string
  /** o número que ele carrega */
  valor?: string
  /** uma linha de explicação, quebrada automaticamente */
  nota?: string
  nivel: number
  tom?: 'verde' | 'ambar' | 'neutro' | 'fora'
  /** de quais nós vêm as setas que chegam aqui */
  de?: string[]
  /** o que está escrito na seta que chega */
  rotuloAresta?: string
}

const W = 1100
const CAIXA_L = 250
const CAIXA_A = 96
const PASSO = 168
const TOPO = 26
const BATIDA = 900

const TOM: Record<string, string> = {
  verde: '#4ec5b3',
  ambar: '#d9a441',
  neutro: '#6d7d7d',
  fora: '#3f5052',
}

/** Quebra por contagem de caracteres. O SVG não quebra texto sozinho, e medir
 *  de verdade exigiria montar e remontar o nó a cada render — para uma frase de
 *  uma linha, contar caractere acerta o suficiente. */
function linhas(t: string, largura = 34, max = 2) {
  const saida: string[] = []
  let atual = ''
  for (const palavra of t.split(' ')) {
    if (atual && (atual + ' ' + palavra).length > largura) {
      saida.push(atual)
      atual = palavra
      if (saida.length === max) break
    } else {
      atual = atual ? `${atual} ${palavra}` : palavra
    }
  }
  if (saida.length < max && atual) saida.push(atual)
  return saida
}

export function Diagrama({ nos, rotulo }: { nos: NoDiag[]; rotulo: string }) {
  const [n, defN] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const niveis = Math.max(...nos.map((x) => x.nivel)) + 1

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      defN(niveis)
      return
    }
    const obs = new IntersectionObserver(([e]) => {
      if (!e?.isIntersecting) return
      obs.disconnect()
      defN(1)
    }, { threshold: 0.25 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [niveis])

  useEffect(() => {
    if (n < 1 || n >= niveis) return
    const t = setTimeout(() => defN(n + 1), BATIDA)
    return () => clearTimeout(t)
  }, [n, niveis])

  const H = TOPO + niveis * PASSO - (PASSO - CAIXA_A) + 20
  const porNivel = new Map<number, NoDiag[]>()
  for (const x of nos) porNivel.set(x.nivel, [...(porNivel.get(x.nivel) ?? []), x])

  const cx = (x: NoDiag) => {
    const fila = porNivel.get(x.nivel)!
    const i = fila.indexOf(x)
    return (W / (fila.length + 1)) * (i + 1)
  }
  const cy = (x: NoDiag) => TOPO + x.nivel * PASSO
  const porId = new Map(nos.map((x) => [x.id, x]))
  const aceso = (x: NoDiag) => x.nivel < n

  return (
    <div className="apr-diagrama" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={rotulo}>
        <defs>
          <marker id="apr-diag-seta" viewBox="0 0 8 8" refX="7" refY="4"
            markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 1 L7 4 L0 7 z" fill="currentcolor" />
          </marker>
        </defs>

        {/* --- as setas */}
        {nos.map((x) => (x.de ?? []).map((idPai) => {
          const pai = porId.get(idPai)
          if (!pai) return null
          const x1 = cx(pai)
          const y1 = cy(pai) + CAIXA_A / 2
          const x2 = cx(x)
          const y2 = cy(x) - CAIXA_A / 2 - 8
          return (
            <g key={`${idPai}-${x.id}`}
              className={`apr-diag-seta${aceso(x) ? ' acesa' : ''}`}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} markerEnd="url(#apr-diag-seta)" />
              {x.rotuloAresta && (
                <text x={(x1 + x2) / 2 + (x2 === x1 ? 10 : x2 > x1 ? 14 : -14)}
                  y={(y1 + y2) / 2 + 4}
                  textAnchor={x2 >= x1 ? 'start' : 'end'}>
                  {x.rotuloAresta}
                </text>
              )}
            </g>
          )
        }))}

        {/* --- as caixas */}
        {nos.map((x) => {
          const cor = TOM[x.tom ?? 'neutro']
          const on = aceso(x)
          const meio = cx(x)
          const topo = cy(x) - CAIXA_A / 2
          const nota = x.nota ? linhas(x.nota) : []
          return (
            <g key={x.id} className={`apr-diag-no${on ? ' acesa' : ''}`}>
              <rect x={meio - CAIXA_L / 2} y={topo} width={CAIXA_L} height={CAIXA_A}
                rx={2} stroke={cor} />
              <text x={meio} y={topo + 22} textAnchor="middle" className="apr-diag-rot">
                {x.rotulo}
              </text>
              {x.valor && (
                <text x={meio} y={topo + 56} textAnchor="middle"
                  className="apr-diag-valor" fill={cor}>
                  {x.valor}
                </text>
              )}
              {nota.map((linha, i) => (
                <text key={i} x={meio} y={topo + (x.valor ? 76 : 48) + i * 15}
                  textAnchor="middle" className="apr-diag-nota">
                  {linha}
                </text>
              ))}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
