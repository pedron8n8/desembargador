/**
 * Primitivas de gráfico em SVG puro.
 *
 * Sem Recharts/Nivo/ECharts de propósito: os três impõem os próprios defaults
 * visuais — tooltip arredondado, sombra, animação de entrada — que são
 * exatamente o que frontend/DESIGN.md proíbe, e nenhum deles desenha a rede de
 * força. Uma escala linear é `(v-min)/(max-min)*h`; um caminho é um join. Não
 * vale uma dependência.
 */

type Ponto = { rotulo: string; valor: number | null; n?: number }

const escala = (v: number, min: number, max: number, tamanho: number) =>
  max === min ? tamanho / 2 : ((v - min) / (max - min)) * tamanho

export function Barras({
  dados,
  altura = 200,
  sufixo = '%',
  max,
  destaque,
}: {
  dados: Ponto[]
  altura?: number
  sufixo?: string
  max?: number
  destaque?: (p: Ponto) => boolean
}) {
  const validos = dados.filter((d) => d.valor != null)
  if (!validos.length) return <p className="vazio">sem dados</p>
  const teto = max ?? Math.max(...validos.map((d) => d.valor!)) * 1.15
  const L = 1000
  const larguraBarra = L / dados.length
  const padding = Math.min(10, larguraBarra * 0.22)

  return (
    <div className="gr">
      <svg viewBox={`0 0 ${L} ${altura + 46}`}>
        {dados.map((d, i) => {
          if (d.valor == null) return null
          const h = escala(d.valor, 0, teto, altura)
          return (
            <g key={d.rotulo + i}>
              <rect
                className={`barra${destaque && !destaque(d) ? ' secundaria' : ''}`}
                x={i * larguraBarra + padding}
                y={altura - h}
                width={larguraBarra - 2 * padding}
                height={h}
              />
              <text x={i * larguraBarra + larguraBarra / 2} y={altura - h - 5} textAnchor="middle">
                {d.valor.toFixed(1)}
                {sufixo}
              </text>
              <text
                className="rotulo"
                x={i * larguraBarra + larguraBarra / 2}
                y={altura + 16}
                textAnchor="middle"
              >
                {d.rotulo}
              </text>
              {d.n != null && (
                <text x={i * larguraBarra + larguraBarra / 2} y={altura + 30} textAnchor="middle">
                  n={d.n.toLocaleString('pt-BR')}
                </text>
              )}
            </g>
          )
        })}
        <line className="regua" x1={0} y1={altura} x2={L} y2={altura} />
      </svg>
    </div>
  )
}

export function Serie({
  dados,
  altura = 220,
  sufixo = '%',
}: {
  dados: Ponto[]
  altura?: number
  sufixo?: string
}) {
  const validos = dados.filter((d) => d.valor != null)
  if (validos.length < 2) return <p className="vazio">sem série</p>
  const L = 1000
  const vs = validos.map((d) => d.valor!)
  const min = Math.min(...vs)
  const max = Math.max(...vs)
  const folga = (max - min) * 0.2 || 1
  const y = (v: number) => altura - escala(v, min - folga, max + folga, altura)
  const x = (i: number) => (i / (validos.length - 1)) * L

  const caminho = validos.map((d, i) => `${i ? 'L' : 'M'} ${x(i)} ${y(d.valor!)}`).join(' ')
  const passo = Math.ceil(validos.length / 14)

  return (
    <div className="gr">
      <svg viewBox={`0 -12 ${L} ${altura + 40}`}>
        <path className="traco" d={caminho} />
        {validos.map((d, i) => (
          <g key={d.rotulo + i}>
            <circle className="ponto" cx={x(i)} cy={y(d.valor!)} r={2.5}>
              <title>
                {d.rotulo}: {d.valor!.toFixed(1)}
                {sufixo}
                {d.n != null ? ` (n=${d.n})` : ''}
              </title>
            </circle>
            {i % passo === 0 && (
              <text className="rotulo" x={x(i)} y={altura + 18} textAnchor="middle">
                {d.rotulo}
              </text>
            )}
          </g>
        ))}
        {/* rótulo direto nos extremos, em vez de eixo Y com malha */}
        <text x={4} y={y(max) - 6}>
          {max.toFixed(1)}
          {sufixo}
        </text>
        <text x={4} y={y(min) + 14}>
          {min.toFixed(1)}
          {sufixo}
        </text>
        <line className="regua" x1={0} y1={altura} x2={L} y2={altura} />
      </svg>
    </div>
  )
}

/** Curva de confiabilidade: previsto no eixo X, observado no Y, diagonal = honesto. */
export function Confiabilidade({
  curva,
  altura = 300,
}: {
  curva: { lo: number; hi: number; n: number; previsto: number; real: number }[]
  altura?: number
}) {
  if (!curva.length) return <p className="vazio">sem curva medida</p>
  const L = 340
  const x = (v: number) => v * L
  const y = (v: number) => altura - v * altura

  return (
    <div className="gr" style={{ maxWidth: 400 }}>
      <svg viewBox={`-8 -8 ${L + 40} ${altura + 40}`}>
        <path className="traco referencia" d={`M ${x(0)} ${y(0)} L ${x(1)} ${y(1)}`} />
        <path
          className="traco"
          d={curva.map((c, i) => `${i ? 'L' : 'M'} ${x(c.previsto)} ${y(c.real)}`).join(' ')}
        />
        {curva.map((c, i) => (
          <circle key={i} className="ponto" cx={x(c.previsto)} cy={y(c.real)} r={3}>
            <title>
              previsto {(100 * c.previsto).toFixed(0)}% · observado {(100 * c.real).toFixed(0)}% ·
              n={c.n}
            </title>
          </circle>
        ))}
        <line className="regua" x1={0} y1={altura} x2={L} y2={altura} />
        <line className="regua" x1={0} y1={0} x2={0} y2={altura} />
        <text x={L / 2} y={altura + 26} textAnchor="middle" className="rotulo">
          previsto
        </text>
        <text x={L + 6} y={12} className="rotulo">
          observado
        </text>
      </svg>
    </div>
  )
}
