import { useEffect, useState, type ReactNode, type RefObject } from 'react'

/* Tela cheia e zoom para as visualizações.
 *
 * Fullscreen API nativa, não modal próprio: o navegador já sabe fazer isso, já
 * trata Esc, já tira a barra de endereço e já avisa o usuário do que aconteceu.
 * Um "modal em tela cheia" escrito à mão seria mais código para reimplementar
 * pior o que o `Esc` do sistema operacional faz de graça.
 *
 * O alvo é o WRAPPER da visualização, e não o <svg>: o painel lateral e a
 * legenda explicam o desenho, e um mapa em tela cheia sem a legenda é um mapa
 * sem escala.
 */

/** Os prefixos existem por causa do Safari, que só expõe a versão webkit. */
type ComWebkit = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> }
type DocComWebkit = Document & {
  webkitExitFullscreen?: () => Promise<void>
  webkitFullscreenElement?: Element | null
}

const elementoAtual = () =>
  document.fullscreenElement ?? (document as DocComWebkit).webkitFullscreenElement ?? null

export function TelaCheia({ alvo, children }: {
  alvo: RefObject<HTMLElement | null>
  children?: ReactNode
}) {
  const [cheia, defCheia] = useState(false)

  // o estado tem de vir do navegador, e não do clique: sair com Esc não passa
  // por este componente, e um botão que não soubesse disso ficaria mentindo
  useEffect(() => {
    const ver = () => defCheia(elementoAtual() === alvo.current)
    document.addEventListener('fullscreenchange', ver)
    document.addEventListener('webkitfullscreenchange', ver)
    return () => {
      document.removeEventListener('fullscreenchange', ver)
      document.removeEventListener('webkitfullscreenchange', ver)
    }
  }, [alvo])

  function alternar() {
    const el = alvo.current as ComWebkit | null
    if (!el) return
    if (elementoAtual()) {
      const d = document as DocComWebkit
      void (d.exitFullscreen?.() ?? d.webkitExitFullscreen?.())
      return
    }
    // pode ser recusado (iframe sem allow="fullscreen", política do navegador).
    // Recusa não pode derrubar a página: o desenho continua servindo na caixa.
    void (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.())?.catch(() => {})
  }

  return (
    <div className="apr-ferramentas">
      {children}
      <button
        type="button"
        className="apr-ferramenta"
        onClick={alternar}
        aria-pressed={cheia}
        title={cheia ? 'sair da tela cheia (Esc)' : 'abrir em tela cheia'}
        aria-label={cheia ? 'sair da tela cheia' : 'abrir em tela cheia'}
      >
        {cheia ? (
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M6.5 1.5v5h-5M9.5 14.5v-5h5" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M1.5 6V1.5h4.5M14.5 10v4.5H10M14.5 6V1.5H10M1.5 10v4.5H6" />
          </svg>
        )}
      </button>
    </div>
  )
}

/** Um botão da mesma barra, para quem tem zoom (o grafo). Fica aqui para os
 *  dois usarem a mesma caixa e o mesmo alvo de clique. */
export function Ferramenta({ onClick, titulo, children }: {
  onClick: () => void
  titulo: string
  children: ReactNode
}) {
  return (
    <button type="button" className="apr-ferramenta" onClick={onClick}
      title={titulo} aria-label={titulo}>
      {children}
    </button>
  )
}
