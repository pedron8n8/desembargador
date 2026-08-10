import { useQuery } from '@tanstack/react-query'

import { get, type Config } from '../api'
import { qs, useCerebro, useCerebroEfetivo } from '../cerebro'

type Topologia = {
  nos: { id: string }[]
  arestas: { de: string; para: string; condicional: boolean }[]
}

export function Modelo() {
  const [slug] = useCerebro()
  const [efetivo] = useCerebroEfetivo()
  const { data: cfg } = useQuery({
    queryKey: ['config', efetivo],
    queryFn: () => get<Config>(`/api/config${qs(slug)}`),
  })
  const { data: topo } = useQuery({
    queryKey: ['grafo'],
    queryFn: () => get<Topologia>('/api/grafo'),
    staleTime: Infinity,
  })
  const { data: boost } = useQuery({
    queryKey: ['boost', efetivo],
    queryFn: () => get<any>(`/api/feedback/boost${qs(slug)}`),
  })
  const { data: docs } = useQuery({
    queryKey: ['est-documentos', efetivo],
    queryFn: () => get<any>(`/api/estatisticas/documentos${qs(slug)}`),
  })

  if (!cfg) return <p className="vazio">carregando…</p>

  const POR_QUE: Record<string, string> = {
    triagem: 'extrai o JSON do caso: classe, matéria, tese, termos de busca',
    triar: 'lê ~40 ementas e devolve só a nota de analogia de cada uma',
    redigir: 'escreve a minuta no estilo do relator',
    revisar: 'de propósito de outro fornecedor que o redator — crítica independente é o ponto do arranjo',
    juiz: 'o instrumento de medida; fornecedor distinto de todos os outros',
    juiz_reserva: 'entra quando o redator julgado é do mesmo fornecedor (autopreferência)',
    conversa: 'o turno de acompanhamento; não roda o grafo, lê o checkpoint',
  }

  return (
    <>
      <header className="cabecalho">
        <div>
          <h1>O modelo</h1>
          <p className="sub">O que está carregado neste processo, não o que está no arquivo</p>
        </div>
      </header>

      <p className="aviso" style={{ marginBottom: 'var(--e8)' }}>
        Não há modelo de linguagem treinado sobre o acervo. O que existe são: uma busca BM25
        sobre índice FTS5, uma Random Forest treinada em decisões antigas, uma regressão
        isotônica para corrigir a escala, e cinco modelos de linguagem alugados por chamada —
        cada um num nó diferente do grafo. Trocar o <code>config_rag.json</code> com o servidor de
        pé não muda nada até reiniciar; é por isso que esta página mostra o que está em memória.
      </p>

      <section className="secao">
        <h2>Um modelo por nó</h2>
        <div className="tabela-rolavel">
          <table>
            <thead>
              <tr>
                <th>nó</th>
                <th>modelo</th>
                <th className="num">temp.</th>
                <th className="num">teto de saída</th>
                <th>por quê</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(cfg.modelos).map(([no, m]) => (
                <tr key={no}>
                  <td>{no}</td>
                  <td className="mono">{m}</td>
                  <td className="num">{cfg.temperatura[no] ?? '—'}</td>
                  <td className="num">
                    {cfg.max_tokens[no]?.toLocaleString('pt-BR') ?? '—'}
                  </td>
                  <td style={{ color: 'var(--tinta-2)' }}>{POR_QUE[no] ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {topo && (
        <section className="secao">
          <h2>A topologia do grafo</h2>
          <p className="nota">
            Lida do <code>construir().get_graph()</code> do servidor. Os dois ciclos —{' '}
            <b>triar → recuperar</b> quando faltam precedentes e <b>revisar → redigir</b> quando o
            revisor reprova — são o que justifica LangGraph em vez de um script linear.
          </p>
          <div className="tabela-rolavel">
            <table style={{ maxWidth: 520 }}>
              <thead>
                <tr>
                  <th>de</th>
                  <th>para</th>
                  <th>tipo</th>
                </tr>
              </thead>
              <tbody>
                {topo.arestas.map((a, i) => (
                  <tr key={i}>
                    <td className="mono">{a.de}</td>
                    <td className="mono">{a.para}</td>
                    <td>{a.condicional ? 'condicional' : 'direta'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="secao">
        <h2>Os dois estimadores</h2>
        <div className="faixa">
          <div className="medida">
            <dt>Random Forest</dt>
            <dd style={{ fontSize: 'var(--t-md)' }}>
              {cfg.floresta.disponivel ? 'carregada' : 'ausente'}
            </dd>
          </div>
          {cfg.floresta.disponivel && (
            <>
              <div className="medida">
                <dt>treinada até</dt>
                <dd>{cfg.floresta.treinado_ate}</dd>
              </div>
              <div className="medida">
                <dt>decisões no treino</dt>
                <dd>{cfg.floresta.n_treino?.toLocaleString('pt-BR')}</dd>
              </div>
            </>
          )}
          <div className="medida">
            <dt>peso do k-NN no conjunto</dt>
            <dd>{cfg.floresta.peso_knn}</dd>
          </div>
          <div className="medida">
            <dt>calibrador</dt>
            <dd style={{ fontSize: 'var(--t-md)' }}>{cfg.calibrado ? 'ajustado' : 'ausente'}</dd>
          </div>
        </div>
        <p className="nota" style={{ marginTop: 'var(--e4)' }}>
          Sozinha a floresta é fraca (precisão 39%), mas é quase cega para o lado contrário
          (recall 95%) — o oposto exato do k-NN. Juntos, o F1 sobe de 58% para 70%. Quando os
          dois discordam, isso não é defeito: é o sinal de que o caso está na fronteira.
        </p>
      </section>

      <section className="secao">
        <h2>Quando o sistema se recusa a responder</h2>
        <div className="tabela-rolavel">
          <table style={{ maxWidth: 620 }}>
            <thead>
              <tr>
                <th>portão</th>
                <th className="num">valor</th>
                <th>o que reprova</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>margem mínima</td>
                <td className="num">{cfg.confianca.corte_margem}</td>
                <td>
                  distância do meio na escala calibrada — é o portão principal, os outros só
                  rebaixam
                </td>
              </tr>
              <tr>
                <td>precedentes mínimos</td>
                <td className="num">{cfg.confianca.min_precedentes}</td>
                <td>abaixo disso não há amostra para nada</td>
              </tr>
              <tr>
                <td>concordância mínima</td>
                <td className="num">{cfg.confianca.concordancia_minima}</td>
                <td>fração do peso no lado majoritário</td>
              </tr>
              <tr>
                <td>desacordo máximo</td>
                <td className="num">{cfg.confianca.desacordo_maximo}</td>
                <td>distância entre k-NN e floresta</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="nota">
          Com margem de {cfg.confianca.corte_margem} o sistema responde em ~38% das consultas e
          acerta 96,7%; respondendo sempre, acertaria 80,2%. O custo de chegar a 96% é não
          responder em 62% das vezes — foi uma escolha, e é coerente com pôr um dossiê de
          evidências na frente de quem decide, em vez de um oráculo.
        </p>
      </section>

      <section className="secao">
        <h2>Recuperação</h2>
        <div className="tabela-rolavel">
          <table style={{ maxWidth: 520 }}>
            <tbody>
              {Object.entries(cfg.busca).map(([k, v]) => (
                <tr key={k}>
                  <td>{k.replace(/_/g, ' ')}</td>
                  <td className="num">{String(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {docs && (
        <section className="secao">
          <h2>O material</h2>
          <div className="faixa">
            <div className="medida">
              <dt>decisões indexadas</dt>
              <dd>{docs.indexadas.toLocaleString('pt-BR')}</dd>
            </div>
            <div className="medida">
              <dt>com inteiro teor</dt>
              <dd>{docs.com_inteiro_teor.toLocaleString('pt-BR')}</dd>
            </div>
            <div className="medida">
              <dt>documentos .rtf em disco</dt>
              <dd>{(docs.rtf ?? 0).toLocaleString('pt-BR')}</dd>
            </div>
          </div>
          {docs.por_fonte && (
            <table style={{ maxWidth: 420, marginTop: 'var(--e4)' }}>
              <thead>
                <tr>
                  <th>fonte</th>
                  <th className="num">decisões</th>
                </tr>
              </thead>
              <tbody>
                {docs.por_fonte.map((f: any) => (
                  <tr key={f.fonte}>
                    <td>{f.fonte}</td>
                    <td className="num">{f.n.toLocaleString('pt-BR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      <section className="secao">
        <h2>O que o seu feedback está fazendo</h2>
        <p className="nota">
          Marcar “serviu”/“não serviu” move o precedente nas buscas seguintes, no máximo ±
          {((boost?.teto ?? 0.3) * 100).toFixed(0)}% ({((boost?.por_voto ?? 0.1) * 100).toFixed(0)}%
          por voto). O teto é de propósito: o BM25 foi calibrado em 400 casos cegos, e deixar o
          feedback mexer demais joga fora essa calibração em troca de meia dúzia de cliques.
        </p>
        {boost?.itens?.length ? (
          <div className="tabela-rolavel">
            <table>
              <thead>
                <tr>
                  <th>processo</th>
                  <th>classe</th>
                  <th className="num">ano</th>
                  <th>resultado</th>
                  <th className="num">fator</th>
                </tr>
              </thead>
              <tbody>
                {boost.itens.map((x: any) => (
                  <tr key={x.id}>
                    <td className="mono">{x.numero}</td>
                    <td>{x.classe}</td>
                    <td className="num">{x.ano}</td>
                    <td>{x.resultado}</td>
                    <td className="num" style={{ color: x.fator >= 1 ? 'var(--selo)' : 'var(--alerta)' }}>
                      {x.fator.toFixed(2)}×
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="vazio">
            Nenhum precedente marcado ainda — o ranking está exatamente como o BM25 e a ficha de
            procedência o deixaram.
          </p>
        )}
      </section>
    </>
  )
}
