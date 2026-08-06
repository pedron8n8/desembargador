import { useQuery } from '@tanstack/react-query'

import { get } from '../api'
import { NOS, usd, type Vivo } from '../hooks'

// Layout à mão: o grafo tem 7 nós e forma conhecida (está desenhada no docstring
// de src/rag/grafo.py). Um dagre para isto seria uma dependência para desenhar
// uma linha reta com dois arcos de volta.
const L = 148 // largura do nó
const A = 46 // altura
const GX = 34 // vão horizontal
const Y = 74 // linha de base
const POS = NOS.map((no, i) => ({ no, x: i * (L + GX), y: Y }))
const LARGURA = NOS.length * (L + GX) - GX

const ROTULO: Record<string, string> = {
  triagem: 'triagem',
  recuperar: 'recuperar',
  triar: 'triar',
  prognostico: 'prognóstico',
  redigir: 'redigir',
  revisar: 'revisar',
  julgar: 'julgar',
}

// Os dois ciclos, que são a razão de o projeto usar LangGraph em vez de um script
const CICLOS: [string, string, string][] = [
  ['triar', 'recuperar', 'poucos precedentes'],
  ['revisar', 'redigir', 'revisor reprovou'],
]

function arco(de: number, para: number) {
  const x1 = POS[de].x + L / 2
  const x2 = POS[para].x + L / 2
  const topo = Y - 42
  return `M ${x1} ${Y} C ${x1} ${topo}, ${x2} ${topo}, ${x2} ${Y}`
}

export function PipelineAoVivo({
  vivo,
  soPrognostico,
}: {
  vivo: Vivo
  soPrognostico?: boolean
}) {
  // a topologia vem do servidor (grafo.construir().get_graph()), não de um
  // desenho fixo: se um nó for acrescentado ao grafo, isto avisa
  const { data: topo } = useQuery({
    queryKey: ['grafo'],
    queryFn: () => get<{ nos: { id: string }[] }>('/api/grafo'),
    staleTime: Infinity,
  })
  const conhecidos = new Set(NOS as readonly string[])
  const extras = (topo?.nos ?? [])
    .map((n) => n.id)
    .filter((n) => !n.startsWith('__') && !conhecidos.has(n))

  const ativos = soPrognostico ? NOS.slice(0, 4) : NOS
  const total = Object.values(vivo.nos).reduce((s, n) => s + (n.custo_usd ?? 0), 0)

  return (
    <div className="pipe">
      <svg viewBox={`0 -12 ${LARGURA} 148`} role="img" aria-label="Andamento da consulta">
        {ativos.slice(0, -1).map((_, i) => {
          const percorrida = vivo.nos[ativos[i]]?.estado === 'pronto'
          return (
            <line
              key={i}
              className={`pipe-aresta${percorrida ? ' percorrida' : ''}`}
              x1={POS[i].x + L}
              y1={Y + A / 2}
              x2={POS[i + 1].x}
              y2={Y + A / 2}
            />
          )
        })}

        {CICLOS.map(([de, para, rotulo]) => {
          const i = NOS.indexOf(de as (typeof NOS)[number])
          const j = NOS.indexOf(para as (typeof NOS)[number])
          if (!ativos.includes(de as (typeof NOS)[number])) return null
          const voltas = Math.max(0, (vivo.nos[para]?.visitas ?? 1) - 1)
          return (
            <g key={de}>
              <path className={`pipe-aresta ciclo${voltas ? ' percorrida' : ''}`} d={arco(i, j)} />
              <text
                className="pipe-volta"
                x={(POS[i].x + POS[j].x) / 2 + L / 2}
                y={Y - 48}
                textAnchor="middle"
              >
                {voltas ? `${voltas}ª volta — ${rotulo}` : rotulo}
              </text>
            </g>
          )
        })}

        {ativos.map((no, i) => {
          const n = vivo.nos[no]
          const estado = n?.estado ?? 'pendente'
          return (
            <g key={no} className={`pipe-no ${estado}`} transform={`translate(${POS[i].x},${Y})`}>
              <rect width={L} height={A} rx={2} />
              <text x={10} y={19}>
                {ROTULO[no]}
              </text>
              <text className="meta" x={10} y={33}>
                {estado === 'pendente'
                  ? soPrognostico && i >= 4
                    ? '—'
                    : 'aguardando'
                  : estado === 'correndo'
                    ? (n?.modelo ?? 'rodando…')
                    : `${n?.tokens_in ?? 0}/${n?.tokens_out ?? 0} tok · ${usd(n?.custo_usd)}`}
              </text>
              {n?.visitas != null && n.visitas > 1 && (
                <text className="meta" x={L - 10} y={19} textAnchor="end">
                  ×{n.visitas}
                </text>
              )}
            </g>
          )
        })}
      </svg>

      <div className="faixa" style={{ marginTop: 'var(--e4)', border: 0, padding: 0, background: 'transparent' }}>
        <div className="medida">
          <dt>gasto até aqui</dt>
          <dd>{usd(total || vivo.custo_usd)}</dd>
        </div>
        {vivo.segundos != null && (
          <div className="medida">
            <dt>duração</dt>
            <dd>
              {Math.round(vivo.segundos)}
              <small> s</small>
            </dd>
          </div>
        )}
      </div>

      {extras.length > 0 && (
        <p className="aviso" style={{ marginTop: 'var(--e3)' }}>
          O grafo do servidor tem nós que este desenho não conhece:{' '}
          <strong>{extras.join(', ')}</strong>. Atualize <code>NOS</code> em{' '}
          <code>web/src/hooks.ts</code>.
        </p>
      )}

      {vivo.logs.length > 0 && (
        <pre className="pipe-log">{vivo.logs.join('\n')}</pre>
      )}
    </div>
  )
}
