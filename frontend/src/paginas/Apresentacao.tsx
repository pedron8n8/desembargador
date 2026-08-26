import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { del, get, post } from '../api'
import { ArvoreAoVivo } from '../comp/ArvoreAoVivo'
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
  grafo: DadosGrafo
  confronto: DadosConfronto
}

const pct = (v: number, casas = 0) => `${(100 * v).toFixed(casas)}%`
const mil = (n: number) => n.toLocaleString('pt-BR')

/** O que cada nó do grafo faz, em uma linha. Sem isto a tabela do rastro vira
 *  uma lista de nomes de modelo, que não diz nada a quem está assistindo. */
const PAPEL: Record<string, string> = {
  triagem: 'lê a peça e extrai classe, matéria, tese e termos de busca',
  triar: 'lê os candidatos do rerank e dá nota de analogia a cada um',
  redigir: 'escreve a minuta ancorada nos precedentes aprovados',
  revisar: 'critica a minuta; roda em fornecedor diferente do redator',
  juiz_efetivo: 'dá nota à minuta; fornecedor diferente de todos os anteriores',
}

/* ----------------------------------------------------------------- cinema */

/** Os elementos que entram por rolagem. A mesma lista mora no CSS; aqui ela só
 *  serve ao caminho de trás (navegador sem animation-timeline). */
const REVELAR = '.apr-capa h1, .apr-capa .apr-dek, .apr-numero, .apr-cab, '
  + '.apr-aviso, .apr-confronto, .apr-cartao, .apr-tabela, .apr-grafo, '
  + '.apr-dica, .apr-descartados'

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
          <span className="apr-marca">Segundo Cérebro</span>
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
  const lidos = data.grafo.nos.filter((n) => n.tipo === 'precedente')
  const aprovados = lidos.filter((n) => n.aprovado)
  const reprovados = lidos.filter((n) => !n.aprovado)

  return (
    <div className="apr">
      <Formas />
      <div className="apr-progresso" aria-hidden="true" />

      {/* ---------------------------------------------------------- capa */}
      <header className="apr-capa apr-largura">
        <span className="apr-marca">Segundo Cérebro · {a.acervo.relator} · TJSC</span>
        <h1>O sistema leu tudo o que o desembargador já julgou, e escreve como ele.</h1>
        <p className="apr-dek">
          Você cola o processo. Em {a.execucao.segundos} segundos voltam o prognóstico, os
          precedentes que o embasam com o peso de cada um, e a minuta no estilo do relator.
          Quando os dados não bastam, nenhum percentual é emitido.
        </p>
        <div className="apr-numeros">
          <div className="apr-numero">
            <Conta v={a.acervo.decisoes} fmt={(n) => mil(Math.round(n))} />
            <span>decisões do relator no acervo</span>
          </div>
          <div className="apr-numero">
            <Conta v={a.execucao.segundos} fmt={(n) => `${Math.round(n)}s`} />
            <span>para produzir a decisão desta página</span>
          </div>
          <div className="apr-numero">
            <Conta v={a.execucao.aprovados}
              fmt={(n) => `${Math.round(n)} de ${a.execucao.candidatos}`} />
            <span>precedentes aprovados, todos com link para o acórdão público</span>
          </div>
          <div className="apr-numero">
            <Conta v={a.prognostico.p} fmt={(n) => pct(n)} />
            <span>de chance de reforma prevista. O acórdão reformou.</span>
          </div>
        </div>
      </header>

      {/* ------------------------------------------------------ confronto */}
      <section className="apr-secao apr-largura">
        <div className="apr-cena" aria-hidden="true" />
        <div className="apr-cab">
          <span className="apr-etapa">01 · O CONFRONTO</span>
          <h2>A decisão real e a decisão da máquina, lado a lado</h2>
          <p>
            Processo <strong>{c.caso.numero}</strong>, {c.caso.materia}. Julgado em{' '}
            {c.caso.julgado_em} pela {c.caso.orgao}. O sistema recebeu os autos no estado da
            véspera do julgamento e redigiu a própria decisão, sem acesso ao acórdão.
          </p>
        </div>

        <div className="apr-aviso" style={{ marginBottom: '2rem' }}>
          <span className="rot">Como este teste foi montado</span>
          <p>
            O que entrou no sistema foi o <strong>relatório do próprio acórdão</strong>: a síntese
            que o tribunal faz da decisão recorrida e das razões recursais, cortada{' '}
            <strong>antes do voto</strong>. Nenhuma linha do desfecho entrou. A decisão real
            também <strong>saiu do índice</strong> antes da consulta: sem isso o sistema
            encontraria a resposta pronta. A aba “O que foi entregue ao sistema” reproduz o
            arquivo inteiro.
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
          Os dispositivos saem do <strong>mesmo extrator que indexa o acervo</strong>, e
          a lista dos que os precedentes aprovados invocam vai dentro do prompt do
          redator — que é instruído a não citar artigo fora dela. O sistema não guarda o
          texto de lei nenhuma: ele sabe em que artigos as decisões reais desta câmara
          se apoiam nesta matéria, e é só isso que afirma.{' '}
          {a.base_legal.linhas.some((l) => l.no_real && !l.na_minuta) && (
            <>
              Repare na linha que não bate: o desembargador invocou um dispositivo que a
              minuta não citou, embora ele estivesse disponível nos precedentes
              entregues. Está aqui porque esconder seria vitrine.
            </>
          )}
        </p>
      </section>

      {/* ---------------------------------------------------------- grafo */}
      <section className="apr-secao apr-largura">
        <div className="apr-cena" aria-hidden="true" />
        <div className="apr-cab">
          <span className="apr-etapa">02 · O CÉREBRO</span>
          <h2>O caminho até essa decisão. Clique em qualquer nó.</h2>
          <p>
            Mapa da consulta que produziu a decisão acima. À esquerda, as etapas do
            processamento. Em órbita, <strong>os {data.grafo.dado.triar.lidos} acórdãos
            lidos</strong> (e não apenas os {data.grafo.dado.triar.aprovados} aprovados), com
            as âncoras que citam. A distância até o centro é a nota de analogia: quanto mais
            longe, menos análogo. Passe o mouse para acender a vizinhança, clique para abrir o
            dado real. Cada reprovado traz o motivo, na frase escrita pelo próprio modelo.
          </p>
        </div>
        <GrafoCerebro g={data.grafo} />
        <p className="apr-dica">
          Aprovados e reprovados, todos com link para o inteiro teor no portal do TJSC.
          Os losangos são <strong>dispositivos legais</strong> invocados por mais de um
          dos precedentes que embasaram a minuta: lei não é precedente, é o texto em que
          o precedente se apoia, e por isso tem nó e forma próprios.
        </p>
      </section>

      {/* -------------------------------------------------------- a árvore */}
      <section className="apr-secao apr-largura">
        <div className="apr-cena" aria-hidden="true" />
        <div className="apr-cab">
          <span className="apr-etapa">03 · A ÁRVORE, RODANDO</span>
          <h2>O mesmo cérebro, agora acontecendo — um nó de cada vez</h2>
          <p>
            O mapa acima está parado, para ser explorado. Este é o mesmo cérebro em
            execução, na ordem real: a peça entra, a triagem interpreta, a busca
            devolve {data.grafo.dado.bm80.n}, o rerank corta para{' '}
            {data.grafo.dado.triar.lidos}, e então <strong>cada um dos{' '}
            {data.grafo.dado.triar.lidos} acende com a sua nota de analogia</strong> até
            sobrarem {data.grafo.dado.triar.aprovados}. Os nós não nascem do nada: a
            árvore inteira está na tela desde o começo, apagada, porque o tamanho do
            funil é metade do que há para ver.
          </p>
        </div>
        <ArvoreAoVivo g={data.grafo} />
      </section>

      {/* --------------------------------------------------------- a conta */}
      <section className="apr-secao apr-largura">
        <div className="apr-cena" aria-hidden="true" />
        <div className="apr-cab">
          <span className="apr-etapa">04 · A CONTA</span>
          <h2>O número não é um palpite do modelo. É esta aritmética.</h2>
          <p>
            Nenhum modelo de linguagem participa desta etapa. São{' '}
            {a.pesos.precedentes.length} precedentes virando um peso cada, dois
            estimadores independentes, uma correção de escala e um portão que cala o
            sistema quando a margem não é folgada. A conta abaixo se monta sozinha, na
            ordem em que o sistema a faz — e fecha exatamente no número que o relatório
            imprimiu.
          </p>
        </div>
        <ContaAoVivo p={a.pesos} />
      </section>

      {/* --------------------------------------------------------- pesos */}
      <section className="apr-secao apr-largura">
        <div className="apr-cena" aria-hidden="true" />
        <div className="apr-cab">
          <span className="apr-etapa">05 · OS PESOS</span>
          <h2>O peso de cada precedente, com a conta aberta</h2>
          <p>
            A busca por palavra só vê texto: para ela, um acórdão de 2011 já superado empata com
            um de 2025 ancorado em tema repetitivo. Os fatores abaixo corrigem isso. Nenhum cria
            relevância do zero: modulam a que a busca já mediu.
          </p>
        </div>
        <div className="apr-tabela">
          <table>
            <thead>
              <tr>
                <th>Precedente</th>
                <th className="num">Ano</th>
                <th>Âncora</th>
                <th className="num">Analogia</th>
                <th>A conta</th>
                <th className="num">Peso</th>
              </tr>
            </thead>
            <tbody>
              {aprovados.map((n) => (
                <tr key={n.id}>
                  <td>{n.rotulo}</td>
                  <td className="num">{n.ano}</td>
                  <td>{n.ficha?.split('|')[0]?.replace('âncora', '').trim()}</td>
                  <td className="num">{n.nota}/5</td>
                  <td style={{ fontSize: '0.75rem', color: 'var(--tinta-3)' }}>
                    {n.conta?.replace(' → ', ' = ')}
                  </td>
                  <td className="num destaque">{n.fator?.toFixed(2)}×</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Os que não passaram ficam fechados por padrão, mas ficam. Uma demo
            que só mostra o que deu certo é uma vitrine; o número do resumo sai
            da contagem, não do teclado. */}
        <details className="apr-descartados">
          <summary>
            os {reprovados.length} lidos e não usados, com nota e motivo
          </summary>
          <div className="apr-tabela">
            <table>
              <thead>
                <tr>
                  <th>Acórdão</th>
                  <th className="num">Ano</th>
                  <th className="num">Analogia</th>
                  <th>Por que não passou</th>
                  <th>O rerank que o trouxe até a leitura</th>
                </tr>
              </thead>
              <tbody>
                {reprovados.map((n) => (
                  <tr key={n.id}>
                    <td>{n.rotulo}</td>
                    <td className="num">{n.ano}</td>
                    <td className="num">{n.nota}/5</td>
                    <td style={{ color: 'var(--tinta-2)' }}>
                      {n.detalhe?.split('  Reprovado:')[0]}
                    </td>
                    <td style={{ fontSize: '0.75rem', color: 'var(--tinta-3)' }}>
                      {n.conta?.replace(' → ', ' = ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="apr-dica">
            Quem reprova é a <strong>nota de analogia</strong>, não a conta de rerank. O
            rerank definiu quais {data.grafo.dado.triar.lidos} dos{' '}
            {data.grafo.dado.bm80.n} do BM25 chegariam à leitura, e desempata precedentes de
            mesma nota.
          </p>
        </details>

        <p className="apr-dica">
          Meia-vida de 6 anos na recência · âncora vinculante vale +35% · decisão não unânime
          perde 15% · transitou em julgado ganha +10%. No acervo inteiro:{' '}
          {pct(a.acervo.ancora.vinculante / a.acervo.decisoes, 1)} das decisões se apoiam em
          autoridade vinculante e {pct(a.acervo.com_efeito / a.acervo.decisoes, 1)} têm efeito
          posterior rastreado pelo Datajud.
        </p>
      </section>

      {/* --------------------------------------------------------- prova */}
      <section className="apr-secao apr-largura">
        <div className="apr-cena" aria-hidden="true" />
        <div className="apr-cab">
          <span className="apr-etapa">06 · A PROVA</span>
          <h2>Um caso não prova nada. A medição usou 400.</h2>
          <p>
            O sistema sorteia decisões já julgadas, esconde cada uma do índice e recebe só a parte
            que descreve o caso, filtrada de qualquer trecho que revele o desfecho. Depois compara
            a previsão com o que o desembargador decidiu. Nenhum modelo de linguagem participa
            dessa medição: ela isola o núcleo estatístico do sistema.
          </p>
        </div>
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
          <span className="apr-etapa">07 · O QUE O SISTEMA NÃO FAZ</span>
          <h2>As recusas custaram mais para construir do que as respostas</h2>
        </div>
        <div className="apr-cartoes">
          <div className="apr-cartao">
            <h3>Sem margem, não decide</h3>
            <p>
              Quando os dois estimadores divergem, ou a estimativa fica perto do meio, sai o
              dossiê de evidências completo e nenhum percentual. Em quatro processos reais, a
              recusa evitou um erro e custou dois acertos.
            </p>
          </div>
          <div className="apr-cartao">
            <h3>Percentual não sai em modo tese</h3>
            <p>
              Quando o pedido é “quero reformar”, o sistema separa apenas o material que sustenta
              esse lado. Contar resultado ali mediria a sua escolha. Um teste automatizado quebra
              o build se algum número escapar.
            </p>
          </div>
          <div className="apr-cartao">
            <h3>Outros tribunais ficam fora</h3>
            <p>
              O acervo é 100% TJSC, de um relator só. Dá para afirmar que um tema repetitivo do
              STJ vincula o país, mas não o que o TJSP faz com ele.
            </p>
          </div>
          <div className="apr-cartao">
            <h3>Mostra onde a própria tese é frágil</h3>
            <p>
              Toda minuta fecha apontando, do material recuperado, o que enfraquece o argumento:
              precedente não unânime, âncora apenas estadual, fato que afasta a analogia.
            </p>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- rastro */}
      <section className="apr-secao apr-largura">
        <div className="apr-cena" aria-hidden="true" />
        <div className="apr-cab">
          <span className="apr-etapa">08 · O RASTRO</span>
          <h2>Cinco modelos diferentes, e nenhum julga o próprio trabalho</h2>
          <p>
            Rastro da consulta que gerou a decisão do topo. O <strong>revisor</strong> roda em
            fornecedor diferente do redator, e o <strong>juiz</strong> em um terceiro. Modelos da
            mesma família tendem a concordar entre si, o que anularia a revisão.
          </p>
        </div>
        <div className="apr-tabela">
          <table>
            <thead>
              <tr>
                <th>Etapa</th>
                <th>O que faz</th>
                <th>Modelo</th>
                <th className="num">tokens lidos / escritos</th>
              </tr>
            </thead>
            <tbody>
              {a.execucao.etapas.map((e) => (
                <tr key={e.no}>
                  <td>{e.no}</td>
                  <td style={{ color: 'var(--tinta-3)' }}>{PAPEL[e.no] ?? '—'}</td>
                  <td style={{ color: 'var(--tinta-3)' }}>{e.modelo}</td>
                  <td className="num">{mil(e.entrada)} / {mil(e.saida)}</td>
                </tr>
              ))}
              <tr>
                <td><strong>total</strong></td>
                <td />
                <td />
                <td className="num destaque">{a.execucao.segundos} segundos</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="apr-dica">
          O juiz automático deu <strong>{a.juiz.nota} de 5</strong> e apontou o defeito:
          “{a.juiz.critica}”. A crítica sai impressa no relatório da consulta.
        </p>
      </section>

      <footer className="apr-rodape apr-largura">
        <span>
          Acervo de {mil(a.acervo.decisoes)} decisões · taxa de reforma real{' '}
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
