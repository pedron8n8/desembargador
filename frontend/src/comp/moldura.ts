import { useCallback, useEffect, useRef, useState } from 'react'

/* Segurar e arrastar, Ctrl+roda para o zoom. Um só para todos os quadros.
 *
 * O grafo já tinha o dele, feito à mão, e cada visualização nova reescrevia o
 * mesmo par de handlers um pouco diferente — o da árvore não tinha zoom, o do
 * diagrama só andava na vertical, e nenhum concordava sobre o que fazer quando
 * o ponteiro saía do quadro no meio do gesto. Isto aqui é essa lógica uma vez.
 *
 * Duas decisões que não são óbvias:
 *
 * 1. O ZOOM É COM CTRL. Roda sozinha continua rolando a página, que é o que
 *    ela faz em qualquer outro lugar. Um quadro que sequestra a roda é um
 *    quadro em que a pessoa fica presa no meio de uma apresentação de vinte
 *    mil pixels, e o gesto para escapar não é descobrível.
 *
 * 2. O LISTENER DE RODA É NATIVO E NÃO-PASSIVO. O `onWheel` do React entra
 *    como passivo, e listener passivo não pode chamar preventDefault: o Ctrl+
 *    roda vazaria para o navegador e o que ampliaria seria a PÁGINA INTEIRA,
 *    não o desenho. Por isso `addEventListener(..., { passive: false })`.
 */

export type Vista = { x: number; y: number; z: number }

const LIMITE = { min: 0.35, max: 5 }
const trava = (z: number) => Math.max(LIMITE.min, Math.min(LIMITE.max, z))

export function useMoldura(W: number, inicial?: Partial<Vista>) {
  const [vista, defVista] = useState<Vista>({
    x: inicial?.x ?? 0, y: inicial?.y ?? 0, z: inicial?.z ?? 1,
  })
  const [arrastando, defArrastando] = useState(false)
  /** true assim que a pessoa mexe. Quem tem narração automática consulta isto
   *  para parar de puxar a vista de volta: um desenho que teima em voltar
   *  sozinho para onde o texto está é um desenho que não se deixa ler. */
  const [naMao, defNaMao] = useState(false)
  const svgRef = useRef<SVGSVGElement>(null)
  const arrasto = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null)

  /** Quantas unidades do viewBox cabem num pixel de tela. O SVG tem width 100%
   *  sobre um viewBox de proporção fixa, então o mesmo fator serve nos dois
   *  eixos. */
  const porPixel = useCallback(
    () => W / (svgRef.current?.getBoundingClientRect().width || W), [W],
  )

  /* O arrasto escuta na JANELA, e não no SVG: assim o ponteiro pode sair do
   * quadro no meio do gesto sem largar o desenho. */
  const pegar = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return
    const a = { px: e.clientX, py: e.clientY, ox: 0, oy: 0 }
    let moveu = false
    defVista((v) => { a.ox = v.x; a.oy = v.y; return v })
    arrasto.current = a
    const mv = (ev: PointerEvent) => {
      const k = porPixel()
      const dx = (ev.clientX - a.px) * k
      const dy = (ev.clientY - a.py) * k
      if (!moveu && Math.hypot(dx, dy) > 3) {
        moveu = true
        defArrastando(true)
        defNaMao(true)
      }
      if (!moveu) return
      defVista((v) => ({ ...v, x: a.ox + dx, y: a.oy + dy }))
    }
    const up = () => {
      window.removeEventListener('pointermove', mv)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      arrasto.current = null
      defArrastando(false)
    }
    window.addEventListener('pointermove', mv)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }, [porPixel])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const roda = (e: WheelEvent) => {
      // sem Ctrl (ou Cmd) a roda é da página, não do desenho
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const r = svg.getBoundingClientRect()
      const k = W / (r.width || W)
      // o ponto sob o cursor, em unidades do viewBox
      const px = (e.clientX - r.left) * k
      const py = (e.clientY - r.top) * k
      defNaMao(true)
      defVista((v) => {
        const z = trava(v.z * Math.exp(-e.deltaY * 0.0016))
        if (z === v.z) return v
        // amplia PARA O CURSOR: o ponto sob ele não pode escorregar
        const f = z / v.z
        return { z, x: px - (px - v.x) * f, y: py - (py - v.y) * f }
      })
    }
    svg.addEventListener('wheel', roda, { passive: false })
    return () => svg.removeEventListener('wheel', roda)
  }, [W])

  const recentrar = useCallback(() => {
    defNaMao(false)
    defVista({ x: 0, y: 0, z: 1 })
  }, [])

  const aproximar = useCallback((fator: number) => {
    defNaMao(true)
    defVista((v) => ({ ...v, z: trava(v.z * fator) }))
  }, [])

  const transform = `translate(${vista.x} ${vista.y}) scale(${vista.z})`

  return {
    svgRef, vista, defVista, transform, arrastando, naMao, defNaMao,
    pegar, recentrar, aproximar, porPixel,
  }
}
