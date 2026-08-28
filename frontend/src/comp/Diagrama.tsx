import { useEffect, useRef, useState } from 'react'

import { useMoldura } from './moldura'
import { Ferramenta, TelaCheia } from './TelaCheia'

/* Um diagrama de nós e setas, topo→baixo.
 *
 * Existe porque várias cenas pediam o mesmo desenho: o gabinete de hoje, o
 * eproc, o gabinete com o DrSec dentro, a CONTA (duas contas que confluem,
 * viram escala e passam por um portão) e a PROVA (400 casos que se dividem em
 * responde/cala e depois em acerta/erra). Todas são árvores — umas convergem,
 * outras abrem — e escrever um SVG à mão para cada uma seria manter cinco
 * layouts que fazem a mesma coisa.
 *
 * Caixa, e não círculo como na árvore da floresta: aqui cada nó carrega um
 * número e uma frase, e texto centrado em cima de um círculo ou vaza ou
 * encolhe até deixar de ser texto.
 *
 * O QUADRO É FIXO E O DESENHO ANDA DENTRO DELE.
 *
 * A alternativa era deixar o SVG crescer na página: seis níveis viram 1100px
 * de altura, mais alto que a janela de quem está apresentando, e aí o começo e
 * o fim do fluxo nunca aparecem juntos — que é justamente a comparação que a
 * página faz. Aqui o quadro tem altura de janela e o desenho corre por dentro:
 * ele mesmo desce enquanto narra, e a qualquer momento se segura e arrasta em
 * qualquer direção, ou se amplia com Ctrl+roda. Ver `moldura.ts`. */

export type NoDiag = {
  id: string
  /** o que o nó é */
  rotulo: string
  /** o número, ou a palavra, que ele carrega */
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
const CAIXA_L = 300
/** Altura de uma caixa cujo rótulo cabe em UMA linha. Quem tem duas cresce —
 *  ver `alturaDe`. O `PASSO` tem folga suficiente para absorver isso sem que a
 *  seta encoste na caixa de baixo. */
const CAIXA_A = 118
const LINHA_ROT = 21
const PASSO = 190
const TOPO = 26

/** A altura do quadro, em unidades do viewBox. Três níveis e meio de cada vez:
 *  o suficiente para ver de onde veio e para onde vai sem perder o texto. */
const VISOR = 660

const BATIDA = 900

const TOM: Record<string, string> = {
  verde: 'var(--verde)',
  ambar: 'var(--ambar)',
  neutro: 'var(--tinta-3)',
  fora: 'var(--reprovado)',
}

/** Quebra por contagem de caracteres. O SVG não quebra texto sozinho, e medir
 *  de verdade exigiria montar e remontar o nó a cada render — para uma frase de
 *  duas linhas, contar caractere acerta o suficiente. */
function linhas(t: string, largura = 40, max = 2) {
  const saida: string[] = []
  let atual = ''
  for (const p of t.split(' ')) {
    if (!atual) atual = p
    else if ((atual + ' ' + p).length <= largura) atual += ' ' + p
    else {
      saida.push(atual)
      atual = p
      if (saida.length === max) break
    }
  }
  if (saida.length < max && atual) saida.push(atual)
  return saida
}

/** O RÓTULO TAMBÉM QUEBRA, e não quebrava.
 *
 *  Só a nota passava por `linhas()`; o rótulo ia inteiro para um `<text>`, e
 *  texto em SVG não quebra sozinho. "Os precedentes dele, com o peso de cada
 *  um" media 341px numa caixa de 300 e saía pelos dois lados. Outros três
 *  rótulos passam de 30 caracteres e estavam a uma palavra do mesmo destino.
 *
 *  30 caracteres é a medida da caixa: 276px úteis a 17px de Fira Sans. */
const linhasRot = (t: string) => linhas(t, 30, 2)

/** Caixa com rótulo de duas linhas é 21px mais alta. Sem isto o rótulo empurra
 *  valor e nota para fora da própria caixa — o vazamento voltaria por baixo. */
const alturaCrua = (x: NoDiag) => CAIXA_A + (linhasRot(x.rotulo).length - 1) * LINHA_ROT

export function Diagrama({ nos, rotulo }: { nos: NoDiag[]; rotulo: string }) {
  const [n, defN] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const {
    svgRef, defVista, transform, arrastando, naMao, defNaMao, pegar, recentrar, aproximar,
  } = useMoldura(W)

  /** Em tela cheia o desenho inteiro cabe, então o quadro deixa de ser quadro:
   *  o viewBox passa a ser a altura toda e não há mais o que arrastar. O estado
   *  vem do NAVEGADOR (`fullscreenchange`), e não do clique no botão — sair com
   *  Esc não passa por aqui, e o viewBox ficaria preso no tamanho errado. */
  const [cheia, defCheia] = useState(false)
  useEffect(() => {
    const ver = () => defCheia(document.fullscreenElement === ref.current)
    document.addEventListener('fullscreenchange', ver)
    document.addEventListener('webkitfullscreenchange', ver)
    return () => {
      document.removeEventListener('fullscreenchange', ver)
      document.removeEventListener('webkitfullscreenchange', ver)
    }
  }, [])

  const niveis = Math.max(...nos.map((x) => x.nivel)) + 1
  /* A altura é do NÍVEL, e não de cada caixa. Duas caixas lado a lado com
   * alturas diferentes leem como dois momentos, e elas são o mesmo: o nível é
   * uma fileira. Quem manda é o rótulo mais longo da fileira. */
  const alturaDoNivel = new Map<number, number>()
  for (const x of nos) {
    alturaDoNivel.set(x.nivel, Math.max(alturaDoNivel.get(x.nivel) ?? 0, alturaCrua(x)))
  }
  const alturaDe = (x: NoDiag) => alturaDoNivel.get(x.nivel) ?? CAIXA_A
  const maisAlta = Math.max(...alturaDoNivel.values())
  const H = TOPO + niveis * PASSO - (PASSO - maisAlta) + 20
  const maxPan = cheia ? 0 : Math.max(0, H - VISOR)

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

  /* A narração desce o quadro sozinha, mantendo o nível que acabou de acender
   * no terço de baixo — que é onde o olho já está, porque foi por ali que o
   * anterior entrou. */
  useEffect(() => {
    if (naMao || n < 1 || maxPan === 0) return
    const y = TOPO + (n - 1) * PASSO + CAIXA_A / 2
    defVista({ x: 0, y: -Math.max(0, Math.min(maxPan, y - VISOR * 0.62)), z: 1 })
  }, [n, naMao, maxPan, defVista])

  /** Teclado, porque arrastar com mouse não é a única forma de andar num
   *  documento — e um desenho que só responde ao ponteiro é um desenho que
   *  parte dos leitores não abre. `+`/`-` fazem o que o Ctrl+roda faz. */
  function tecla(e: React.KeyboardEvent) {
    if (e.key === '+' || e.key === '=') { e.preventDefault(); aproximar(1.2); return }
    if (e.key === '-') { e.preventDefault(); aproximar(1 / 1.2); return }
    if (e.key === '0') { e.preventDefault(); recentrar(); return }
    const salto = e.key === 'PageDown' || e.key === 'PageUp' ? VISOR * 0.8 : PASSO
    const dy = e.key === 'ArrowDown' || e.key === 'PageDown' ? -salto
      : e.key === 'ArrowUp' || e.key === 'PageUp' ? salto : 0
    const dx = e.key === 'ArrowRight' ? -PASSO : e.key === 'ArrowLeft' ? PASSO : 0
    if (!dx && !dy) return
    e.preventDefault()
    defNaMao(true)
    defVista((v) => ({ ...v, x: v.x + dx, y: v.y + dy }))
  }

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
    <figure className="apr-diagrama" ref={ref}>
      <TelaCheia alvo={ref}>
        <Ferramenta onClick={() => aproximar(1.25)} titulo="aproximar (Ctrl + roda)">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14M7 5v4M5 7h4" />
          </svg>
        </Ferramenta>
        <Ferramenta onClick={() => aproximar(1 / 1.25)} titulo="afastar (Ctrl + roda)">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14M5 7h4" />
          </svg>
        </Ferramenta>
        <Ferramenta onClick={recentrar} titulo="voltar ao começo do fluxo">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M13 7a5 5 0 1 0-1.4 3.5M13 3.5V7h-3.5" />
          </svg>
        </Ferramenta>
      </TelaCheia>

      <div className={`apr-diag-quadro${arrastando ? ' arrastando' : ''}`}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${cheia ? H : VISOR}`}
          role="img"
          aria-label={rotulo}
          tabIndex={0}
          onPointerDown={pegar}
          onKeyDown={tecla}
        >
          <defs>
            <marker id="apr-diag-seta" viewBox="0 0 8 8" refX="7" refY="4"
              markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0 1 L7 4 L0 7 z" fill="currentcolor" />
            </marker>
          </defs>

          <g transform={cheia ? undefined : transform}>
            {/* --- as setas */}
            {nos.map((x) => (x.de ?? []).map((idPai) => {
              const pai = porId.get(idPai)
              if (!pai) return null
              const x1 = cx(pai)
              const y1 = cy(pai) + alturaDe(pai) / 2
              const x2 = cx(x)
              const y2 = cy(x) - alturaDe(x) / 2 - 8
              return (
                <g key={`${idPai}-${x.id}`}
                  className={`apr-diag-seta${aceso(x) ? ' acesa' : ''}`}>
                  <line x1={x1} y1={y1} x2={x2} y2={y2} markerEnd="url(#apr-diag-seta)" />
                  {x.rotuloAresta && (
                    <text x={(x1 + x2) / 2 + (x2 === x1 ? 12 : x2 > x1 ? 16 : -16)}
                      y={(y1 + y2) / 2 + 5}
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
              const alta = alturaDe(x)
              const topo = cy(x) - alta / 2
              const rot = linhasRot(x.rotulo)
              const nota = x.nota ? linhas(x.nota) : []
              // o que o rótulo empurra para baixo quando ocupa duas linhas
              const empurra = (rot.length - 1) * LINHA_ROT
              return (
                <g key={x.id} className={`apr-diag-no${on ? ' acesa' : ''}`}>
                  <rect x={meio - CAIXA_L / 2} y={topo} width={CAIXA_L} height={alta}
                    rx={12} stroke={cor} />
                  {rot.map((linha, i) => (
                    <text key={i} x={meio} y={topo + 27 + i * LINHA_ROT}
                      textAnchor="middle" className="apr-diag-rot">
                      {linha}
                    </text>
                  ))}
                  {x.valor && (
                    <text x={meio} y={topo + 68 + empurra} textAnchor="middle"
                      className="apr-diag-valor" fill={cor}>
                      {x.valor}
                    </text>
                  )}
                  {nota.map((linha, i) => (
                    <text key={i} x={meio} y={topo + (x.valor ? 92 : 58) + empurra + i * 18}
                      textAnchor="middle" className="apr-diag-nota">
                      {linha}
                    </text>
                  ))}
                </g>
              )
            })}
          </g>
        </svg>

      </div>

      <figcaption className="apr-diag-legenda">
        <span>{rotulo}</span>
        {!cheia && <b>arraste para mover · Ctrl + roda para o zoom</b>}
      </figcaption>
    </figure>
  )
}
