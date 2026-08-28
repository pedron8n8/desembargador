import { useEffect, useRef, useState } from 'react'

import { TelaCheia } from './TelaCheia'

/* A árvore de decisão de verdade.
 *
 * A cena acima mostra o PIPELINE — as etapas do sistema, na ordem em que
 * rodam. Esta mostra a decisão matemática propriamente dita: um dos 400
 * estimadores do RandomForest de src/rag/floresta.py, com o termo, o limiar, o
 * gini e o número de amostras que o sklearn guardou em cada nó.
 *
 * Nada aqui é desenho de ilustração. Os cortes saem de `tree_.threshold`, o
 * gini de `tree_.impurity`, e o caminho aceso é o galho por onde o caso desta
 * apresentação desceu de fato — calculado em apresentacao/montar.py com o mesmo
 * texto que a produção entrega à floresta (src/rag/grafo.py:505).
 */

export type NoRF = {
  id: string
  nivel: number
  gini: number
  n: number
  dist: number[]
  classe: string
  folha: boolean
  cortado: boolean
  termo?: string
  limiar?: number
  esq?: string
  dir?: string
}

export type ArvoreRF = {
  nos: NoRF[]
  caminho: { id: string; valor?: number; esquerda?: boolean }[]
  classes: string[]
  arvores: number
  niveis: number
  profundidade: number
  nos_total: number
  n_raiz: number
  n_treino: number
  ano_corte: number
}

const W = 1100
const H = 640
const MARGEM = 78
const Y0 = 74
const PASSO = 150

const COR: Record<string, string> = {
  provido: '#4ec5b3',
  'parcialmente provido': '#8ec9a6',
  desprovido: '#6d7d7d',
}

const BATIDA = 1500

/** "parcialmente provido" mede ~140px a 14px, e a coluna tem 135. Abreviar é o
 *  que impede o rótulo de invadir a ponta vizinha. */
const CURTO: Record<string, string> = { 'parcialmente provido': 'parc. provido' }

const num = (v: number, casas = 3) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })

/** Termo longo em duas linhas. A coluna tem ~137px e 'honorarios advocaticios'
 *  não cabe numa linha só sem encostar no vizinho. */
function quebra(t: string) {
  if (t.length <= 16) return [t]
  const i = t.lastIndexOf(' ', Math.ceil(t.length / 2) + 4)
  return i > 2 ? [t.slice(0, i), t.slice(i + 1)] : [t]
}

export function ArvoreFloresta({ a }: { a: ArvoreRF }) {
  const [n, defN] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const total = a.caminho.length

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      defN(total)
      return
    }
    const obs = new IntersectionObserver(([e]) => {
      if (!e?.isIntersecting) return
      obs.disconnect()
      defN(1)
    }, { threshold: 0.2 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [total])

  useEffect(() => {
    if (n < 1 || n >= total) return
    const t = setTimeout(() => defN(n + 1), BATIDA)
    return () => clearTimeout(t)
  }, [n, total])

  const porId = new Map(a.nos.map((x) => [x.id, x]))

  /* Layout: as pontas ocupam colunas iguais e todo pai fica no meio das suas
   * duas. É o desenho da referência — e, diferente de uma grade por nível, não
   * abre buraco quando um ramo termina antes do outro. */
  const col = new Map<string, number>()
  let vagas = 0
  const posicionar = (id: string): number => {
    const no = porId.get(id)
    if (!no) return 0
    if (!no.esq || !no.dir) {
      const s = vagas++
      col.set(id, s)
      return s
    }
    const m = (posicionar(no.esq) + posicionar(no.dir)) / 2
    col.set(id, m)
    return m
  }
  posicionar('0')

  const larg = (W - 2 * MARGEM) / Math.max(1, vagas)
  const px = (id: string) => MARGEM + ((col.get(id) ?? 0) + 0.5) * larg
  const py = (no: NoRF) => Y0 + no.nivel * PASSO

  const acesos = new Set(a.caminho.slice(0, n).map((p) => p.id))
  const passo = a.caminho[Math.max(0, n - 1)]
  const noAtual = passo ? porId.get(passo.id) : undefined
  const raiz = porId.get('0')

  const narracao = () => {
    if (!noAtual || !raiz) return { titulo: '', texto: '' }
    if (n <= 1) {
      return {
        titulo: 'A raiz — e o que ela viu',
        texto: `Esta árvore treinou num sorteio com reposição de `
          + `${a.n_raiz.toLocaleString('pt-BR')} das ${a.n_treino.toLocaleString('pt-BR')} `
          + `decisões até ${a.ano_corte}. Gini ${num(raiz.gini)}: na raiz as três classes `
          + `estão quase empatadas, e é isso que os cortes abaixo vão desfazer.`,
      }
    }
    const anterior = a.caminho[n - 2]
    const pai = anterior ? porId.get(anterior.id) : undefined
    if (!pai?.termo || anterior?.esquerda === undefined) {
      return {
        titulo: noAtual.folha ? 'Folha — o galho terminou' : 'Aqui a tela para, a árvore não',
        texto: noAtual.folha
          ? `${noAtual.n.toLocaleString('pt-BR')} decisões, gini ${num(noAtual.gini)}. `
            + `Classe majoritária: ${noAtual.classe}.`
          : `Este nó continua se dividindo por mais ${a.profundidade - a.niveis} níveis. `
            + `A tela mostra ${a.niveis}; a árvore tem ${a.profundidade}.`,
      }
    }
    const v = anterior.valor ?? 0
    return {
      titulo: anterior.esquerda
        ? `Não tem "${pai.termo}"`
        : `Tem "${pai.termo}"`,
      texto: `O peso TF-IDF do termo neste caso é ${num(v, 4)}, e o corte da árvore é `
        + `${num(pai.limiar ?? 0, 4)}. `
        + `${anterior.esquerda ? 'Menor: desce à esquerda.' : 'Maior: desce à direita.'} `
        + `Restam ${noAtual.n.toLocaleString('pt-BR')} decisões, gini ${num(noAtual.gini)}`
        + `${noAtual.gini < pai.gini ? ' — mais puro que o nó acima.' : '.'}`,
    }
  }
  const atual = narracao()

  return (
    <div className="apr-arvore apr-arvore-rf" ref={ref}>
      <div className="apr-tela apr-tela-arvore">
        <TelaCheia alvo={ref} />
        <svg viewBox={`0 0 ${W} ${H}`} role="img"
          aria-label="Uma árvore de decisão real da floresta, com os cortes que ela usa">
          <defs>
            <marker id="apr-rf-seta" viewBox="0 0 8 8" refX="7" refY="4"
              markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0 1 L7 4 L0 7 z" fill="currentcolor" />
            </marker>
          </defs>

          {/* --- os galhos, com a seta e o sim/não que fazem disto uma decisão */}
          {a.nos.map((no) => ([no.esq, no.dir] as const).map((filho, lado) => {
            if (!filho) return null
            const alvo = porId.get(filho)
            if (!alvo) return null
            const x1 = px(no.id)
            const y1 = py(no) + 13
            const x2 = px(filho)
            const y2 = py(alvo) - 15
            const acesa = acesos.has(no.id) && acesos.has(filho)
            return (
              <g key={`${no.id}-${filho}`} className={`apr-rf-galho${acesa ? ' acesa' : ''}`}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} markerEnd="url(#apr-rf-seta)" />
                <text x={(x1 + x2) / 2 + (lado ? 10 : -10)} y={(y1 + y2) / 2}
                  textAnchor={lado ? 'start' : 'end'}>
                  {lado ? 'não' : 'sim'}
                </text>
              </g>
            )
          }))}

          {/* --- os nós */}
          {a.nos.map((no) => {
            const x = px(no.id)
            const y = py(no)
            const on = acesos.has(no.id)
            const aqui = passo?.id === no.id && n > 0
            const ponta = no.folha || no.cortado
            const cor = ponta ? COR[no.classe] ?? COR.desprovido : '#4ec5b3'
            return (
              <g key={no.id} className={`apr-no-arv${on ? ' acesa' : ''}`}>
                {aqui && <circle cx={x} cy={y} r={19} className="apr-folha-foco" />}
                <circle cx={x} cy={y} r={ponta ? 10 : 13} fill={cor}
                  fillOpacity={ponta ? 0.9 : 0.95} />

                {/* o corte, acima do nó: é a pergunta que ele faz */}
                {!ponta && no.termo && (
                  <>
                    {quebra(no.termo).map((linha, i, todas) => (
                      <text key={i} x={x} y={y - 26 - (todas.length - 1 - i) * 12}
                        textAnchor="middle" className="apr-rf-termo">
                        {i === 0 ? '"' : ''}{linha}{i === todas.length - 1 ? '"' : ''}
                      </text>
                    ))}
                    <text x={x} y={y - 14} textAnchor="middle" className="apr-rf-limiar">
                      ≤ {num(no.limiar ?? 0, 4)}
                    </text>
                  </>
                )}

                {/* o que o nó guarda, abaixo dele */}
                <text x={x} y={y + 26} textAnchor="middle" className="apr-rf-meta">
                  gini {num(no.gini)}
                </text>
                <text x={x} y={y + 38} textAnchor="middle" className="apr-rf-meta">
                  n {no.n.toLocaleString('pt-BR')}
                </text>
                {/* A FATIA, e não só o nome da classe. "provido · gini 0,663"
                    lido por quem não lê gini todo dia soa como decisão limpa, e
                    0,663 é quase empate triplo. O percentual diz na cara quanto
                    da ponta é mesmo daquela classe. */}
                {ponta && (
                  <text x={x} y={y + 52} textAnchor="middle" className="apr-rf-classe" fill={cor}>
                    {CURTO[no.classe] ?? no.classe} · {Math.round(100 * Math.max(...no.dist))}%
                  </text>
                )}
                {no.cortado && (
                  <text x={x} y={y + 66} textAnchor="middle" className="apr-rf-corte">
                    continua ↓
                  </text>
                )}
                <title>
                  {no.termo ? `${no.termo} ≤ ${no.limiar} · ` : ''}
                  gini {no.gini} · {no.n} decisões · {no.classe}
                </title>
              </g>
            )
          })}
        </svg>
      </div>

      <div className="apr-narracao">
        <span className="apr-passo">
          passo {Math.min(n, total)} de {total}
        </span>
        <h3>{atual.titulo}</h3>
        <p>{atual.texto}</p>
        <div className="apr-barra" aria-hidden="true">
          <i style={{ width: `${(100 * Math.min(n, total)) / total}%` }} />
        </div>

        {/* O QUE ESTA TELA NÃO É. Sem estes números o desenho sugere que a
            floresta decide em três perguntas, e ela não decide: são 400 árvores
            de 56 níveis, e nenhuma delas sozinha é o prognóstico. */}
        <dl className="apr-rf-selo">
          <dt>na tela</dt>
          <dd>1 de {a.arvores} árvores · {a.niveis} de {a.profundidade} níveis</dd>
          <dt>esta árvore inteira</dt>
          <dd>{a.nos_total.toLocaleString('pt-BR')} nós</dd>
          <dt>nas pontas</dt>
          <dd>classe majoritária e a fatia dela</dd>
          <dt>amostra da raiz</dt>
          <dd>
            {a.n_raiz.toLocaleString('pt-BR')} de {a.n_treino.toLocaleString('pt-BR')} (bootstrap)
          </dd>
        </dl>
        <p className="apr-rf-aviso">
          A floresta é <strong>opaca por construção</strong>: não dá para citar “os 400 galhos
          que votaram assim” numa peça jurídica. Por isso ela é o <em>segundo</em> estimador —
          quem dá o número que vai para o papel é o k-NN sobre os precedentes, que tem nome,
          número e link. Esta tela mostra o mecanismo, não a fonte da citação.
        </p>
        <button className="apr-sair" onClick={() => defN(1)}>
          descer a árvore de novo
        </button>
      </div>
    </div>
  )
}
