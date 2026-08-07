import { Fragment, type ReactNode } from 'react'

/**
 * Renderizador de markdown para React, sem dependência e sem innerHTML.
 *
 * A minuta e o relatório são markdown gerado pelo próprio sistema — cabeçalhos,
 * ênfase, listas, citação, tabela. Um `marked` + `dompurify` seriam duas
 * dependências e uma superfície de XSS para cobrir o que dá em 80 linhas
 * produzindo elementos React, onde injeção é impossível por construção.
 *
 * O que NÃO suporta, de propósito: HTML embutido, imagem, link de referência.
 * Nada disso aparece numa minuta, e cada um seria um buraco a fechar.
 */

const INLINE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|<https?:\/\/[^\s>]+>|\[[^\]]+\]\([^)]+\))/g

function inline(texto: string, chave: string): ReactNode[] {
  return texto.split(INLINE).filter(Boolean).map((p, i) => {
    const k = `${chave}-${i}`
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={k}>{p.slice(2, -2)}</strong>
    if (p.startsWith('*') && p.endsWith('*')) return <em key={k}>{p.slice(1, -1)}</em>
    if (p.startsWith('`') && p.endsWith('`')) return <code key={k}>{p.slice(1, -1)}</code>
    if (p.startsWith('<http')) {
      const u = p.slice(1, -1)
      return (
        <a key={k} href={u} target="_blank" rel="noreferrer noopener">
          {u}
        </a>
      )
    }
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(p)
    if (link && /^https?:\/\//.test(link[2])) {
      return (
        <a key={k} href={link[2]} target="_blank" rel="noreferrer noopener">
          {link[1]}
        </a>
      )
    }
    return <Fragment key={k}>{p}</Fragment>
  })
}

export function Markdown({ texto }: { texto: string }) {
  const linhas = (texto ?? '').replace(/\r\n/g, '\n').split('\n')
  const saida: ReactNode[] = []
  let i = 0

  const juntarLista = (marcador: RegExp) => {
    const itens: string[] = []
    while (i < linhas.length && marcador.test(linhas[i])) {
      itens.push(linhas[i].replace(marcador, ''))
      i++
    }
    return itens
  }

  while (i < linhas.length) {
    const l = linhas[i]

    if (!l.trim()) {
      i++
      continue
    }

    if (/^\s*(---|___|\*\*\*)\s*$/.test(l)) {
      saida.push(<hr key={i} />)
      i++
      continue
    }

    const h = /^(#{1,6})\s+(.*)$/.exec(l)
    if (h) {
      const Tag = `h${Math.min(6, h[1].length)}` as 'h1'
      saida.push(<Tag key={i}>{inline(h[2], String(i))}</Tag>)
      i++
      continue
    }

    if (/^\s*>\s?/.test(l)) {
      const bloco: string[] = []
      while (i < linhas.length && /^\s*>\s?/.test(linhas[i])) {
        bloco.push(linhas[i].replace(/^\s*>\s?/, ''))
        i++
      }
      saida.push(
        <blockquote key={i}>
          {bloco.filter((x) => x.trim()).map((x, j) => (
            <p key={j}>{inline(x, `${i}-${j}`)}</p>
          ))}
        </blockquote>,
      )
      continue
    }

    // tabela: | a | b |  seguida de |---|---|
    if (l.trim().startsWith('|') && /^\s*\|[\s:|-]+\|\s*$/.test(linhas[i + 1] ?? '')) {
      const celulas = (linha: string) =>
        linha.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
      const cabecalho = celulas(l)
      i += 2
      const corpo: string[][] = []
      while (i < linhas.length && linhas[i].trim().startsWith('|')) {
        corpo.push(celulas(linhas[i]))
        i++
      }
      saida.push(
        <div className="tabela-rolavel" key={i}>
          <table>
            <thead>
              <tr>
                {cabecalho.map((c, j) => (
                  <th key={j}>{inline(c, `h${i}-${j}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {corpo.map((linha, j) => (
                <tr key={j}>
                  {linha.map((c, k) => (
                    <td key={k}>{inline(c, `c${i}-${j}-${k}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    if (/^\s*[-*+]\s+/.test(l)) {
      const inicio = i
      const itens = juntarLista(/^\s*[-*+]\s+/)
      saida.push(
        <ul key={inicio}>
          {itens.map((x, j) => (
            <li key={j}>{inline(x, `${inicio}-${j}`)}</li>
          ))}
        </ul>,
      )
      continue
    }

    if (/^\s*\d+[.)]\s+/.test(l)) {
      const inicio = i
      const itens = juntarLista(/^\s*\d+[.)]\s+/)
      saida.push(
        <ol key={inicio}>
          {itens.map((x, j) => (
            <li key={j}>{inline(x, `${inicio}-${j}`)}</li>
          ))}
        </ol>,
      )
      continue
    }

    // parágrafo: junta linhas até a próxima em branco ou bloco
    const inicio = i
    const paragrafo: string[] = []
    while (
      i < linhas.length &&
      linhas[i].trim() &&
      !/^(#{1,6}\s|\s*[-*+]\s|\s*\d+[.)]\s|\s*>|\s*\||\s*(---|___|\*\*\*)\s*$)/.test(linhas[i])
    ) {
      paragrafo.push(linhas[i])
      i++
    }
    if (paragrafo.length) {
      saida.push(<p key={inicio}>{inline(paragrafo.join(' '), String(inicio))}</p>)
    } else {
      i++
    }
  }

  return <div className="juridico">{saida}</div>
}
