import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { get, type Comparacao as Cmp, type Consulta as C, type ItemComparacao } from '../api'
import { PipelineAoVivo } from '../comp/PipelineAoVivo'
import { Precedente } from '../comp/Precedente'
import { usd, useEventos } from '../hooks'

const RODANDO = new Set(['fila', 'rodando'])

/**
 * A mesma peça, lida por dois ou três acervos.
 *
 * O que esta tela entrega não é "qual cérebro acerta mais" — é ONDE eles
 * divergem: precedentes diferentes, âncoras diferentes, e às vezes desfecho
 * diferente. As colunas são independentes de propósito; uma pode estar pronta
 * enquanto a outra ainda roda (o pool tem 2 vagas, então a terceira espera).
 */
export function Comparacao() {
  const { comparacao } = useParams()
  const [aberto, setAberto] = useState(false)

  const { data, error } = useQuery({
    queryKey: ['comparacao', comparacao],
    queryFn: () => get<Cmp>(`/api/comparacoes/${comparacao}`),
    retry: false,
    // enquanto algum lado roda, a página se atualiza sozinha; cada coluna ainda
    // tem o seu SSE para o pipeline ao vivo
    refetchInterval: (q) =>
      (q.state.data as Cmp | undefined)?.itens.some((i) => RODANDO.has(i.estado)) ? 4000 : false,
  })

  if (error) return <p className="aviso forte">comparação não encontrada</p>
  if (!data) return <p className="vazio">carregando…</p>

  const prontos = data.itens.filter((i) => i.estado === 'pronto')
  const total = data.itens.reduce((s, i) => s + (i.custo_usd ?? 0), 0)

  return (
    <>
      <header className="cabecalho">
        <div>
          <h1>Dois pontos de vista</h1>
          <p className="sub">
            {data.itens.map((i) => i.cerebro_nome).join(' × ')} · a mesma peça ·{' '}
            {usd(total)}
          </p>
        </div>
      </header>

      <details open={aberto} onToggle={(e) => setAberto(e.currentTarget.open)}>
        <summary>o caso</summary>
        <pre className="caso">{data.caso}</pre>
      </details>

      <Delta c={data} />

      <div className="colunas-comparacao">
        {data.itens.map((i) => (
          <Coluna key={i.thread} item={i} />
        ))}
      </div>

      {prontos.length === data.itens.length && <Ancoras itens={data.itens} />}
    </>
  )
}

/**
 * O Δ só aparece quando os dois lados são comparáveis, e quem decide isso é o
 * servidor. Subtrair 42% de 55% quando um dos dois se recusou a cravar — ou
 * quando um é calibrado e o outro cru — fabrica uma precisão que ninguém mediu.
 * É o erro mais fácil de cometer nesta tela.
 */
function Delta({ c }: { c: Cmp }) {
  if (c.delta_pp === null) {
    return (
      <p className="aviso">
        <b>Sem diferença numérica</b> — {c.por_que_sem_delta}. Compare os precedentes e o que os
        sustenta: é onde a divergência entre dois julgadores aparece de verdade.
      </p>
    )
  }
  const desfechos = new Set(c.itens.map((i) => i.resultado_provavel))
  return (
    <p className="aviso forte">
      Os dois cérebros diferem em <b>{c.delta_pp} pontos percentuais</b> na chance de reforma
      {desfechos.size > 1
        ? ' — e apontam desfechos diferentes.'
        : ' — mas apontam o mesmo desfecho.'}
    </p>
  )
}

function Coluna({ item }: { item: ItemComparacao }) {
  const rodando = RODANDO.has(item.estado)
  const vivo = useEventos(item.thread, rodando)

  // o detalhe completo só quando terminou: enquanto roda, quem informa é o SSE
  const { data: c } = useQuery({
    queryKey: ['consulta', item.thread],
    queryFn: () => get<C>(`/api/consultas/${item.thread}`),
    enabled: item.estado === 'pronto',
    retry: false,
  })

  const p = item.prognostico

  return (
    <section className="coluna-comparacao">
      <h2>
        {item.cerebro_titulo} {item.cerebro_nome}
      </h2>

      {item.estado === 'fila' && (
        <p className="vazio">
          na fila — o servidor roda duas consultas por vez, esta começa quando a outra liberar
        </p>
      )}
      {item.estado === 'rodando' && <PipelineAoVivo vivo={vivo} />}
      {(item.estado === 'erro' || item.estado === 'interrompido') && (
        <p className="aviso forte">
          {item.erro ?? 'parou'} —{' '}
          <Link to={`/consulta/${item.thread}`}>abrir e retomar de onde parou</Link>
        </p>
      )}

      {item.estado === 'pronto' && (
        <>
          {/* PROGNÓSTICO primeiro dentro da coluna? Não: mesma ordem do
              relatório — evidência antes de veredito. Ver frontend/DESIGN.md. */}
          <h3>Precedentes ({item.n_precedentes ?? 0})</h3>
          {c ? (
            c.precedentes.length ? (
              c.precedentes.map((d) => <Precedente key={d.id} p={d} cerebro={item.cerebro} />)
            ) : (
              <p className="vazio">nenhum precedente com analogia suficiente</p>
            )
          ) : (
            <p className="vazio">carregando…</p>
          )}

          <h3>Prognóstico</h3>
          {p.enviesado ? (
            <p className="aviso">
              sem prognóstico — a amostra foi filtrada pelo lado pedido
            </p>
          ) : p.faixa === 'acervo_pequeno' ? (
            <p className="aviso">
              <b>acervo pequeno demais</b> para um percentual
              {p.n_merito_acervo != null && ` (${p.n_merito_acervo} decisões de mérito)`}. Os
              precedentes acima continuam valendo.
            </p>
          ) : p.decide === false ? (
            <p className="aviso">
              <b>NÃO DECIDO</b> — {(p.confianca?.por_que ?? []).join('; ')}
            </p>
          ) : (
            <p className="numero-grande">
              {p.probabilidade_pct}% de reforma
              <span className="prec-meta">
                {' '}
                · {p.resultado_provavel}
                {!p.calibrado && ' · não calibrado: ordena, não é probabilidade'}
              </span>
            </p>
          )}

          <p className="prec-meta">
            {usd(item.custo_usd ?? 0)} ·{' '}
            <Link to={`/consulta/${item.thread}`}>
              {item.tem_minuta ? 'minuta e relatório completo' : 'relatório completo'}
            </Link>
          </p>
        </>
      )}
    </section>
  )
}

/**
 * O cruzamento que tem sentido entre dois acervos.
 *
 * NÃO se cruza por id (são bancos diferentes: o id 4712 de um não tem relação
 * com o do outro) nem por número de processo (relatores diferentes julgam
 * processos diferentes — a interseção seria quase sempre vazia). O que os dois
 * podem genuinamente ter em comum é a ÂNCORA: o mesmo tema repetitivo, a mesma
 * súmula.
 */
function Ancoras({ itens }: { itens: ItemComparacao[] }) {
  const detalhes = useQuery({
    queryKey: ['comparacao-ancoras', itens.map((i) => i.thread).join(',')],
    queryFn: async () =>
      Promise.all(itens.map((i) => get<C>(`/api/consultas/${i.thread}`))),
  })
  if (!detalhes.data) return null

  const conjuntos = detalhes.data.map((c) => new Set(c.precedentes.flatMap((p) => p.ancoras)))
  const comuns = [...(conjuntos[0] ?? [])].filter((a) => conjuntos.every((s) => s.has(a)))

  return (
    <section className="nota">
      <h2>Onde os dois se apoiam no mesmo lugar</h2>
      {comuns.length ? (
        <>
          <p>
            Âncoras citadas pelos precedentes de <b>todos</b> os cérebros:
          </p>
          <ul>
            {comuns.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </>
      ) : (
        <p>
          Nenhuma âncora em comum. Os dois chegaram onde chegaram por caminhos diferentes — o que
          é um achado sobre o caso, não uma falha da comparação.
        </p>
      )}
      <p className="prec-meta">
        Só as âncoras se comparam entre acervos. Números de processo não: relatores diferentes
        julgam processos diferentes, e os ids são de bancos distintos.
      </p>
    </section>
  )
}
