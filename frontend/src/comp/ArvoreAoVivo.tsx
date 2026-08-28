import { useEffect, useRef, useState } from 'react'

import type { DadosGrafo, NoGrafo } from './GrafoCerebro'
import { TelaCheia } from './TelaCheia'

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
const H = 1270
const EIXO = 580

/* A GEOMETRIA É O ARGUMENTO.
 *
 * Os 8 aprovados ficam ACIMA da linha de corte, numa fileira larga, com espaço
 * para respirar. Os 32 reprovados ficam ABAIXO, num bloco denso de quatro
 * fileiras. Não é decoração: o funil 40 → 8 é a coisa mais difícil de acreditar
 * na demo, e numa fileira única ele vira só uma lista comprida. Assim ele vira
 * uma proporção que se vê de longe — e os reprovados continuam todos na tela,
 * que é o que impede a página de ser vitrine.
 *
 * Desce, e não corre para a direita. A referência da seção é uma árvore de
 * decisão clássica: raiz em cima, níveis descendo, seta em cada galho. O eixo
 * do tempo virou o Y — "mais abaixo = mais tarde", a mesma leitura de antes, na
 * orientação em que todo mundo já sabe ler uma árvore.
 *
 * O que NÃO transpôs junto foram as folhas. Espalhá-las em fileira única, do
 * jeito que a coluna original virava ao girar, põe 40 pontos lado a lado numa
 * linha fina de 1 px de altura: o funil some, e some justamente a parte que
 * custou a ser desenhada. Por isso os reprovados quebram em bloco — e é a
 * FILEIRA dentro do bloco que passa a carregar a nota, já que a lista chega
 * ordenada por ela. */
const APROV_X0 = 148
const APROV_PASSO = 118
const Y_APROV = 616
const Y_CORTE = 676
const REPROV_X0 = 336
const REPROV_PASSO_X = 70
const REPROV_COLS = 8
const Y_REPROV0 = 726
const REPROV_PASSO_Y = 38

/** O tronco, na ordem de execução. `y` é posição, e posição aqui é tempo.
 *
 *  `direita` alterna o rótulo para o outro lado da coluna. As etapas ficam a
 *  60–90 unidades umas das outras e os nomes são mais largos que isso: todos do
 *  mesmo lado, "Prognóstico Redator Revisor Juiz" vira uma única mancha
 *  ilegível. Alternando, cada rótulo tem o dobro de espaço. */
const TRONCO: { id: string; x: number; y: number; direita?: boolean }[] = [
  { id: 'caso', x: EIXO, y: 56 },
  { id: 'triagem', x: EIXO, y: 134, direita: true },
  { id: 'busca', x: EIXO, y: 212 },
  { id: 'bm80', x: EIXO, y: 290, direita: true },
  { id: 'rerank', x: EIXO, y: 368 },
  { id: 'c40', x: EIXO, y: 446, direita: true },
  { id: 'triar', x: EIXO, y: 524 },
  { id: 'knn', x: 300, y: 942 },
  { id: 'floresta', x: 880, y: 942, direita: true },
  { id: 'prognostico', x: EIXO, y: 1034 },
  { id: 'redigir', x: EIXO, y: 1106, direita: true },
  { id: 'revisar', x: EIXO, y: 1166 },
  { id: 'juiz', x: EIXO, y: 1226, direita: true },
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
  const xFolha = (i: number) => (i < nAprovados
    ? APROV_X0 + i * APROV_PASSO
    : REPROV_X0 + ((i - nAprovados) % REPROV_COLS) * REPROV_PASSO_X)
  // Mais abaixo = menos análogo, a mesma leitura do mapa da seção 02. Na
  // fileira dos aprovados isso é um degrauzinho por nota; no bloco dos
  // reprovados é a fileira inteira, porque a lista chega ordenada por nota.
  const yFolha = (f: NoGrafo, i: number) => (i < nAprovados
    ? Y_APROV + (5 - (f.nota ?? 0)) * 14
    : Y_REPROV0 + Math.floor((i - nAprovados) / REPROV_COLS) * REPROV_PASSO_Y)
  const pos = new Map(TRONCO.map((t) => [t.id, t]))
  const noDe = new Map(g.nos.map((x) => [x.id, x]))

  const corFolha = (f: NoGrafo) =>
    (f.aprovado ? COR[f.resultado ?? ''] ?? COR.desprovido : COR.reprovado)

  return (
    <div className="apr-arvore" ref={ref}>
      <div className="apr-tela apr-tela-arvore">
        <TelaCheia alvo={ref} />
        <svg viewBox={`0 0 ${W} ${H}`} role="img"
          aria-label="A árvore do cérebro, etapa por etapa">
          <defs>
            {['caso', 'etapa', 'estimador', 'provido', 'desprovido'].map((k) => (
              <radialGradient key={k} id={`apr-arv-halo-${k.replace(/\s+/g, '-')}`}>
                <stop offset="0%" stopColor={COR[k]} stopOpacity="0.5" />
                <stop offset="100%" stopColor={COR[k]} stopOpacity="0" />
              </radialGradient>
            ))}
            {/* a seta é o que separa uma árvore de um emaranhado: ela diz para
                que lado a coisa corre, e aqui o sentido é a própria informação */}
            <marker id="apr-arv-seta" viewBox="0 0 8 8" refX="7" refY="4"
              markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M0 1 L7 4 L0 7 z" fill="currentcolor" />
            </marker>
          </defs>

          {/* --- o tronco */}
          {TRONCO.slice(0, 6).map((t, i) => {
            const p = TRONCO[i + 1]
            return (
              <line key={`tr${t.id}`}
                className={`apr-aresta seta${aceso(p.id) ? ' acesa' : ''}`}
                markerEnd="url(#apr-arv-seta)"
                x1={t.x} y1={t.y + 13} x2={p.x} y2={p.y - 15} />
            )
          })}

          {/* --- triar → cada folha, e a folha aprovada → k-NN */}
          {folhas.map((f, i) => {
            const acesa = i < folhasAcesas
            const x = xFolha(i)
            const y = yFolha(f, i)
            const knn = pos.get('knn')!
            const triar = pos.get('triar')!
            return (
              <g key={`ar${f.id}`}>
                <line className={`apr-aresta folha${acesa ? ' acesa' : ''}`}
                  x1={triar.x} y1={triar.y + 13} x2={x} y2={y} />
                {f.aprovado && (
                  <line className={`apr-aresta${aceso('knn') ? ' acesa' : ''}`}
                    x1={x} y1={y} x2={knn.x} y2={knn.y - 13}
                    opacity={acesa ? 1 : 0.15} />
                )}
              </g>
            )
          })}

          {/* --- triar → floresta, e os dois estimadores → prognóstico */}
          <line className={`apr-aresta seta${aceso('floresta') ? ' acesa' : ''}`}
            markerEnd="url(#apr-arv-seta)"
            x1={pos.get('triar')!.x} y1={pos.get('triar')!.y + 13}
            x2={pos.get('floresta')!.x} y2={pos.get('floresta')!.y - 13} />
          {(['knn', 'floresta'] as const).map((k) => (
            <line key={`pg${k}`}
              className={`apr-aresta seta${aceso('prognostico') ? ' acesa' : ''}`}
              markerEnd="url(#apr-arv-seta)"
              x1={pos.get(k)!.x} y1={pos.get(k)!.y + 13}
              x2={pos.get('prognostico')!.x} y2={pos.get('prognostico')!.y - 13} />
          ))}
          {(['redigir', 'revisar', 'juiz'] as const).map((k, i) => {
            const de = pos.get(['prognostico', 'redigir', 'revisar'][i])!
            return (
              <line key={`fi${k}`}
                className={`apr-aresta seta${aceso(k) ? ' acesa' : ''}`}
                markerEnd="url(#apr-arv-seta)"
                x1={de.x} y1={de.y + 12} x2={pos.get(k)!.x} y2={pos.get(k)!.y - 12} />
            )
          })}

          {/* --- a linha de corte, entre o último aprovado e o primeiro que não
                 passou. As folhas estão ordenadas por nota, então o corte é um
                 LUGAR da tela: o funil 40 → 8 vira distância, e não uma frase. */}
          {nAprovados > 0 && nReprovados > 0 && (
            <g className={`apr-corte${aceso('triar') ? ' acesa' : ''}`}>
              <line x1={96} y1={Y_CORTE} x2={W - 96} y2={Y_CORTE} />
              <text x={96} y={Y_CORTE - 10}>
                corte {corte}/5 — {nAprovados} passaram
              </text>
              <text x={96} y={Y_CORTE + 22}>
                {nReprovados} lidos e reprovados, todos aqui
              </text>
            </g>
          )}

          {/* --- as folhas */}
          {folhas.map((f, i) => {
            const acesa = i < folhasAcesas
            const atual = i === folhasAcesas - 1 && dentroDasFolhas
            const x = xFolha(i)
            const y = yFolha(f, i)
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
                  <text x={x} y={y - 16} textAnchor="middle" className="apr-folha-rot">
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
                <text x={t.direita ? t.x + r + 12 : t.x - r - 12} y={t.y + 5}
                  textAnchor={t.direita ? 'start' : 'end'} className="apr-arv-rot">
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
