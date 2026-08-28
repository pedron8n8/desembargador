import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceRadial,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'

import { Ferramenta, TelaCheia } from './TelaCheia'

export type NoGrafo = {
  id: string
  tipo: 'caso' | 'etapa' | 'volume' | 'estimador' | 'precedente' | 'ancora' | 'lei'
  rotulo: string
  detalhe?: string
  aprovado?: boolean
  resultado?: string
  ano?: number
  nota?: number
  fator?: number | null
  classe?: string
  orgao?: string
  bm25?: number
  pontos?: number
  url?: string
  ficha?: string
  conta?: string
  ementa?: string
  grau?: number
}

export type DadosGrafo = {
  nos: NoGrafo[]
  arestas: { de: string; para: string; tipo?: string; peso?: number }[]
  dado: Record<string, any>
}

type No = SimulationNodeDatum & NoGrafo
type Aresta = SimulationLinkDatum<No> & { tipo: string; peso?: number }

/** Um arrasto em curso. `moveu` é o que separa arrastar de clicar: sem ele,
 *  soltar o mouse depois de mover um nó abriria o painel dele por acidente. */
type Arrasto = {
  no: No | null
  px: number
  py: number
  ox: number
  oy: number
  moveu: boolean
}

const W = 1100
const H = 720

const COR: Record<string, string> = {
  caso: '#e8eceb',
  etapa: '#4ec5b3',
  volume: '#6d7d7d',
  estimador: '#d9a441',
  // ardósia, não violeta: frontend/DESIGN.md proíbe roxo em qualquer superfície
  ancora: '#7f9bb3',
  // a lei e' outra autoridade que a ancora, e por isso outra cor: sepia, a
  // mesma familia do ambar dos estimadores, sem virar um 2o acento saturado
  lei: '#b08d57',
  provido: '#4ec5b3',
  'parcialmente provido': '#8ec9a6',
  desprovido: '#6d7d7d',
  // quem a triagem leu e reprovou: presente, legível, e claramente fora
  reprovado: '#3f5052',
}

/** Etapas vêm da esquerda para a direita; documentos orbitam. Sem isso o
 *  pipeline vira novelo e some justamente a leitura que interessa: a ordem. */
const FAIXA: Record<string, number> = {
  caso: 0.05,
  triagem: 0.13,
  busca: 0.21,
  bm80: 0.28,
  rerank: 0.35,
  c40: 0.42,
  triar: 0.5,
  knn: 0.7,
  prognostico: 0.78,
  floresta: 0.84,
  redigir: 0.9,
  revisar: 0.93,
  juiz: 0.975,
}

/* A VARREDURA: o processo acendendo, uma etapa por vez.
 *
 * O mapa é bonito parado, mas parado ele não diz que existe uma ORDEM — e a
 * ordem é metade do argumento. A varredura roda uma vez, quando a seção entra
 * na tela, e termina com tudo aceso: no fim ela devolve exatamente o mapa que
 * havia antes, e a exploração com o mouse continua a mesma.
 *
 * A ordem vem do próprio FAIXA, que já é a ordem de src/rag/grafo.py. Não há
 * uma segunda lista para divergir da primeira. */
const PASSOS_VARREDURA = Object.keys(FAIXA).sort((a, b) => FAIXA[a] - FAIXA[b])
const PASSO_VARREDURA = 420

/** Documento, âncora e lei acendem junto com a ANALOGIA: é a etapa que os leu,
 *  e é onde eles entram na história. */
const momentoDe = (n: No) => {
  const i = PASSOS_VARREDURA.indexOf(n.id)
  return i >= 0 ? i : PASSOS_VARREDURA.indexOf('triar')
}

/** O centro do disco. Os documentos orbitam a ANALOGIA, que é a etapa que os
 *  julgou — e o raio da órbita é a nota. Ler a distância é ler o veredito. */
const ORBITA = { x: FAIXA.triar * W, y: H / 2 }
const raioOrbita = (n: No) => 400 - (n.nota ?? 0) * 56

function raio(n: No) {
  if (n.tipo === 'caso') return 15
  if (n.tipo === 'etapa') return 11
  if (n.tipo === 'estimador') return 10
  if (n.tipo === 'volume') return 8
  if (n.tipo === 'ancora' || n.tipo === 'lei') return 5 + Math.min(6, n.grau ?? 2)
  return 3.5 + (n.nota ?? 3) * 1.4
}

function corDe(n: No) {
  if (n.tipo === 'precedente') {
    return n.aprovado ? COR[n.resultado ?? ''] ?? '#6d7d7d' : COR.reprovado
  }
  return COR[n.tipo] ?? '#6d7d7d'
}

/** Halo: um círculo grande com gradiente radial da própria cor até transparente.
 *  Não é filtro SVG de propósito — 60 nós com feGaussianBlur derrubam o quadro,
 *  e o gradiente dá o mesmo brilho de graça. */
const HALOS = ['caso', 'etapa', 'estimador', 'ancora', 'lei', 'provido',
  'parcialmente provido', 'desprovido']
const chaveHalo = (s: string) => s.replace(/\s+/g, '-')
const haloDe = (n: No) => {
  if (n.tipo === 'precedente') return n.aprovado ? (n.resultado ?? '') : ''
  if (n.tipo === 'volume') return ''
  return n.tipo
}

const pct = (v?: number | null) =>
  v == null ? '—' : `${(100 * v).toFixed(v >= 0.995 || v <= 0.005 ? 0 : 1)}%`

/**
 * O cérebro inteiro num mapa só: as ETAPAS do processamento e os DOCUMENTOS que
 * elas leram, no mesmo grafo. Entram os 40 candidatos, não só os 8 aprovados: a
 * distância do centro é a nota de analogia, então o funil 40 → 8 vira desenho e
 * dá para clicar em quem ficou de fora e ler por quê.
 *
 * A âncora é NÓ, não aresta — mesma razão do RedePrecedentes: ligar precedente a
 * precedente por súmula comum produz cliques ilegíveis.
 */
export function GrafoCerebro({ g }: { g: DadosGrafo }) {
  const [tique, setTique] = useState(0)
  const [foco, setFoco] = useState<string | null>(null)
  const [sel, setSel] = useState<string | null>('prognostico')
  const [camera, setCamera] = useState<{ x: number; y: number; z: number } | null>(null)
  const [tocou, setTocou] = useState(false)
  const [arrastando, setArrastando] = useState(false)
  const [varredura, defVarredura] = useState(0)
  const parado = useRef(false)
  const caixaRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const sim = useRef<Simulation<No, Aresta> | null>(null)
  const arrasto = useRef<Arrasto | null>(null)

  // Começa quando a seção entra na tela, e só uma vez. Em reduced-motion pula
  // direto para o fim: quem pediu para nada se mexer recebe o mapa pronto.
  useEffect(() => {
    const el = caixaRef.current
    if (!el) return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      defVarredura(PASSOS_VARREDURA.length)
      return
    }
    const obs = new IntersectionObserver(([e]) => {
      if (!e?.isIntersecting) return
      obs.disconnect()
      defVarredura(1)
    }, { threshold: 0.2 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    if (varredura < 1 || varredura >= PASSOS_VARREDURA.length) return
    const t = setTimeout(() => defVarredura(varredura + 1), PASSO_VARREDURA)
    return () => clearTimeout(t)
  }, [varredura])

  const { nos, arestas, grau } = useMemo(() => {
    const nos: No[] = g.nos.map((n) => ({ ...n }))
    const porId = new Map(nos.map((n) => [n.id, n]))
    const arestas: Aresta[] = g.arestas
      .filter((a) => porId.has(a.de) && porId.has(a.para))
      .map((a) => ({
        source: porId.get(a.de)!,
        target: porId.get(a.para)!,
        tipo: a.tipo ?? 'fluxo',
        peso: a.peso,
      }))
    /* Quantos vizinhos cada nó tem de fato.
     *
     * As forças abaixo eram parametrizadas só por TIPO, e é por isso que a tela
     * embolava: uma âncora citada por doze precedentes ocupava exatamente o
     * mesmo espaço de uma citada por dois. Quem tem muito coligado precisa de
     * mais espaço, e o tipo não sabe disso — o grau sabe. */
    const grau = new Map<string, number>()
    for (const a of arestas) {
      for (const id of [(a.source as No).id, (a.target as No).id]) {
        grau.set(id, (grau.get(id) ?? 0) + 1)
      }
    }
    return { nos, arestas, grau }
  }, [g])

  useEffect(() => {
    if (!nos.length) return
    parado.current = false
    const documento = (a: Aresta) =>
      (a.source as No).tipo === 'precedente' || (a.target as No).tipo === 'precedente'
    /* O grau, achatado. A raiz cresce devagar de propósito: quem tem 12
     * vizinhos precisa de mais espaço que quem tem 2, mas não de seis vezes
     * mais — linear e o hub sozinho empurraria o resto do mapa para fora. */
    const folga = (d: No) => Math.sqrt(grau.get(d.id) ?? 1)
    const s: Simulation<No, Aresta> = forceSimulation(nos)
      .force('link', forceLink<No, Aresta>(arestas).id((d) => d.id)
        // Nenhuma aresta que toca um documento PUXA de verdade. Quem manda na
        // posição dele é o raio, e o raio é a nota — foi assim que este mapa
        // ficou legível: com mola normal, os 40 desabavam em cima da Analogia e
        // a leitura da distância morria junto.
        //
        // O comprimento agora cresce com o grau da ponta mais conectada: uma
        // aresta que chega num hub nasce mais longa, e o hub deixa de puxar a
        // vizinhança toda para cima de si.
        .distance((a) => {
          const base = a.tipo === 'texto' ? 80 : a.tipo === 'ancora' ? 70
            : a.tipo === 'lei' ? 62 : documento(a) ? 130 : 58
          const g = Math.max(folga(a.source as No), folga(a.target as No))
          return base * (1 + 0.16 * Math.max(0, g - 1.6))
        })
        .strength((a) => (a.tipo === 'texto' ? 0.03 : a.tipo === 'ancora' ? 0.1
          : a.tipo === 'lei' ? 0.14 : documento(a) ? 0.02 : 0.4)))
      .force('carga', forceManyBody<No>().strength((d) =>
        (d.tipo === 'precedente' ? -34
          : d.tipo === 'ancora' || d.tipo === 'lei' ? -140 : -300) * folga(d)))
      .force('colisao', forceCollide<No>().radius((d) => raio(d) + 7 + 3.5 * folga(d)))
      // as etapas ganham posição-alvo no eixo X: o pipeline tem ordem, e a
      // ordem é informação
      .force('faixa', forceX<No>((d) => (FAIXA[d.id] ?? 0.5) * W)
        .strength((d) => (FAIXA[d.id] != null ? 0.9 : 0)))
      .force('meio', forceY<No>(H / 2).strength((d) => (FAIXA[d.id] != null ? 0.12 : 0.02)))
      // o disco: raio = nota de analogia. Nota 5 no núcleo, nota 1 na periferia
      .force('orbita', forceRadial<No>((d) => raioOrbita(d), ORBITA.x, ORBITA.y)
        .strength((d) => (d.tipo === 'precedente' ? 0.42 : 0)))
      .alphaDecay(0.025)

    sim.current = s
    s.on('tick', () => {
      if (!parado.current) setTique((t) => t + 1)
    })
    // simulação eterna é bateria queimada à toa: para quando esfria. O que se
    // mexe depois disso é CSS, que não acorda a CPU do mesmo jeito.
    // ponytail: re-render do React por tick aguenta os 60 nós; se um dia
    // engasgar, o caminho é escrever transform nos <g> por requestAnimationFrame.
    s.on('end', () => {
      parado.current = true
    })
    return () => {
      parado.current = true
      s.stop()
      sim.current = null
    }
  }, [nos, arestas, grau])

  // Só apaga a vizinhança depois do primeiro toque. Com 60 nós, chegar já
  // filtrado é chegar a uma tela quase vazia — o mapa tem de ser visto inteiro
  // uma vez antes de virar ferramenta de foco.
  const vizinhos = useMemo(() => {
    const alvo = foco ?? (tocou ? sel : null)
    if (!alvo) return null
    const s = new Set<string>([alvo])
    for (const a of arestas) {
      const de = (a.source as No).id
      const para = (a.target as No).id
      if (de === alvo) s.add(para)
      if (para === alvo) s.add(de)
    }
    return s
  }, [foco, sel, tocou, arestas])

  const noSel = nos.find((n) => n.id === sel) ?? null
  const dado = sel ? g.dado[sel] : null
  const corte = g.dado?.triar?.corte ?? 3

  /** Quantas unidades do viewBox cabem num pixel de tela. O SVG tem width 100%
   *  e height auto sobre um viewBox de proporção fixa, então não há barra preta:
   *  o mesmo fator serve para os dois eixos. */
  const porPixel = () => W / (svgRef.current?.getBoundingClientRect().width || W)

  /** O arrasto escuta na JANELA, não no SVG.
   *
   *  setPointerCapture mais a delegação de eventos do React deixava movimento
   *  pelo caminho, e um arrasto que perde o pointermove é um mapa que não se
   *  mexe. Na janela não há o que atrapalhar, e de quebra o ponteiro pode sair
   *  do quadro no meio do gesto sem largar o nó. */
  function pegar(e: React.PointerEvent, n: No | null) {
    arrasto.current = {
      no: n,
      px: e.clientX,
      py: e.clientY,
      ox: n ? (n.x ?? 0) : (camera?.x ?? 0),
      oy: n ? (n.y ?? 0) : (camera?.y ?? 0),
      moveu: false,
    }
    const mv = (ev: PointerEvent) => mover(ev)
    const up = () => {
      window.removeEventListener('pointermove', mv)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      soltar()
    }
    window.addEventListener('pointermove', mv)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    if (n) {
      // reaquece: arrastar um documento tem de empurrar a vizinhança, senão o
      // mapa parece um adesivo em vez de um sistema
      parado.current = false
      sim.current?.alphaTarget(0.25).restart()
    }
  }

  function mover(e: PointerEvent) {
    const a = arrasto.current
    if (!a) return
    const k = porPixel()
    const dx = (e.clientX - a.px) * k
    const dy = (e.clientY - a.py) * k
    if (!a.moveu && Math.hypot(dx, dy) > 3) {
      a.moveu = true
      setArrastando(true)
    }
    if (!a.moveu) return
    if (a.no) {
      const z = camera?.z ?? 1
      // x/y além de fx/fy: fx só vira posição no próximo tique da simulação, e
      // esperar o tique é o nó andando atrás do ponteiro
      a.no.fx = a.no.x = a.ox + dx / z
      a.no.fy = a.no.y = a.oy + dy / z
    } else {
      // fundo: quem se move é a câmera, e ela vive fora da escala
      setCamera({ x: a.ox + dx, y: a.oy + dy, z: camera?.z ?? 1 })
    }
    setTique((t) => t + 1)
  }

  function soltar() {
    const a = arrasto.current
    arrasto.current = null
    setArrastando(false)
    if (!a) return
    sim.current?.alphaTarget(0)
    if (a.moveu) return
    // não moveu: foi clique
    if (a.no) {
      setTocou(true)
      setSel(a.no.id)
      mirar(a.no)
    } else {
      // clicar no vazio larga o nó e devolve a vista inteira
      setSel(null)
      setTocou(false)
      setCamera(null)
    }
  }

  /** Solta o nó de volta para a física. Arrastar prega o documento onde você o
   *  deixou — o que é o que se espera de arrastar — mas aí o raio deixa de valer
   *  como nota, e tem de haver caminho de volta. */
  function largar(n: No) {
    n.fx = null
    n.fy = null
    parado.current = false
    sim.current?.alphaTarget(0).alpha(0.4).restart()
  }

  /** Zoom pelos botões. Amplia em torno do CENTRO do quadro, e não da origem
   *  do viewBox: ampliar na origem manda o desenho para o canto inferior a cada
   *  clique, e em dois cliques não há mais mapa na tela. */
  function zoom(fator: number) {
    setCamera((c) => {
      const z0 = c?.z ?? 1
      const z = Math.min(3, Math.max(0.6, z0 * fator))
      const k = z / z0
      return {
        z,
        x: W / 2 - k * (W / 2 - (c?.x ?? 0)),
        y: H / 2 - k * (H / 2 - (c?.y ?? 0)),
      }
    })
  }

  /** A câmera não centraliza de todo: leva o nó a 35% do caminho e amplia pouco.
   *  Centralizar por completo tira o contexto, e o contexto é o mapa. Clicar de
   *  novo no mesmo nó devolve a vista inteira. */
  function mirar(n: No) {
    if (sel === n.id && camera) {
      setCamera(null)
      return
    }
    const z = 1.2
    const alvoX = (n.x ?? W / 2) + 0.35 * (W / 2 - (n.x ?? W / 2))
    const alvoY = (n.y ?? H / 2) + 0.35 * (H / 2 - (n.y ?? H / 2))
    setCamera({ x: W / 2 - z * alvoX, y: H / 2 - z * alvoY, z })
  }

  return (
    <div className="apr-grafo" data-entra ref={caixaRef}>
      <div className={`apr-tela${arrastando ? ' arrastando' : ''}`}>
        <TelaCheia alvo={caixaRef}>
          <Ferramenta onClick={() => zoom(1.25)} titulo="aproximar">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" /><path d="M10.4 10.4 14 14M7 5v4M5 7h4" />
            </svg>
          </Ferramenta>
          <Ferramenta onClick={() => zoom(0.8)} titulo="afastar">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" /><path d="M10.4 10.4 14 14M5 7h4" />
            </svg>
          </Ferramenta>
          <Ferramenta onClick={() => { setCamera(null); setSel(null); setTocou(false) }}
            titulo="devolver a vista inteira">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M13 7a5 5 0 1 0-1.4 3.5M13 3.5V7h-3.5" />
            </svg>
          </Ferramenta>
        </TelaCheia>
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} data-tique={tique} role="img"
          aria-label="Mapa do cérebro: etapas do processamento e os documentos que ele leu">
          <defs>
            {HALOS.map((k) => (
              <radialGradient key={k} id={`apr-halo-${chaveHalo(k)}`}>
                <stop offset="0%" stopColor={COR[k]} stopOpacity="0.5" />
                <stop offset="45%" stopColor={COR[k]} stopOpacity="0.14" />
                <stop offset="100%" stopColor={COR[k]} stopOpacity="0" />
              </radialGradient>
            ))}
          </defs>

          <g className={`apr-camera${arrastando ? ' arrastando' : ''}`}
            style={camera
              ? { transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.z})` }
              : undefined}>
            {/* o vazio é alvo: arrastar aqui move a vista, clicar solta a
                seleção. Sem esta placa o clique cai no <svg> e o mapa nunca
                deselecionaria. */}
            <rect className="apr-vazio" x={-W} y={-H} width={W * 3} height={H * 3}
              onPointerDown={(e) => pegar(e, null)} />
            <g>
              {arestas.map((a, i) => {
                const s = a.source as No
                const t = a.target as No
                const acesa = vizinhos ? vizinhos.has(s.id) && vizinhos.has(t.id) : false
                const base = a.tipo === 'texto' ? 0.22
                  : a.tipo === 'ancora' || a.tipo === 'lei' ? 0.4 : 0.55
                // a aresta só existe quando as DUAS pontas já chegaram: uma
                // ligação saindo de um nó ainda apagado seria um caminho que o
                // processo não percorreu
                const chegou = varredura >= PASSOS_VARREDURA.length
                  || (momentoDe(s) < varredura && momentoDe(t) < varredura)
                return (
                  <line
                    key={i}
                    className={`apr-aresta ${a.tipo}${acesa ? ' acesa' : ''}`}
                    x1={s.x ?? 0} y1={s.y ?? 0} x2={t.x ?? 0} y2={t.y ?? 0}
                    opacity={!chegou ? 0.05 : vizinhos && !acesa ? 0.09 : base}
                  />
                )
              })}
            </g>
            {nos.map((n, i) => {
              const apagado = vizinhos ? !vizinhos.has(n.id) : false
              const fim = varredura >= PASSOS_VARREDURA.length
              const chegou = fim || momentoDe(n) < varredura
              // o nó da etapa que ACABOU de acender ganha anel: é ele que a
              // varredura está narrando neste instante
              const agora = !fim && varredura > 0 && PASSOS_VARREDURA[varredura - 1] === n.id
              const r = raio(n)
              const halo = haloDe(n)
              const rotulo = n.tipo === 'precedente' ? '' : n.rotulo
              const fora = n.tipo === 'precedente' && !n.aprovado
              const orbe = n.tipo === 'precedente' || n.tipo === 'ancora'
                || n.tipo === 'lei'
              return (
                <g
                  key={n.id}
                  className={`apr-no${sel === n.id ? ' sel' : ''}${fora ? ' fora' : ''}${orbe ? ' orbe' : ''}`}
                  style={{ ['--i' as string]: i }}
                  opacity={!chegou ? 0.1 : apagado ? 0.12 : 1}
                  onMouseEnter={() => setFoco(n.id)}
                  onMouseLeave={() => setFoco(null)}
                  onPointerDown={(e) => { e.stopPropagation(); pegar(e, n) }}
                  onDoubleClick={() => largar(n)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setTocou(true)
                      setSel(n.id)
                      mirar(n)
                    }
                  }}
                >
                  <g className="apr-orbita">
                    {agora && (
                      <circle className="apr-folha-foco" cx={n.x ?? 0} cy={n.y ?? 0}
                        r={r + 9} />
                    )}
                    {halo && (
                      <circle className="apr-halo" cx={n.x ?? 0} cy={n.y ?? 0}
                        r={r * 3.4} fill={`url(#apr-halo-${chaveHalo(halo)})`} />
                    )}
                    {n.tipo === 'ancora' || n.tipo === 'lei' ? (
                      // quadrado = âncora (o precedente que obriga ou convence),
                      // losango = lei (o texto em que o precedente se apoia).
                      // Formas diferentes porque são autoridades diferentes: só
                      // a cor deixaria as duas iguais para quem não distingue
                      // ardósia de sépia — e são muitos.
                      <rect
                        x={(n.x ?? 0) - r} y={(n.y ?? 0) - r}
                        width={r * 2} height={r * 2}
                        transform={n.tipo === 'lei'
                          ? `rotate(45 ${n.x ?? 0} ${n.y ?? 0})` : undefined}
                        fill={corDe(n)} fillOpacity={0.85}
                        stroke={sel === n.id ? '#e8eceb' : 'none'} strokeWidth={1.5}
                      />
                    ) : (
                      <circle
                        cx={n.x ?? 0} cy={n.y ?? 0} r={r}
                        fill={corDe(n)}
                        fillOpacity={n.tipo === 'precedente' ? (n.aprovado ? 0.85 : 0.5) : 0.9}
                        stroke={sel === n.id ? '#e8eceb' : 'none'} strokeWidth={1.5}
                      />
                    )}
                    {rotulo && (
                      <text x={n.x ?? 0} y={(n.y ?? 0) + r + 11} textAnchor="middle">
                        {rotulo}
                      </text>
                    )}
                  </g>
                  <title>
                    {n.rotulo}
                    {n.resultado ? ` — ${n.resultado}` : ''}
                    {n.ano ? ` — ${n.ano}` : ''}
                    {n.nota != null ? ` · analogia ${n.nota}/5` : ''}
                    {fora ? ' · reprovado' : ''}
                  </title>
                </g>
              )
            })}
          </g>
        </svg>
      </div>

      <aside className="apr-painel" key={sel ?? 'vazio'}>
        {!noSel ? (
          <p>Clique num nó para ver o dado real daquela etapa.</p>
        ) : (
          <>
            <span className="tipo">
              {noSel.tipo === 'precedente'
                ? (noSel.aprovado ? 'precedente aprovado' : 'lido e reprovado')
                : noSel.tipo}
            </span>
            <h3>{noSel.rotulo}</h3>
            {noSel.detalhe && <p>{noSel.detalhe}</p>}

            {noSel.tipo === 'precedente' && (
              <>
                <dl>
                  <dt>resultado</dt><dd>{noSel.resultado}</dd>
                  <dt>ano</dt><dd>{noSel.ano}</dd>
                  {noSel.orgao && (
                    <>
                      <dt>câmara</dt>
                      <dd style={{ fontSize: '0.75rem' }}>{noSel.orgao}</dd>
                    </>
                  )}
                  <dt>analogia</dt>
                  <dd className={noSel.aprovado ? 'destaque' : undefined}>
                    {noSel.nota}/5{noSel.aprovado ? '' : ` — o corte é ${corte}/5`}
                  </dd>
                  {noSel.aprovado && noSel.fator != null && (
                    <>
                      <dt>peso final</dt><dd>{noSel.fator.toFixed(2)}×</dd>
                    </>
                  )}
                </dl>
                {noSel.conta && (
                  <>
                    <p style={{ fontSize: '0.8125rem' }}>
                      {noSel.aprovado
                        ? 'A conta que dá o peso dele no k-NN:'
                        : 'A conta do rerank levou este acórdão até a leitura. A reprovação '
                          + 'veio da nota de analogia.'}
                    </p>
                    <pre>{noSel.conta}</pre>
                  </>
                )}
                {noSel.ficha && <p style={{ fontSize: '0.8125rem' }}>{noSel.ficha}</p>}
                {noSel.ementa && <pre>{noSel.ementa}</pre>}
                {noSel.url && (
                  <a href={noSel.url} target="_blank" rel="noreferrer"
                    style={{ color: 'var(--verde)', fontSize: '0.8125rem' }}>
                    abrir o acórdão no portal do TJSC →
                  </a>
                )}
              </>
            )}

            {sel === 'busca' && dado?.consulta_fts && (
              <>
                <p style={{ fontSize: '0.8125rem' }}>A consulta literal que foi disparada:</p>
                <pre>{dado.consulta_fts}</pre>
              </>
            )}

            {sel === 'c40' && (
              <dl>
                <dt>lidos</dt><dd>{dado?.n}</dd>
                <dt>aprovados</dt><dd>{dado?.aprovados}</dd>
              </dl>
            )}

            {sel === 'triar' && dado?.distribuicao && (
              <>
                <p style={{ fontSize: '0.8125rem' }}>
                  Quantos tiraram cada nota. O corte é {dado.corte}/5, e nesta consulta
                  ninguém tirou exatamente essa nota.
                </p>
                <dl>
                  {Object.entries(dado.distribuicao).map(([nota, n]) => (
                    <Fragment key={nota}>
                      <dt>nota {nota}/5</dt>
                      <dd className={Number(nota) >= dado.corte ? 'destaque' : undefined}>
                        {String(n)} {Number(nota) >= dado.corte ? 'passaram' : 'reprovados'}
                      </dd>
                    </Fragment>
                  ))}
                </dl>
              </>
            )}

            {sel === 'prognostico' && dado && (
              <>
                <dl>
                  <dt>k-NN</dt><dd>{pct(dado.estimadores?.knn)}</dd>
                  <dt>floresta</dt><dd>{pct(dado.estimadores?.floresta)}</dd>
                  <dt>conjunto</dt><dd>{pct(dado.estimadores?.conjunto)}</dd>
                  <dt>calibrado</dt><dd className="destaque">{pct(dado.p)}</dd>
                  <dt>intervalo</dt>
                  <dd>{dado.intervalo ? `${pct(dado.intervalo[0])} a ${pct(dado.intervalo[1])}` : '—'}</dd>
                  <dt>resultado</dt><dd>{dado.resultado ?? 'NÃO DECIDO'}</dd>
                </dl>
                <p style={{ fontSize: '0.8125rem' }}>
                  {dado.concordam
                    ? 'Os dois estimadores concordam no lado.'
                    : 'Os dois discordam, sinal de caso na fronteira.'}
                </p>
              </>
            )}

            {sel === 'rerank' && dado?.fatores && (
              <dl>
                <dt>meia-vida</dt><dd>{dado.fatores.meia_vida_anos} anos</dd>
                <dt>vinculante</dt><dd>{dado.fatores.ancora?.vinculante}×</dd>
                <dt>persuasiva</dt><dd>{dado.fatores.ancora?.persuasiva}×</dd>
                <dt>estadual</dt><dd>{dado.fatores.ancora?.estadual}×</dd>
                <dt>não unânime</dt><dd>{dado.fatores.nao_unanime}×</dd>
                <dt>transitou</dt><dd>{dado.fatores.transitou}×</dd>
                <dt>sobrestado</dt><dd>{dado.fatores.sobrestado}×</dd>
              </dl>
            )}

            {dado?.modelo && (
              <dl>
                <dt>modelo</dt><dd style={{ fontSize: '0.75rem' }}>{dado.modelo}</dd>
                <dt>tokens</dt><dd>{dado.entrada} / {dado.saida}</dd>
              </dl>
            )}
          </>
        )}
      </aside>

      <div className="apr-legenda">
        <span><i style={{ background: COR.etapa }} />etapa do cérebro</span>
        <span><i style={{ background: COR.estimador }} />estimador</span>
        <span><i style={{ background: COR.provido }} />aprovado, reformou</span>
        <span><i style={{ background: COR.desprovido }} />aprovado, manteve</span>
        <span><i style={{ background: COR.reprovado }} />lido e reprovado</span>
        {/* só anuncia âncora se houver alguma: legenda de categoria ausente da
            tela faz o leitor procurar o que não existe */}
        {nos.some((n) => n.tipo === 'ancora') && (
          <span><i style={{ background: COR.ancora, borderRadius: 0 }} />âncora citada por 2+</span>
        )}
        {nos.some((n) => n.tipo === 'lei') && (
          <span>
            <i style={{ background: COR.lei, borderRadius: 0, transform: 'rotate(45deg)' }} />
            lei invocada por 2+
          </span>
        )}
        <span>distância do centro = nota de analogia</span>
        <span>tracejado = ementas parecidas</span>
        <span style={{ marginLeft: 'auto' }}>
          clique para abrir · arraste para mover · duplo clique devolve à órbita ·
          clique no vazio solta
        </span>
      </div>
    </div>
  )
}
