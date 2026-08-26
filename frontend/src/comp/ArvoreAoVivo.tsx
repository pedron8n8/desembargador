import { useEffect, useRef, useState } from 'react'

import type { DadosGrafo, NoGrafo } from './GrafoCerebro'

/* A árvore do cérebro, rodando.
 *
 * O mapa da seção 02 mostra o cérebro PARADO, todo de uma vez, para ser
 * explorado com o mouse. Esta seção mostra o mesmo cérebro ACONTECENDO: um nó
 * de cada vez, na ordem em que o sistema executa, com o dado real de cada etapa
 * aparecendo quando ela acende.
 *
 * Layout à mão, e não d3-force. O grafo usa força porque tem 60 nós de dois
 * mundos e nenhuma ordem óbvia; aqui a ordem É a informação, e uma simulação
 * que a embaralha a cada carregamento tiraria justamente o que se quer mostrar.
 * A topologia é a mesma de src/rag/grafo.py, e os nós saem do mesmo
 * dados/grafo.json que alimenta a seção 02 — não há um segundo desenho para
 * divergir do primeiro. */

const W = 1160
const H = 700
const EIXO = 300

/* A GEOMETRIA É O ARGUMENTO.
 *
 * Os 8 aprovados ficam ACIMA da linha de corte, espaçados, com nome e espaço
 * para respirar. Os 32 reprovados ficam ABAIXO, apertados num bloco denso. Não
 * é decoração: o funil 40 → 8 é a coisa mais difícil de acreditar na demo, e
 * numa coluna única, ordenada por nota, ele vira só uma lista comprida. Assim
 * ele vira uma proporção que se vê de longe — e os reprovados continuam todos
 * na tela, que é o que impede a página de ser vitrine.
 *
 * Toda posição respeita o halo: raio 54 no caso, 39,6 nas etapas. Um nó a menos
 * de 54 da borda esquerda sangra para fora do viewBox. */
const APROV_Y0 = 58
const APROV_PASSO = 31
const Y_CORTE = 306
const REPROV_Y0 = 340
const X_FOLHA = 664

/** O tronco, na ordem de execução. `x` é posição, e posição aqui é tempo.
 *
 *  `abaixo` alterna o rótulo para o outro lado da linha. As etapas ficam a 46–90
 *  unidades umas das outras e os nomes são mais largos que isso: todos do mesmo
 *  lado, "Prognóstico Redator Revisor Juiz" vira uma única mancha ilegível no
 *  canto direito. Alternando, cada rótulo tem o dobro de espaço. */
const TRONCO: { id: string; x: number; y: number; abaixo?: boolean }[] = [
  { id: 'caso', x: 58, y: EIXO },
  { id: 'triagem', x: 148, y: EIXO, abaixo: true },
  { id: 'busca', x: 238, y: EIXO },
  { id: 'bm80', x: 322, y: EIXO, abaixo: true },
  { id: 'rerank', x: 406, y: EIXO },
  { id: 'c40', x: 490, y: EIXO, abaixo: true },
  { id: 'triar', x: 574, y: EIXO },
  { id: 'knn', x: 900, y: 160 },
  { id: 'floresta', x: 900, y: 500, abaixo: true },
  { id: 'prognostico', x: 972, y: EIXO },
  { id: 'redigir', x: 1026, y: EIXO, abaixo: true },
  { id: 'revisar', x: 1072, y: EIXO },
  { id: 'juiz', x: 1118, y: EIXO, abaixo: true },
]

/** A ordem em que o sistema roda. As folhas entram no meio, entre `triar` e
 *  `knn`: é ali que os 40 são lidos um por um. */
const ORDEM = ['caso', 'triagem', 'busca', 'bm80', 'rerank', 'c40', 'triar',
  '@folhas', 'knn', 'floresta', 'prognostico', 'redigir', 'revisar', 'juiz']

const COR: Record<string, string> = {
  caso: '#e8eceb',
  etapa: '#4ec5b3',
  volume: '#6d7d7d',
  estimador: '#d9a441',
  provido: '#4ec5b3',
  'parcialmente provido': '#8ec9a6',
  desprovido: '#6d7d7d',
  reprovado: '#3f5052',
}

const RAIO: Record<string, number> = { caso: 15, etapa: 11, estimador: 10, volume: 8 }

/** Quanto tempo cada batida do tronco fica em cena. As folhas correm bem mais
 *  rápido: são 40, e 40 × 700ms seriam 28 segundos de plateia esperando. */
const BATIDA = 700
const FOLHA = 90

type Passo = { titulo: string; texto: string }

export function ArvoreAoVivo({ g }: { g: DadosGrafo }) {
  const folhas = g.nos
    .filter((n) => n.tipo === 'precedente')
    .slice()
    // nota alta em cima: o funil vira leitura vertical, e a linha de corte
    // fica sendo um lugar da tela em vez de um número no texto
    .sort((a, b) => (b.nota ?? 0) - (a.nota ?? 0) || (b.ano ?? 0) - (a.ano ?? 0))

  const total = ORDEM.length - 1 + folhas.length
  const [n, defN] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

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

  // Uma batida por vez. setTimeout em aba escondida é afunilado, não parado —
  // a sequência termina de todo jeito, e por isso não há rede de tempo aqui.
  const dentroDasFolhas = n > 7 && n <= 7 + folhas.length
  useEffect(() => {
    if (n < 1 || n >= total) return
    const t = setTimeout(() => defN(n + 1), dentroDasFolhas ? FOLHA : BATIDA)
    return () => clearTimeout(t)
  }, [n, total, dentroDasFolhas])

  // Quanto do tronco e quantas folhas já acenderam, derivado do mesmo contador.
  const iTronco = n <= 7 ? n : Math.min(ORDEM.length, 7 + 1 + Math.max(
    0, n - 7 - folhas.length))
  const folhasAcesas = Math.max(0, Math.min(folhas.length, n - 7))
  const aceso = (id: string) => {
    const i = ORDEM.indexOf(id)
    return i >= 0 && i < iTronco
  }

  const d = g.dado ?? {}
  const corte = d.triar?.corte ?? 3
  const lidos = d.c40?.n ?? folhas.length
  const aprovados = d.c40?.aprovados ?? folhas.filter((f) => f.aprovado).length

  const PASSOS: Record<string, Passo> = {
    caso: {
      titulo: 'O caso entra',
      texto: 'O relatório do acórdão, cortado antes do voto. Nenhuma linha do '
        + 'desfecho, e a decisão real escondida do índice.',
    },
    triagem: {
      titulo: 'Triagem — a única etapa que interpreta o caso',
      texto: `Um modelo lê a peça e devolve classe, matéria, tese, pedidos e os `
        + `termos de busca. ${d.triagem?.modelo ?? ''}, `
        + `${(d.triagem?.entrada ?? 0).toLocaleString('pt-BR')} tokens lidos.`,
    },
    busca: {
      titulo: 'Busca literal no acervo',
      texto: 'Os termos viram uma consulta de texto completo (BM25/FTS5). Sem '
        + 'embedding: a recuperação é lexical, por escolha declarada.',
    },
    bm80: {
      titulo: `${d.bm80?.n ?? lidos * 2} candidatos`,
      texto: `O BM25 entrega o dobro do que será lido. O corte vem depois — assim `
        + `a leitura recebe os ${lidos} MELHORES de ${d.bm80?.n ?? lidos * 2}, e não `
        + `os ${lidos} primeiros.`,
    },
    rerank: {
      titulo: 'Rerank — recência, âncora, unanimidade, efeito',
      texto: 'Multiplicadores sobre a relevância que o BM25 já mediu. Não inventa '
        + 'relevância, e não reprova ninguém: só decide quem chega a ser lido.',
    },
    c40: {
      titulo: `${lidos} lidos`,
      texto: `O que a triagem de analogia efetivamente lê, um por um. Todos os `
        + `${lidos} estão nesta árvore, inclusive os que não passarem.`,
    },
    triar: {
      titulo: 'Analogia — nota de 0 a 5, com o motivo escrito',
      texto: `Um modelo lê os ${lidos} e dá nota a cada um. Passa quem tira `
        + `${corte} ou mais. Acompanhe: cada folha acende com a sua nota.`,
    },
    knn: {
      titulo: `k-NN — ${aprovados} precedentes viram um número`,
      texto: `Voto ponderado sobre os aprovados: ${((d.knn?.p ?? 0) * 100).toFixed(1)}% `
        + `de reforma. Auditável — sai dos documentos que acabaram de acender.`,
    },
    floresta: {
      titulo: 'Floresta — o segundo estimador, que não olha os precedentes',
      texto: `400 árvores treinadas no histórico: `
        + `${((d.floresta?.p ?? 0) * 100).toFixed(1)}%. Ela lê o caso, não a busca — `
        + `por isso a discordância entre as duas significa alguma coisa.`,
    },
    prognostico: {
      titulo: 'Prognóstico — e o portão',
      texto: 'As duas estimativas se combinam, a escala é calibrada, e um portão '
        + 'cala o sistema quando a margem não é folgada. Aqui ela era.',
    },
    redigir: {
      titulo: 'Redator',
      texto: `Escreve a minuta ancorada nos ${aprovados} precedentes aprovados e nos `
        + `dispositivos legais que eles invocam. Não escreve de memória.`,
    },
    revisar: {
      titulo: 'Revisor — de outro fornecedor, de propósito',
      texto: 'Modelos da mesma família tendem a concordar entre si, o que anularia '
        + 'a revisão. Se ele reprovar, o redator refaz.',
    },
    juiz: {
      titulo: 'Juiz automático — um terceiro fornecedor',
      texto: 'Dá nota à minuta. Modelo que julga o próprio trabalho se dá nota alta, '
        + 'então este não julga nada que tenha escrito.',
    },
  }

  const atual = dentroDasFolhas
    ? {
      titulo: `Lendo ${folhasAcesas} de ${lidos}`,
      texto: folhas[folhasAcesas - 1]
        ? `${folhas[folhasAcesas - 1].rotulo} — analogia `
          + `${folhas[folhasAcesas - 1].nota}/5. `
          + (folhas[folhasAcesas - 1].aprovado ? 'Passou.' : 'Ficou de fora.')
        : '',
    }
    : PASSOS[ORDEM[Math.max(0, iTronco - 1)]] ?? PASSOS.caso

  const nAprovados = folhas.filter((f) => f.aprovado).length
  const nReprovados = folhas.length - nAprovados
  const yFolha = (i: number) => (i < nAprovados
    ? APROV_Y0 + i * APROV_PASSO
    : REPROV_Y0 + ((i - nAprovados) * (H - 34 - REPROV_Y0))
      / Math.max(1, nReprovados - 1))
  // longe do tronco = menos análogo, a mesma leitura do mapa da seção 02
  const xFolha = (f: NoGrafo) => X_FOLHA + (5 - (f.nota ?? 0)) * 15
  const pos = new Map(TRONCO.map((t) => [t.id, t]))
  const noDe = new Map(g.nos.map((x) => [x.id, x]))

  const corFolha = (f: NoGrafo) =>
    (f.aprovado ? COR[f.resultado ?? ''] ?? COR.desprovido : COR.reprovado)

  return (
    <div className="apr-arvore" ref={ref}>
      <div className="apr-tela apr-tela-arvore">
        <svg viewBox={`0 0 ${W} ${H}`} role="img"
          aria-label="A árvore do cérebro, etapa por etapa">
          <defs>
            {['caso', 'etapa', 'estimador', 'provido', 'desprovido'].map((k) => (
              <radialGradient key={k} id={`apr-arv-halo-${k.replace(/\s+/g, '-')}`}>
                <stop offset="0%" stopColor={COR[k]} stopOpacity="0.5" />
                <stop offset="100%" stopColor={COR[k]} stopOpacity="0" />
              </radialGradient>
            ))}
          </defs>

          {/* --- o tronco */}
          {TRONCO.slice(0, 6).map((t, i) => {
            const p = TRONCO[i + 1]
            return (
              <line key={`tr${t.id}`}
                className={`apr-aresta${aceso(p.id) ? ' acesa' : ''}`}
                x1={t.x} y1={t.y} x2={p.x} y2={p.y} />
            )
          })}

          {/* --- triar → cada folha, e a folha aprovada → k-NN */}
          {folhas.map((f, i) => {
            const acesa = i < folhasAcesas
            const x = xFolha(f)
            const y = yFolha(i)
            const knn = pos.get('knn')!
            return (
              <g key={`ar${f.id}`}>
                <line className={`apr-aresta folha${acesa ? ' acesa' : ''}`}
                  x1={pos.get('triar')!.x} y1={EIXO} x2={x} y2={y} />
                {f.aprovado && (
                  <line className={`apr-aresta${aceso('knn') ? ' acesa' : ''}`}
                    x1={x} y1={y} x2={knn.x} y2={knn.y}
                    opacity={acesa ? 1 : 0.15} />
                )}
              </g>
            )
          })}

          {/* --- triar → floresta, e os dois estimadores → prognóstico */}
          <line className={`apr-aresta${aceso('floresta') ? ' acesa' : ''}`}
            x1={pos.get('triar')!.x} y1={EIXO}
            x2={pos.get('floresta')!.x} y2={pos.get('floresta')!.y} />
          {(['knn', 'floresta'] as const).map((k) => (
            <line key={`pg${k}`}
              className={`apr-aresta${aceso('prognostico') ? ' acesa' : ''}`}
              x1={pos.get(k)!.x} y1={pos.get(k)!.y}
              x2={pos.get('prognostico')!.x} y2={EIXO} />
          ))}
          {(['redigir', 'revisar', 'juiz'] as const).map((k, i) => {
            const de = ['prognostico', 'redigir', 'revisar'][i]
            return (
              <line key={`fi${k}`} className={`apr-aresta${aceso(k) ? ' acesa' : ''}`}
                x1={pos.get(de)!.x} y1={EIXO} x2={pos.get(k)!.x} y2={EIXO} />
            )
          })}

          {/* --- a linha de corte, entre o último aprovado e o primeiro que não
                 passou. As folhas estão ordenadas por nota, então o corte é um
                 LUGAR da tela: o funil 40 → 8 vira distância, e não uma frase. */}
          {nAprovados > 0 && nReprovados > 0 && (
            <g className={`apr-corte${aceso('triar') ? ' acesa' : ''}`}>
              <line x1={618} y1={Y_CORTE} x2={862} y2={Y_CORTE} />
              <text x={618} y={Y_CORTE - 8}>
                corte {corte}/5 — {nAprovados} passaram
              </text>
              <text x={618} y={Y_CORTE + 20}>
                {nReprovados} lidos e reprovados, todos aqui
              </text>
            </g>
          )}

          {/* --- as folhas */}
          {folhas.map((f, i) => {
            const acesa = i < folhasAcesas
            const atual = i === folhasAcesas - 1 && dentroDasFolhas
            const x = xFolha(f)
            const y = yFolha(i)
            return (
              <g key={f.id} className={`apr-no-arv${acesa ? ' acesa' : ''}`}>
                {atual && (
                  <circle cx={x} cy={y} r={13} className="apr-folha-foco" />
                )}
                <circle cx={x} cy={y} r={3 + (f.nota ?? 1) * 1.3}
                  fill={corFolha(f)} fillOpacity={f.aprovado ? 0.95 : 0.7} />
                {/* rótulo SÓ na folha que está sendo lida agora, e só a nota.
                    O SVG desce a ~0,7 da largura do viewBox nesta coluna, então
                    40 rótulos de 9px sairiam com 6px na tela — ilegíveis, e
                    ainda por cima empilhados. O número do processo já está na
                    narração ao lado; repeti-lo aqui só empurraria texto por
                    cima do k-NN. */}
                {atual && (
                  <text x={x + 16} y={y + 5} className="apr-folha-rot">
                    {f.nota}/5
                  </text>
                )}
              </g>
            )
          })}

          {/* --- os nós do tronco */}
          {TRONCO.map((t) => {
            const no = noDe.get(t.id)
            if (!no) return null
            const on = aceso(t.id)
            const r = RAIO[no.tipo] ?? 10
            const halo = no.tipo === 'caso' ? 'caso'
              : no.tipo === 'estimador' ? 'estimador'
                : no.tipo === 'etapa' ? 'etapa' : ''
            return (
              <g key={t.id} className={`apr-no-arv tronco${on ? ' acesa' : ''}`}>
                {on && halo && (
                  <circle cx={t.x} cy={t.y} r={r * 3.6}
                    fill={`url(#apr-arv-halo-${halo})`} />
                )}
                <circle cx={t.x} cy={t.y} r={r}
                  fill={COR[no.tipo] ?? COR.volume} fillOpacity={0.9} />
                <text x={t.x} y={t.abaixo ? t.y + r + 18 : t.y - r - 9}
                  textAnchor="middle" className="apr-arv-rot">
                  {no.rotulo}
                </text>
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
        <button className="apr-sair" onClick={() => defN(1)}>
          rodar a árvore de novo
        </button>
      </div>
    </div>
  )
}
