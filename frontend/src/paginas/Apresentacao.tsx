import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { del, get, post } from '../api'
import { ArvoreAoVivo } from '../comp/ArvoreAoVivo'
import { ArvoreFloresta, type ArvoreRF } from '../comp/ArvoreFloresta'
import { Diagrama, type NoDiag } from '../comp/Diagrama'
import { Confronto, type DadosConfronto } from '../comp/Confronto'
import { ContaAoVivo, type Pesos } from '../comp/ContaAoVivo'
import { GrafoCerebro, type DadosGrafo } from '../comp/GrafoCerebro'
import '../estilo/apresentacao.css'

type Estado = { habilitada: boolean; autenticado: boolean }

type Dados = {
  apresentacao: {
    caso: { numero: string; julgado_em: string; orgao: string; materia: string; real: string }
    triagem: {
      elegiveis_2025: number
      pre_filtrados_decidiriam: number
      consultados: number
      decidiram: number
      cobertura_medida: number
    }
    acervo: {
      decisoes: number
      ancora: Record<string, number>
      merito: number
      reformas: number
      taxa_reforma: number
      nao_unanimes: number
      com_efeito: number
      relator: string
    }
    leitura: { classe: string; materia: string; tese: string; pedidos: string[] }
    prognostico: {
      decide: boolean
      p: number
      intervalo: [number, number]
      estimadores: { knn: number; floresta: number; conjunto: number }
      resultado: string
    }
    execucao: {
      etapas: { no: string; modelo: string; entrada: number; saida: number }[]
      candidatos: number
      aprovados: number
      segundos: number
    }
    juiz: { nota: number; modelo: string; criterios: Record<string, number>; critica: string }
    /** a cascata do prognóstico, congelada de api/serial.pesos */
    pesos: Pesos
    /** em que lei a minuta se apoiou, e o que o acórdão real citou */
    base_legal: {
      aprovados: number
      linhas: { lei: string; na_minuta: boolean; no_real: boolean; precedentes: number }[]
      disponiveis: { lei: string; precedentes: number }[]
    }
  }
  grafo: DadosGrafo & { arvore_rf?: ArvoreRF | null }
  confronto: DadosConfronto
}

const pct = (v: number, casas = 0) => `${(100 * v).toFixed(casas)}%`
const mil = (n: number) => n.toLocaleString('pt-BR')

/* ------------------------------------------------------- as cenas do fluxo
 *
 * Os quatro desenhos editoriais da página: o gabinete como ele é hoje, o que o
 * eproc cobre, o mesmo gabinete com o DrSec dentro, e o encaixe final.
 *
 * São os ÚNICOS conteúdos desta página que não saem de `dados/`, e por isso
 * não carregam número nenhum: `valor` aqui é sempre uma palavra ("de memória",
 * "o mérito"), nunca uma estatística. O contrato da apresentação é que nenhum
 * número é digitado à mão — inventar uma média de gabinete que ninguém mediu
 * derrubaria, por contágio, os números que foram medidos.
 *
 * GABINETE e COM_DRSEC são um par: mesmo primeiro nó, mesmo último nó, mesma
 * quantidade de níveis. A página não tem tabela comparativa de propósito — a
 * comparação é a semelhança entre os dois desenhos. Mexeu em um, mexa no
 * outro, ou o argumento se desfaz sem dar erro em lugar nenhum.
 */

const GABINETE: NoDiag[] = [
  {
    id: 'autos',
    nivel: 0,
    rotulo: 'Os autos chegam ao gabinete',
    valor: 'sorteio',
    nota: 'a distribuição não escolhe por matéria: cai o que cair',
    tom: 'neutro',
  },
  {
    id: 'leitura',
    nivel: 1,
    rotulo: 'Alguém lê o processo inteiro',
    valor: 'horas',
    nota: 'é aqui que se descobre do que o caso realmente trata',
    de: ['autos'],
    tom: 'neutro',
  },
  {
    id: 'portal',
    nivel: 2,
    rotulo: 'Busca no portal',
    valor: 'por palavra',
    nota: 'acha o que casa com o termo, não o que é análogo',
    de: ['leitura'],
    tom: 'ambar',
  },
  {
    id: 'memoria',
    nivel: 2,
    rotulo: 'O que o gabinete lembra',
    valor: 'de memória',
    nota: 'o caso parecido de três anos atrás, se alguém lembrar',
    de: ['leitura'],
    tom: 'ambar',
  },
  {
    id: 'escolha',
    nivel: 3,
    rotulo: 'Os precedentes escolhidos',
    valor: 'sem rastro',
    nota: 'por que estes e não outros não fica escrito em lugar nenhum',
    de: ['portal', 'memoria'],
    tom: 'ambar',
  },
  {
    id: 'minuta',
    nivel: 4,
    rotulo: 'A minuta é redigida',
    nota: 'ancorada no que foi encontrado — e só no que foi encontrado',
    de: ['escolha'],
    tom: 'neutro',
  },
  {
    id: 'assina',
    nivel: 5,
    rotulo: 'O relator revisa e assina',
    valor: 'o julgamento',
    nota: 'o critério dele entra aqui, e some com o processo',
    de: ['minuta'],
    tom: 'verde',
  },
]

const EPROC: NoDiag[] = [
  {
    id: 'eproc',
    nivel: 0,
    rotulo: 'O eproc',
    valor: 'o trilho',
    nota: 'distribui, controla prazo, registra movimento, colhe assinatura',
    tom: 'verde',
  },
  {
    id: 'entrega',
    nivel: 1,
    rotulo: 'Entrega os autos ao gabinete',
    nota: 'daqui em diante ele espera',
    de: ['eproc'],
    tom: 'neutro',
  },
  {
    id: 'vao',
    nivel: 2,
    rotulo: 'O vão',
    valor: 'o mérito',
    nota: 'não lê o caso, não conhece o relator, não sugere precedente',
    de: ['entrega'],
    rotuloAresta: 'fora do sistema',
    tom: 'fora',
  },
  {
    id: 'voto',
    nivel: 3,
    rotulo: 'Volta para receber o voto pronto',
    nota: 'publica, intima, movimenta — e o trilho segue',
    de: ['vao'],
    tom: 'verde',
  },
]

const COM_DRSEC: NoDiag[] = [
  {
    id: 'autos',
    nivel: 0,
    rotulo: 'Os autos chegam ao gabinete',
    valor: 'sorteio',
    nota: 'exatamente como hoje: nada muda na distribuição',
    tom: 'neutro',
  },
  {
    id: 'drsec',
    nivel: 1,
    rotulo: 'O DrSec lê o caso',
    valor: 'segundos',
    nota: 'e varre o acervo inteiro do relator, não uma busca por palavra',
    de: ['autos'],
    tom: 'verde',
  },
  {
    id: 'evidencia',
    nivel: 2,
    rotulo: 'Os precedentes dele, com o peso de cada um',
    valor: 'com rastro',
    nota: 'cada escolha com o motivo escrito e link para o inteiro teor',
    de: ['drsec'],
    tom: 'verde',
  },
  {
    id: 'prognostico',
    nivel: 2,
    rotulo: 'O prognóstico, ou o silêncio',
    valor: 'ou nada',
    nota: 'sem margem folgada, nenhum percentual sai',
    de: ['drsec'],
    tom: 'ambar',
  },
  {
    id: 'leitura',
    nivel: 3,
    rotulo: 'Alguém lê o processo inteiro',
    valor: 'continua',
    nota: 'agora com a pesquisa já feita em cima da mesa',
    de: ['evidencia', 'prognostico'],
    tom: 'neutro',
  },
  {
    id: 'minuta',
    nivel: 4,
    rotulo: 'A minuta é redigida',
    nota: 'a partir de um rascunho no estilo do gabinete, ou do zero',
    de: ['leitura'],
    tom: 'neutro',
  },
  {
    id: 'assina',
    nivel: 5,
    rotulo: 'O relator revisa e assina',
    valor: 'o julgamento',
    nota: 'continua sendo dele, e agora fica registrado',
    de: ['minuta'],
    tom: 'verde',
  },
]

const NO_EPROC: NoDiag[] = [
  {
    id: 'eproc',
    nivel: 0,
    rotulo: 'O eproc, como está',
    valor: 'o trilho',
    nota: 'nenhuma migração, nenhuma tela nova para aprender',
    tom: 'verde',
  },
  {
    id: 'drsec',
    nivel: 1,
    rotulo: 'O DrSec, como camada',
    nota: 'ocupa o vão da cena 03, sem substituir nada do que já funciona',
    de: ['eproc'],
    tom: 'verde',
  },
  {
    id: 'cerebro',
    nivel: 2,
    rotulo: 'Um cérebro por magistrado',
    valor: 'não a média',
    nota: 'acervo dele, critério dele, jeito dele de escrever',
    de: ['drsec'],
    tom: 'verde',
  },
  {
    id: 'voto',
    nivel: 3,
    rotulo: 'O voto continua sendo do relator',
    nota: 'o DrSec não decide, não assina e não fala em nome de ninguém',
    de: ['cerebro'],
    tom: 'neutro',
  },
]

/* ----------------------------------------------------------------- cinema */

/** Os elementos que entram por rolagem. A mesma lista mora no CSS; aqui ela só
 *  serve ao caminho de trás (navegador sem animation-timeline). */
const REVELAR = '.apr-capa h1, .apr-capa .apr-dek, .apr-numero, .apr-cab, '
  + '.apr-aviso, .apr-confronto, .apr-cartao, .apr-tabela, .apr-grafo, '
  + '.apr-dica, .apr-citacao, .apr-virada'

/** Revela por rolagem.
 *
 *  Duas coisas num observador só, e não é preguiça — são trabalhos diferentes:
 *  o `[data-entra]` é ONE-SHOT (o mapa nasce quando entra em vista, e nascer
 *  duas vezes não existe), e a lista REVELAR é o SUBSTITUTO de
 *  `animation-timeline: view()` onde ele não existe. Onde existe, o CSS faz
 *  sozinho e este observador nem olha para ela.
 *
 *  O scroller é o `.apr`, não a janela — por isso `root` é ele. */
function useEntrada(pronto: boolean) {
  useEffect(() => {
    if (!pronto) return
    const raiz = document.querySelector('.apr')
    if (!raiz) return
    const alvos = [...raiz.querySelectorAll('[data-entra]')]
    if (!CSS.supports('animation-timeline', 'view()')) {
      raiz.classList.add('sem-timeline')
      alvos.push(...raiz.querySelectorAll(REVELAR))
    }
    const obs = new IntersectionObserver((entradas) => {
      for (const e of entradas) {
        if (!e.isIntersecting) continue
        e.target.classList.add('visivel')
        obs.unobserve(e.target)
      }
    }, { root: raiz, rootMargin: '0px 0px -10% 0px' })
    alvos.forEach((el) => obs.observe(el))
    return () => obs.disconnect()
  }, [pronto])
}

/** Sobe de zero até o valor quando entra em vista. É a única coisa desta página
 *  que precisa de JS para o efeito; o resto é CSS. */
function Conta({ v, fmt, cls }: { v: number; fmt: (n: number) => string; cls?: string }) {
  const [n, defN] = useState(0)
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      defN(v)
      return
    }
    const obs = new IntersectionObserver(([e]) => {
      if (!e?.isIntersecting) return
      clearTimeout(rede)
      obs.disconnect()
      const t0 = performance.now()
      const passo = (t: number) => {
        const k = Math.min(1, (t - t0) / 950)
        defN(v * (1 - (1 - k) ** 3))
        if (k < 1) requestAnimationFrame(passo)
      }
      requestAnimationFrame(passo)
    }, { threshold: 0.4 })
    // Rede: se nada disparar — aba em segundo plano congela o rAF, e o
    // observador pode nem chegar a chamar — o número aparece assim mesmo. Zero
    // é uma resposta errada numa página cujo contrato é não ter número digitado
    // à mão, e é a resposta que se veria.
    const rede = setTimeout(() => { obs.disconnect(); defN(v) }, 2500)
    obs.observe(el)
    return () => { clearTimeout(rede); obs.disconnect() }
  }, [v])
  return <b ref={ref} className={cls}>{fmt(n)}</b>
}

/** As três formas que recortam a fronteira entre uma cena e a próxima. Em
 *  objectBoundingBox, então servem a qualquer altura de seção sem recalcular. */
function Formas() {
  return (
    <svg className="apr-formas" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id="apr-corte-diagonal" clipPathUnits="objectBoundingBox">
          <path d="M0,0.055 L1,0 L1,1 L0,1 Z" />
        </clipPath>
        <clipPath id="apr-corte-onda" clipPathUnits="objectBoundingBox">
          <path d="M0,0.03 C0.18,0.075 0.34,0.005 0.52,0.04 C0.7,0.075 0.85,0.01 1,0.045
                   L1,1 L0,1 Z" />
        </clipPath>
        <clipPath id="apr-corte-zigue" clipPathUnits="objectBoundingBox">
          <path d="M0,0.02 L0.17,0.07 L0.34,0.02 L0.5,0.07 L0.66,0.02 L0.83,0.07 L1,0.025
                   L1,1 L0,1 Z" />
        </clipPath>
      </defs>
    </svg>
  )
}

/* ------------------------------------------------------------------ portão */

function Portao({ habilitada }: { habilitada: boolean }) {
  const qc = useQueryClient()
  const [senha, setSenha] = useState('')
  const entrar = useMutation({
    mutationFn: () => post('/api/apresentacao/sessao', { senha }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['apr-estado'] }),
  })

  return (
    <div className="apr">
      <div className="apr-portao">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (senha) entrar.mutate()
          }}
        >
          <span className="apr-marca">DrSec</span>
          <h1>Apresentação</h1>
          {habilitada ? (
            <>
              <p>Esta página é privada. Digite a senha que veio junto com o link.</p>
              <input
                type="password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                placeholder="senha"
                autoFocus
                aria-label="senha da apresentação"
              />
              {entrar.isError && (
                <p className="apr-erro">{(entrar.error as Error).message}</p>
              )}
              <button className="apr-btn" type="submit" disabled={!senha || entrar.isPending}>
                {entrar.isPending ? 'conferindo…' : 'entrar'}
              </button>
            </>
          ) : (
            <p className="apr-erro">
              A apresentação está desabilitada: falta definir <code>APRESENTACAO_SENHA</code> no
              arquivo <code>.env</code> do servidor.
            </p>
          )}
        </form>
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- a página */

export function Apresentacao() {
  const qc = useQueryClient()
  const { data: estado, isLoading } = useQuery({
    queryKey: ['apr-estado'],
    queryFn: () => get<Estado>('/api/apresentacao/estado'),
    retry: false,
  })
  const { data } = useQuery({
    queryKey: ['apr-dados'],
    queryFn: () => get<Dados>('/api/apresentacao/dados'),
    enabled: !!estado?.autenticado,
    retry: false,
    staleTime: Infinity,
  })
  const sair = useMutation({
    mutationFn: () => del('/api/apresentacao/sessao'),
    onSuccess: () => qc.clear(),
  })

  // antes dos returns: hook não pode ficar atrás de um early return
  useEntrada(!!data)

  if (isLoading) return null
  if (!estado?.autenticado) return <Portao habilitada={!!estado?.habilitada} />
  if (!data) return <div className="apr" />

  const a = data.apresentacao
  const c = data.confronto

  return (
    <div className="apr">
      <Formas />
      <div className="apr-progresso" aria-hidden="true" />

      {/* ---------------------------------------------------------- capa */}
      <header className="apr-capa apr-largura">
        <span className="apr-marca">DrSec · {a.acervo.relator} · TJSC</span>
        <h1>O critério de um desembargador, disponível dentro do eproc.</h1>
        <p className="apr-dek">
          O DrSec leu as {mil(a.acervo.decisoes)} decisões que {a.acervo.relator} já assinou e
          aprendeu a decidir como ele. Você entrega o processo; em {a.execucao.segundos} segundos
          voltam os precedentes dele que sustentam o caso, o peso de cada um e a minuta escrita
          no estilo do gabinete. Quando os dados não bastam, ele diz que não sabe.
        </p>
        <div className="apr-numeros">
          <div className="apr-numero">
            <Conta v={a.acervo.decisoes} fmt={(n) => mil(Math.round(n))} />
            <span>decisões dele, lidas por inteiro</span>
          </div>
          <div className="apr-numero">
            <Conta v={a.execucao.segundos} fmt={(n) => `${Math.round(n)}s`} />
            <span>para produzir a decisão desta página</span>
          </div>
          <div className="apr-numero">
            <Conta v={a.execucao.aprovados}
              fmt={(n) => `${Math.round(n)} de ${a.execucao.candidatos}`} />
            <span>precedentes aproveitados, cada um com link para o acórdão público</span>
          </div>
          <div className="apr-numero">
            <Conta v={a.prognostico.p} fmt={(n) => pct(n)} />
            <span>de chance de reforma prevista. O acórdão reformou.</span>
          </div>
        </div>
      </header>

      {/* ------------------------------------------------------ o precedente
       *
       * ABRE a história, e não é decoração: quem assiste chega com a suspeita
       * de que clonar um decisor é ficção científica. A seção derruba isso com
       * um produto que tem preço em tabela — e só então o resto da página pode
       * falar do gabinete. Todo número aqui é conferível e está com a fonte ao
       * lado. O que NÃO entra, de propósito: os "1.757 startups / US$ 84,6 bi"
       * que o site da Foundry exibe. O rodapé de lá diz que são dados de
       * ex-alunos da HBS de 2014–2025, não resultado do produto — usar como
       * impacto seria dado falso, e cair nisso custaria a página inteira. */}
      <section className="apr-secao apr-largura">
        <div className="apr-cena" aria-hidden="true" />
        <div className="apr-cab">
          <span className="apr-etapa">01 · O PRECEDENTE</span>
          <h2>Harvard já faz isso. E cobra US$ 699.</h2>
          <p>
            Em maio de 2026 a Harvard Business School lançou a <strong>Foundry</strong>. Sete
            professores e senior lecturers sentaram para entrevistas e sessões de gravação para
            que <strong>clones de IA de si mesmos</strong> fossem construídos. Hoje fundadores
            ensaiam pitch, reunião de conselho e conversa difícil contra esses clones — antes de
            encarar os professores de verdade. Setecentos e sessenta já passaram por isso.
          </p>
        </div>

        <div className="apr-cartoes">
          <div className="apr-cartao">
            <b className="grande">7</b>
            <h3>professores clonados</h3>
            <p>
              Voluntariamente, entre eles Shikhar Ghosh, Christina Wallace e Jim Matheson. Os
              avatares foram construídos pela HeyGen.
            </p>
          </div>
          <div className="apr-cartao">
            <b className="grande">US$ 699</b>
            <h3>oito semanas de programa</h3>
            <p>
              A anuidade da Harvard Business School passa de US$ 84.000. O clone é o que torna a
              diferença possível.
            </p>
          </div>
          <div className="apr-cartao">
            <b className="grande">760</b>
            <h3>fundadores já passaram</h3>
            <p>
              Ensaiam contra um investidor de IA vinte vezes ou mais antes da conversa que conta.
              Vários venceram competições de pitch depois.
            </p>
          </div>
          <div className="apr-cartao">
            <b className="grande">2026</b>
            <h3>não é projeto de laboratório</h3>
            <p>
              É produto, com preço, turma e Demo Day no campus da HBS. A escola de negócios mais
              conservadora do mundo pôs o próprio nome nisso.
            </p>
          </div>
        </div>

        <blockquote className="apr-citacao">
          <p>
            “O objetivo não é criar um substituto para mim. É dar aos fundadores outro jeito de
            se preparar e de desafiar o próprio raciocínio — para que, quando a gente se
            encontrar ao vivo, o tempo valioso seja gasto nas perguntas em que julgamento humano
            e conversa importam mais.”
          </p>
          <cite>
            Shikhar Ghosh, professor da Harvard Business School, à <em>Fortune</em>,
            25 de agosto de 2026
          </cite>
        </blockquote>

        {/* A VIRADA. É o cartão mais forte da seção porque é verdade e é
            verificável dos dois lados: o método da Foundry é declarado por
            eles, e o acervo daqui está a um clique no portal do TJSC. */}
        <div className="apr-virada">
          <span className="rot">A diferença, que joga a favor</span>
          <p>
            A Harvard modelou o que sete especialistas <strong>dizem</strong> sobre como decidem:
            entrevistas, gravações, o que cada um conta do próprio julgamento.
          </p>
          <p>
            O DrSec modela o que um desembargador <strong>de fato decidiu</strong> —{' '}
            {mil(a.acervo.decisoes)} vezes, em documentos públicos, cada um com link para o
            inteiro teor. Não é o que ele diz que pensa. É o que ele assinou.
          </p>
        </div>

        <p className="apr-dica">
          Fontes: <a href="https://hbsfoundry.org/" target="_blank" rel="noreferrer">
            hbsfoundry.org
          </a>{' '}
          e{' '}
          <a href="https://fortune.com/2026/08/25/harvard-startup-bootcamp-ai/"
            target="_blank" rel="noreferrer">
            Fortune, 25/08/2026
          </a>. A Harvard Business School <strong>não tem relação com este projeto</strong> e não
          trabalha com decisões judiciais. O que a comparação afirma é uma coisa só: modelar um
          decisor para consultar antes de decidir deixou de ser exótico — virou produto de escola
          de negócios, com preço em tabela.
        </p>
      </section>

      {/* ------------------------------------------------------- o gabinete
       *
       * O AS-IS, e é a parte que precisa de detalhe: quem assiste conhece este
       * fluxo melhor do que nós, e reconhecer o próprio dia a dia no desenho é
       * o que compra o resto da página. Nenhum número inventado aqui — os nós
       * dizem "por palavra", "de memória", e não uma estatística de gabinete
       * que ninguém mediu. Numa página cujo contrato é não ter número digitado
       * à mão, inventar um aqui derrubaria os outros todos. */}
      <section className="apr-secao apr-largura">
        <div className="apr-cena" aria-hidden="true" />
        <div className="apr-cab">
          <span className="apr-etapa">02 · O GABINETE, HOJE</span>
          <h2>Como um voto nasce hoje, do sorteio até a assinatura</h2>
          <p>
            Nada aqui é ineficiência de ninguém. É o desenho possível quando a única memória do
            acervo é humana: o processo chega, alguém lê tudo, alguém procura no portal por
            palavra-chave, alguém lembra de um caso parecido de três anos atrás. A escolha que
            vai sustentar o voto acontece nessa hora — e não fica escrita em lugar nenhum.
          </p>
        </div>
        <Diagrama rotulo="O caminho de um processo dentro do gabinete, hoje" nos={GABINETE} />
        <p className="apr-dica">
          Repare nos três nós cor de areia, no meio. É ali que mora o julgamento, e é o único
          trecho do caminho que <strong>não deixa rastro</strong>. Se alguém perguntar seis meses
          depois por que aquele precedente foi usado e não outro, a resposta está com a pessoa,
          não com o processo.
        </p>
      </section>

      {/* ----------------------------------------------------------- eproc */}
      <section className="apr-secao apr-largura">
        <div className="apr-cena" aria-hidden="true" />
        <div className="apr-cab">
          <span className="apr-etapa">03 · O EPROC, HOJE</span>
          <h2>O eproc leva o processo até a porta do gabinete — e espera</h2>
          <p>
            O eproc faz muito bem aquilo a que se propôs: distribui, controla prazo, registra
            cada movimento, colhe a assinatura e devolve o processo ao mundo. Ele é o trilho. O
            que ele não faz é o mérito — e nem deveria, porque nunca foi construído para isso.
            Entre entregar os autos e receber o voto pronto existe um vão, e é dentro desse vão
            que o trabalho de julgar acontece, fora do sistema.
          </p>
        </div>
        <Diagrama rotulo="O que o eproc cobre, e onde ele para" nos={EPROC} />
        <p className="apr-dica">
          O nó apagado no meio não é uma crítica ao eproc: é o espaço que ele deliberadamente
          deixa livre. O DrSec não substitui trilho nenhum — ele ocupa esse vão.
        </p>
      </section>

      {/* ------------------------------------------------- o que sai junto */}
      <section className="apr-secao apr-largura">
        <div className="apr-cena" aria-hidden="true" />
        <div className="apr-cab">
          <span className="apr-etapa">04 · O QUE SAI COM A PESSOA</span>
          <h2>Vinte anos de critério que não estão escritos em lugar nenhum</h2>
          <p>
            Um desembargador com {mil(a.acervo.decisoes)} decisões assinadas construiu, ao longo
            de décadas, uma forma própria de resolver cada matéria. Essa forma existe — está
            provada, documento por documento, no portal do tribunal. O que não existe é um lugar
            onde ela esteja <em>consultável</em>.
          </p>
        </div>
        <div className="apr-cartoes">
          <div className="apr-cartao">
            <h3>O assessor troca</h3>
            <p>
              Quem sabia onde procurar, o que aquele relator costuma aceitar e qual precedente
              ele nunca comprou vai embora com a pessoa. O gabinete recomeça a aprender.
            </p>
          </div>
          <div className="apr-cartao">
            <h3>O magistrado se aposenta</h3>
            <p>
              As decisões continuam públicas, e ninguém as lê de novo. Viram arquivo: presentes,
              acessíveis e mortas, porque não há tempo de garimpar vinte anos por caso.
            </p>
          </div>
          <div className="apr-cartao">
            <h3>Ninguém lê o acervo inteiro</h3>
            <p>
              Não é falta de vontade, é aritmética. {mil(a.acervo.decisoes)} acórdãos por leitor
              humano não cabem em prazo processual nenhum — por isso a busca é sempre por
              palavra, e sempre parcial.
            </p>
          </div>
          <div className="apr-cartao">
            <h3>A coerência fica no acaso</h3>
            <p>
              Dois processos iguais que caem em semanas diferentes podem receber precedentes
              diferentes, porque foram duas buscas diferentes. Nada nesse desenho garante que a
              segunda encontre o que a primeira encontrou.
            </p>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- grafo */}
      <section className="apr-secao apr-largura apr-secao-fria">
        <div className="apr-cena" aria-hidden="true" />
        <div className="apr-cab">
          <span className="apr-etapa">05 · O CÉREBRO DO RELATOR</span>
          <h2>É isto que o DrSec constrói: o critério dele, desenhado.</h2>
          <p>
            Um caso real atravessando o cérebro do relator. À esquerda, o caminho que o sistema
            percorreu. Em órbita, <strong>os {data.grafo.dado.triar.lidos} acórdãos que ele leu
            de verdade</strong> — não só os {data.grafo.dado.triar.aprovados} que sobreviveram.
            Quanto mais perto do centro, mais parecido com o caso em mãos. Passe o mouse para
            acender a vizinhança; clique em qualquer nó para abrir o documento. Cada um que foi
            descartado carrega, escrito, o motivo do descarte.
          </p>
        </div>
        <GrafoCerebro g={data.grafo} />
        <p className="apr-dica">
          Aproveitados e descartados, todos com link para o inteiro teor no portal do TJSC. Os
          quadrados são <strong>súmulas e temas repetitivos</strong> citados por mais de um
          precedente; os losangos, os <strong>artigos de lei</strong> em que eles se apoiam. É a
          diferença entre uma resposta e uma resposta que se pode conferir.
        </p>
      </section>

      {/* -------------------------------------------------------- a árvore */}
      <section className="apr-secao apr-largura">
        <div className="apr-cena" aria-hidden="true" />
        <div className="apr-cab">
          <span className="apr-etapa">06 · O CÉREBRO ACONTECENDO</span>
          <h2>O mesmo caso, agora em movimento — um passo de cada vez</h2>
          <p>
            O mapa acima está parado, para ser explorado. Este é o mesmo cérebro em execução, na
            ordem real: o processo entra, o sistema entende do que ele trata, procura no acervo e
            volta com {data.grafo.dado.bm80.n} candidatos, reduz para os{' '}
            {data.grafo.dado.triar.lidos} que valem a leitura, e então{' '}
            <strong>lê um por um, dando nota a cada um</strong>, até sobrarem{' '}
            {data.grafo.dado.triar.aprovados}. A árvore inteira está na tela desde o primeiro
            quadro, apagada: o tamanho do funil é metade do que há para ver.
          </p>
        </div>
        <ArvoreAoVivo g={data.grafo} />

        {/* A SEGUNDA CENA. A de cima é o pipeline — as etapas do sistema. Esta
            é a decisão matemática propriamente dita, e ela existe porque
            "árvore" na cena anterior era metáfora e aqui é literal: são os
            cortes que o RandomForest usa, lidos do próprio floresta.pkl.
            Só aparece se houver floresta treinada. */}
        {data.grafo.arvore_rf && (
          <>
            <div className="apr-cab apr-cab-cena">
              <span className="apr-etapa">06b · POR DENTRO</span>
              <h2>E dentro dele, uma árvore de decisão de verdade</h2>
              <p>
                Acima está o caminho. Aqui está o que sustenta a previsão: são{' '}
                <strong>{mil(data.grafo.arvore_rf.arvores)} árvores</strong> treinadas nas
                decisões até {data.grafo.arvore_rf.ano_corte}, todas votando. Esta é uma delas,
                com as perguntas que ela realmente faz e quantas decisões restam a cada resposta.
                O caminho que acende é o galho por onde <strong>este caso</strong> desceu.
              </p>
            </div>
            <ArvoreFloresta a={data.grafo.arvore_rf} />
          </>
        )}
      </section>

      {/* ------------------------------------------------ onde o drsec entra
       *
       * O TO-BE, e o desenho é deliberadamente o MESMO da cena 02: mesmos nós
       * humanos, mesmo começo, mesmo fim, mesma altura. Não há tabela
       * comparativa nesta página de propósito — a comparação se lê sozinha
       * quando os dois desenhos são reconhecíveis um no outro, e uma tabela só
       * repetiria em palavras o que o desenho já disse. Se um dia alguém mexer
       * nos nós de GABINETE, mexa nos daqui: é a semelhança que faz o
       * argumento, não cada desenho isolado. */}
      <section className="apr-secao apr-largura">
        <div className="apr-cena" aria-hidden="true" />
        <div className="apr-cab">
          <span className="apr-etapa">07 · ONDE O DRSEC ENTRA</span>
          <h2>O mesmo gabinete, com o acervo do relator já lido</h2>
          <p>
            Compare com o desenho da cena 02: começa igual e termina igual. O processo continua
            chegando por sorteio, o assessor continua lendo os autos e{' '}
            <strong>o voto continua sendo do relator</strong>. O que mudou é o meio do caminho —
            onde antes havia busca por palavra e memória de quem estava na sala, agora há o
            acervo inteiro já lido, com a conta de cada escolha à vista.
          </p>
        </div>
        <Diagrama rotulo="O mesmo caminho, com o DrSec no vão" nos={COM_DRSEC} />
        <p className="apr-dica">
          O DrSec não decide e não assina. Ele entrega ao gabinete, em segundos, a pesquisa que
          hoje leva horas — e a entrega <strong>com o rastro</strong>: quais decisões, por que
          essas, quanto cada uma pesou. O julgamento continua exatamente onde estava.
        </p>
      </section>

      {/* ------------------------------------------------------ confronto */}
      <section className="apr-secao apr-largura">
        <div className="apr-cena" aria-hidden="true" />
        <div className="apr-cab">
          <span className="apr-etapa">08 · A PROVA NESTE CASO</span>
          <h2>A decisão real e a decisão do DrSec, lado a lado</h2>
          <p>
            Processo <strong>{c.caso.numero}</strong>, {c.caso.materia}. Julgado em{' '}
            {c.caso.julgado_em} pela {c.caso.orgao}. O sistema recebeu os autos no estado da
            véspera do julgamento e escreveu a própria decisão, sem nunca ver o acórdão.
          </p>
        </div>

        <div className="apr-aviso" style={{ marginBottom: '2rem' }}>
          <span className="rot">Como este teste foi montado</span>
          <p>
            O que entrou no sistema foi o <strong>relatório do próprio acórdão</strong>: a síntese
            que o tribunal faz da decisão recorrida e das razões recursais, cortada{' '}
            <strong>antes do voto</strong>. Nenhuma linha do desfecho entrou. A decisão real
            também <strong>saiu do acervo</strong> antes da consulta: sem isso o sistema
            encontraria a resposta pronta e o teste viraria cópia. A aba “O que foi entregue ao
            sistema” reproduz o arquivo inteiro.
          </p>
        </div>

        <Confronto c={c} segundos={a.execucao.segundos} relator={a.acervo.relator} />

        {/* Em que lei o documento se apoiou. O sistema NÃO tem o texto de lei
            nenhuma: o que ele sabe é quais dispositivos as decisões reais deste
            tribunal invocam nesta matéria, e é essa lista que vai para o redator.
            A coluna "precedentes" é o que separa fundamento de citação de
            memória — e a linha que não bate fica à vista igual. */}
        <div className="apr-tabela" style={{ marginTop: '2rem' }}>
          <table>
            <caption className="apr-formula">
              Em que lei este documento se apoia
            </caption>
            <thead>
              <tr>
                <th>Dispositivo legal</th>
                <th className="num">Na minuta gerada</th>
                <th className="num">No acórdão real</th>
                <th className="num">Precedentes que o invocam</th>
              </tr>
            </thead>
            <tbody>
              {a.base_legal.linhas.map((l) => (
                <tr key={l.lei}>
                  <td>{l.lei}</td>
                  <td className={`num ${l.na_minuta ? 'sim' : 'nao'}`}>
                    {l.na_minuta ? 'sim' : 'não'}
                  </td>
                  <td className={`num ${l.no_real ? 'sim' : 'nao'}`}>
                    {l.no_real ? 'sim' : 'não'}
                  </td>
                  <td className="num destaque">
                    {l.precedentes} de {a.base_legal.aprovados}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="apr-dica">
          O sistema não guarda o texto de lei nenhuma. Ele sabe em que artigos as decisões reais
          desta câmara se apoiam nesta matéria, e é só isso que afirma — a lista vai dentro das
          instruções de quem redige, que é proibido de citar artigo fora dela.{' '}
          {a.base_legal.linhas.some((l) => l.no_real && !l.na_minuta) && (
            <>
              Repare na linha que não bate: o desembargador invocou um dispositivo que a minuta
              não citou, embora ele estivesse disponível nos precedentes entregues. Está aqui
              porque esconder seria vitrine.
            </>
          )}
        </p>
      </section>

      {/* --------------------------------------------------------- a conta */}
      <section className="apr-secao apr-largura">
        <div className="apr-cena" aria-hidden="true" />
        <div className="apr-cab">
          <span className="apr-etapa">09 · DE ONDE VEM O NÚMERO</span>
          <h2>O prognóstico não é opinião da máquina. É esta conta.</h2>
          <p>
            Nenhuma inteligência artificial participa desta etapa. São{' '}
            {a.pesos.precedentes.length} precedentes virando um peso cada, duas contas
            independentes que erram para lados opostos, um ajuste de escala e um portão que cala
            o sistema quando a margem é apertada. A conta abaixo se monta sozinha, na ordem em
            que o sistema a faz, e fecha exatamente no número que o relatório imprimiu.
          </p>
        </div>
        {/* O DESENHO DA CONTA, antes da conta. A escada abaixo explica cada
            degrau, mas em coluna ela não mostra a FORMA: que são duas contas
            independentes confluindo, e não uma fila. A confluência é o
            argumento — é dela que sai o desacordo que fecha o portão. */}
        <Diagrama
          rotulo="Como o prognóstico é calculado, do voto dos precedentes até o portão"
          nos={[
            {
              id: 'knn',
              nivel: 0,
              rotulo: 'O voto dos precedentes',
              valor: pct(a.pesos.agregacao.knn ?? 0, 1),
              nota: `entre os ${a.pesos.precedentes.length} mais parecidos, quantos reformaram`,
              tom: 'verde',
            },
            {
              id: 'floresta',
              nivel: 0,
              rotulo: 'A leitura do texto',
              valor: pct(a.pesos.agregacao.floresta ?? 0, 1),
              nota: '400 árvores lendo o caso, sem olhar a busca',
              tom: 'ambar',
            },
            {
              id: 'conjunto',
              nivel: 1,
              rotulo: 'As duas juntas',
              valor: pct(a.pesos.agregacao.conjunto ?? 0, 1),
              nota: `média ponderada, peso ${a.pesos.config.peso_knn} no voto dos precedentes`,
              de: ['knn', 'floresta'],
              tom: 'neutro',
            },
            {
              id: 'calibrado',
              nivel: 2,
              rotulo: 'O ajuste de escala',
              valor: pct(a.pesos.agregacao.calibrado ?? 0, 1),
              nota: 'faz 70% querer dizer 70% de verdade',
              de: ['conjunto'],
              tom: 'verde',
            },
            {
              id: 'portao',
              nivel: 3,
              rotulo: 'O portão — cinco cortes',
              valor: a.prognostico.decide ? 'RESPONDE' : 'NÃO DECIDO',
              nota: 'reprovou em um? nenhum percentual sai',
              de: ['calibrado'],
              tom: a.prognostico.decide ? 'verde' : 'fora',
            },
          ]}
        />
        <ContaAoVivo p={a.pesos} />
      </section>

      {/* --------------------------------------------------------- prova */}
      <section className="apr-secao apr-largura">
        <div className="apr-cena" aria-hidden="true" />
        <div className="apr-cab">
          <span className="apr-etapa">10 · UM CASO NÃO PROVA NADA</span>
          <h2>Por isso a medição usou 400</h2>
          <p>
            O sistema sorteia decisões já julgadas, tira cada uma do acervo e recebe só a parte
            que descreve o caso, limpa de qualquer trecho que entregue o desfecho. Depois compara
            o que ele previu com o que o desembargador decidiu de verdade. Nenhuma inteligência
            artificial participa dessa medição — ela mede o núcleo do sistema sozinho.
          </p>
        </div>
        {/* O FUNIL DA MEDIÇÃO. Os três cartões abaixo dão os números; este
            desenho dá a forma — e a forma é o que impede a leitura errada.
            "96,7% de acerto" sozinho parece um sistema quase infalível; a
            árvore mostra que esse 96,7% vive dentro do galho estreito, e que o
            galho largo é o silêncio. */}
        <Diagrama
          rotulo="Como os 400 casos cegos se dividem entre silêncio, acerto e erro"
          nos={[
            {
              id: 'casos',
              nivel: 0,
              rotulo: 'Casos já julgados, com gabarito',
              valor: '400',
              nota: 'sorteados, tirados do acervo, sem o desfecho no texto',
              tom: 'neutro',
            },
            {
              id: 'cala',
              nivel: 1,
              rotulo: 'O sistema cala',
              valor: pct(1 - a.triagem.cobertura_medida, 1),
              nota: 'entrega as evidências, e nenhum percentual',
              de: ['casos'],
              rotuloAresta: 'não passou no portão',
              tom: 'fora',
            },
            {
              id: 'responde',
              nivel: 1,
              rotulo: 'O sistema responde',
              valor: pct(a.triagem.cobertura_medida, 1),
              nota: 'passou nos cinco cortes do portão',
              de: ['casos'],
              rotuloAresta: 'passou',
              tom: 'verde',
            },
            {
              id: 'acerta',
              nivel: 2,
              rotulo: 'Acertou',
              valor: '96,7%',
              nota: 'do que respondeu',
              de: ['responde'],
              tom: 'verde',
            },
            {
              id: 'erra',
              nivel: 2,
              rotulo: 'Errou',
              valor: '3,3%',
              nota: 'erra pouco porque responde pouco',
              de: ['responde'],
              tom: 'ambar',
            },
          ]}
        />

        <div className="apr-cartoes">
          <div className="apr-cartao">
            <b className="grande">72,4%</b>
            <h3>de acerto quando aponta reforma</h3>
            <p>A taxa base é 32,5%. Um palpite aleatório erra mais de dois terços das vezes.</p>
          </div>
          <div className="apr-cartao">
            <b className="grande">96,7%</b>
            <h3>de acerto quando responde</h3>
            <p>
              A contrapartida: em 62% das consultas não há resposta. O silêncio é projetado.
            </p>
          </div>
          <div className="apr-cartao">
            <b className="grande">48,5%</b>
            <h3>das reformas reais são sinalizadas</h3>
            <p>
              Mais da metade escapa. Ausência de sinal não indica que o desembargador manteria a
              decisão.
            </p>
          </div>
        </div>

        <div className="apr-aviso" style={{ marginTop: '2rem' }}>
          <span className="rot">Como o caso desta página foi escolhido</span>
          <p>
            De {mil(a.triagem.elegiveis_2025)} processos de 2025 elegíveis, um pré-filtro que não
            usa IA apontou {mil(a.triagem.pre_filtrados_decidiriam)} em que o sistema
            provavelmente cravaria um prognóstico. Foram consultados {a.triagem.consultados}; em{' '}
            {a.triagem.decidiram} houve prognóstico, e o desta página é um deles.{' '}
            <strong>
              O caso não é representativo: na medição de 400 processos, o sistema responde em{' '}
              {pct(a.triagem.cobertura_medida, 1)} das vezes.
            </strong>
          </p>
        </div>
      </section>

      {/* ------------------------------------------------------- recusa */}
      <section className="apr-secao apr-largura">
        <div className="apr-cena" aria-hidden="true" />
        <div className="apr-cab">
          <span className="apr-etapa">11 · O QUE O DRSEC SE RECUSA A FAZER</span>
          <h2>As recusas custaram mais para construir do que as respostas</h2>
          <p>
            Um sistema que responde sempre é fácil de construir e impossível de confiar. Estas
            quatro recusas são o que torna o resto utilizável.
          </p>
        </div>
        <div className="apr-cartoes">
          <div className="apr-cartao">
            <h3>Sem margem, não decide</h3>
            <p>
              Quando as duas contas divergem, ou o resultado fica perto do meio, sai o dossiê de
              evidências completo e nenhum percentual. Em quatro processos reais, a recusa evitou
              um erro e custou dois acertos.
            </p>
          </div>
          <div className="apr-cartao">
            <h3>Percentual não sai quando você já escolheu o lado</h3>
            <p>
              Se o pedido é “quero reformar”, o sistema separa só o material que sustenta esse
              lado. Contar resultado ali mediria a sua escolha, não o tribunal. Um teste
              automático quebra o build se algum número escapar.
            </p>
          </div>
          <div className="apr-cartao">
            <h3>Ninguém julga o próprio trabalho</h3>
            <p>
              Quem escreve, quem revisa e quem dá nota vêm de fornecedores diferentes, de
              propósito: modelos da mesma família tendem a concordar consigo mesmos, e isso
              anularia a revisão. Nesta consulta a nota foi <strong>{a.juiz.nota} de 5</strong>,
              com o defeito apontado por escrito.
            </p>
          </div>
          <div className="apr-cartao">
            <h3>Mostra onde a própria tese é frágil</h3>
            <p>
              Toda minuta fecha apontando, do material recuperado, o que enfraquece o argumento:
              precedente não unânime, súmula que só vale no estado, fato que afasta a semelhança.
              É o oposto de uma ferramenta que só dá razão.
            </p>
          </div>
        </div>
        <p className="apr-dica">
          O acervo é 100% TJSC, de um relator só. Dá para afirmar que um tema repetitivo do STJ
          vincula o país; não dá para dizer o que outro tribunal faz com ele — e o sistema
          declara isso em vez de estimar.
        </p>
      </section>

      {/* -------------------------------------------------- dentro do eproc */}
      <section className="apr-secao apr-largura">
        <div className="apr-cena" aria-hidden="true" />
        <div className="apr-cab">
          <span className="apr-etapa">12 · DENTRO DO EPROC</span>
          <h2>Uma camada, não um sistema novo para aprender</h2>
          <p>
            O DrSec nasce para viver dentro do eproc, no vão da cena 03. Ninguém troca de
            ferramenta, ninguém migra processo, ninguém aprende tela nova: o processo continua
            chegando pelo mesmo caminho, e a pesquisa passa a vir junto com ele.
          </p>
        </div>
        <Diagrama rotulo="Como o DrSec se encaixa" nos={NO_EPROC} />
        <div className="apr-virada">
          <span className="rot">Um cérebro por magistrado</span>
          <p>
            Não existe “a média do tribunal”, e o DrSec não tenta construir uma. Cada gabinete
            recebe o cérebro do próprio relator: acervo dele, critério dele, jeito dele de
            escrever. Um cérebro só é liberado depois que o acervo foi coletado inteiro —
            justamente para nunca acontecer de alguém consultar e receber zero precedentes.
          </p>
          <p>
            O de <strong>{a.acervo.relator}</strong> está pronto: {mil(a.acervo.decisoes)}{' '}
            decisões lidas, indexadas e medidas. É o cérebro que produziu tudo o que você acabou
            de ver nesta página.
          </p>
        </div>
      </section>

      <footer className="apr-rodape apr-largura">
        <span>
          DrSec · acervo de {mil(a.acervo.decisoes)} decisões · taxa de reforma real{' '}
          {pct(a.acervo.taxa_reforma, 1)} · dados públicos do TJSC e do Datajud/CNJ. As decisões
          são públicas; as suas consultas não.
        </span>
        <button className="apr-sair" onClick={() => sair.mutate()}>
          sair da apresentação
        </button>
      </footer>
    </div>
  )
}
