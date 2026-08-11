import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import type { NoRede, Rede } from '../api'

type No = SimulationNodeDatum & NoRede
type Aresta = SimulationLinkDatum<No> & { tipo: 'ancora' | 'texto'; peso: number; rotulo: string | null }

const W = 900
const H = 560

const COR: Record<string, string> = {
  provido: '#7a5c3e',
  'parcialmente provido': '#a8875c',
  desprovido: '#3e5566',
}

const raio = (n: No) => {
  const p = n.pontos ?? 1
  return Math.max(4, Math.min(16, 3.5 * Math.sqrt(p)))
}

/**
 * A rede de precedentes.
 *
 * A âncora é NÓ, não aresta. Ligar decisão a decisão quando as duas citam a
 * mesma súmula produz cliques: 20 decisões sobre a Súmula 150 viravam 190
 * arestas e escondiam justamente o fato que interessa — qual precedente as
 * segura. Como nó, custa 20 arestas e lê-se “estas 20 se apoiam na Súmula 150”.
 */
export function RedePrecedentes({ r }: { r: Rede }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const navegar = useNavigate()
  const [tique, setTique] = useState(0)
  const [foco, setFoco] = useState<string | number | null>(null)

  const { nos, arestas } = useMemo(() => {
    const nos: No[] = r.nos.map((n) => ({ ...n }))
    const porId = new Map(nos.map((n) => [n.id, n]))
    const arestas: Aresta[] = r.arestas
      .filter((a) => porId.has(a.de) && porId.has(a.para))
      .map((a) => ({
        source: porId.get(a.de)!,
        target: porId.get(a.para)!,
        tipo: a.tipo,
        peso: a.peso,
        rotulo: a.rotulo,
      }))
    return { nos, arestas }
  }, [r])

  useEffect(() => {
    if (!nos.length) return
    const sim: Simulation<No, Aresta> = forceSimulation(nos)
      .force(
        'link',
        forceLink<No, Aresta>(arestas)
          .id((d) => d.id)
          // âncora puxa forte (é a afirmação jurídica); texto é pista, puxa fraco
          .distance((d) => (d.tipo === 'ancora' ? 70 : 110))
          .strength((d) => (d.tipo === 'ancora' ? 0.5 : 0.08 * d.peso)),
      )
      .force('carga', forceManyBody<No>().strength((d) => (d.tipo === 'ancora' ? -420 : -110)))
      .force('centro', forceCenter(W / 2, H / 2))
      .force('colisao', forceCollide<No>().radius((d) => (d.tipo === 'ancora' ? 46 : raio(d) + 5)))
      .alphaDecay(0.045)

    sim.on('tick', () => setTique((t) => t + 1))
    // roda até esfriar e para: simulação eterna é bateria queimada à toa
    return () => {
      sim.stop()
    }
  }, [nos, arestas])

  const vizinhos = useMemo(() => {
    if (foco == null) return null
    const s = new Set<string | number>([foco])
    for (const a of arestas) {
      const de = (a.source as No).id
      const para = (a.target as No).id
      if (de === foco) s.add(para)
      if (para === foco) s.add(de)
    }
    return s
  }, [foco, arestas])

  if (!r.nos.length) {
    return <p className="vazio">Esta consulta não recuperou candidatos — não há rede a desenhar.</p>
  }

  return (
    <div className="rede">
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} data-tique={tique} role="img"
        aria-label="Rede de precedentes e âncoras">
        <g>
          {arestas.map((a, i) => {
            const s = a.source as No
            const t = a.target as No
            const realce = vizinhos ? vizinhos.has(s.id) && vizinhos.has(t.id) : false
            const apagado = vizinhos && !realce
            return (
              <line
                key={i}
                className={`rede-aresta ${a.tipo}${realce ? ' realce' : ''}`}
                x1={s.x ?? 0}
                y1={s.y ?? 0}
                x2={t.x ?? 0}
                y2={t.y ?? 0}
                opacity={apagado ? 0.15 : 1}
              />
            )
          })}
        </g>

        {nos.map((n) => {
          const apagado = vizinhos && !vizinhos.has(n.id)
          if (n.tipo === 'ancora') {
            const largura = Math.min(150, 8 + (n.rotulo?.length ?? 4) * 5.6)
            return (
              <g
                key={n.id}
                className={`rede-hub${n.vinculante ? ' vinculante' : ''}`}
                transform={`translate(${(n.x ?? 0) - largura / 2},${(n.y ?? 0) - 11})`}
                opacity={apagado ? 0.25 : 1}
                onMouseEnter={() => setFoco(n.id)}
                onMouseLeave={() => setFoco(null)}
              >
                <rect width={largura} height={22} rx={2} />
                <text x={largura / 2} y={15} textAnchor="middle">
                  {n.rotulo}
                </text>
                <title>
                  {n.rotulo} — {n.grau} decisões se apoiam nela
                  {n.vinculante ? ' · vinculante em todo o país' : ''}
                </title>
              </g>
            )
          }
          return (
            <g
              key={n.id}
              className={`rede-no${n.precedente ? ' precedente' : ''}`}
              opacity={apagado ? 0.2 : 1}
              onMouseEnter={() => setFoco(n.id)}
              onMouseLeave={() => setFoco(null)}
              onClick={() => navegar(`/acervo/${n.id}`)}
            >
              <circle
                cx={n.x ?? 0}
                cy={n.y ?? 0}
                r={raio(n)}
                fill={COR[n.resultado ?? ''] ?? '#9a958c'}
                fillOpacity={n.nota ? 0.35 + 0.13 * n.nota : 0.4}
                {...(n.lado === 'contra'
                  ? // análogo que decide CONTRA a tese pedida. Fica visível sem
                    // hover de propósito: é a evidência que o modo tese produz,
                    // e evidência que só aparece no tooltip não é evidência.
                    { stroke: 'var(--alerta)', strokeWidth: 1.5, strokeDasharray: '2 2' }
                  : {})}
              />
              <title>
                {n.numero} — {n.resultado} — {n.ano}
                {n.nota ? ` · analogia ${n.nota}/5` : ''}
                {n.precedente ? ' · usado na minuta' : ''}
                {n.lado === 'a_favor' ? ' · sustenta a tese pedida' : ''}
                {n.lado === 'contra' ? ' · DECIDE CONTRA — descartado pela triagem' : ''}
                {n.lado === 'neutro' ? ' · neutro — descartado pela triagem' : ''}
              </title>
            </g>
          )
        })}
      </svg>

      <div className="rede-legenda">
        <span>
          <i style={{ background: COR.provido }} />
          provido
        </span>
        <span>
          <i style={{ background: COR['parcialmente provido'] }} />
          parcial
        </span>
        <span>
          <i style={{ background: COR.desprovido }} />
          desprovido
        </span>
        <span>
          <i style={{ background: '#9a958c' }} />
          processual
        </span>
        <span>anel preto = usado na minuta</span>
        {r.nos.some((n) => n.lado === 'contra') && (
          <span style={{ color: 'var(--alerta)' }}>
            contorno tracejado vermelho = análogo que decide CONTRA a tese pedida
          </span>
        )}
        <span>tamanho = pontos do ranking</span>
        <span>caixa = âncora citada por 2+ decisões</span>
        <span>traço cheio = âncora · tracejado = ementas parecidas</span>
        <span style={{ marginLeft: 'auto' }}>
          {r.resumo.n_decisoes} decisões · {r.resumo.n_ancoras} âncoras ·{' '}
          {r.resumo.isolados} isoladas
        </span>
      </div>
    </div>
  )
}
