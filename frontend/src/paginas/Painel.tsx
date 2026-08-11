import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { get, type ItemLista } from '../api'
import { dataBR, pct, usd } from '../hooks'

const RODANDO = new Set(['fila', 'rodando'])

function EstadoConsulta({ i }: { i: ItemLista }) {
  if (RODANDO.has(i.estado)) return <span className="selo acento">rodando</span>
  if (i.estado === 'interrompido') return <span className="selo alerta">interrompida</span>
  if (i.estado === 'erro') return <span className="selo alerta">erro</span>
  if (i.decide === false) return <span className="selo">não decidiu</span>
  if (i.probabilidade_pct != null)
    return (
      <span className="selo acento">
        {pct(i.probabilidade_pct)} reforma
      </span>
    )
  return <span className="selo">—</span>
}

export function Painel() {
  const { data, isLoading } = useQuery({
    queryKey: ['consultas'],
    queryFn: () => get<{ total: number; itens: ItemLista[] }>('/api/consultas'),
    // enquanto houver consulta rodando, a lista se atualiza sozinha
    refetchInterval: (q) =>
      (q.state.data?.itens ?? []).some((i) => RODANDO.has(i.estado)) ? 4000 : false,
  })
  const { data: custos } = useQuery({
    queryKey: ['custos'],
    queryFn: () => get<{ total_usd: number; por_dia: { dia: string; usd: number }[] }>(
      '/api/estatisticas/custos',
    ),
  })

  const itens = data?.itens ?? []
  const mes = (custos?.por_dia ?? [])
    .filter((d) => d.dia >= new Date().toISOString().slice(0, 7))
    .reduce((s, d) => s + d.usd, 0)

  return (
    <>
      <header className="cabecalho">
        <div>
          <h1>Consultas</h1>
          <p className="sub">
            {data ? `${data.total} no total` : 'carregando…'}
          </p>
        </div>
        <Link className="botao" to="/consulta/nova">
          Nova consulta
        </Link>
      </header>

      <div className="faixa" style={{ marginBottom: 'var(--e8)' }}>
        <div className="medida">
          <dt>gasto neste mês</dt>
          <dd>{usd(mes)}</dd>
        </div>
        <div className="medida">
          <dt>gasto total</dt>
          <dd>{usd(custos?.total_usd)}</dd>
        </div>
        <div className="medida">
          <dt>avaliadas por você</dt>
          <dd>
            {itens.filter((i) => i.nota_humano != null).length}
            <small> de {itens.length}</small>
          </dd>
        </div>
      </div>

      {isLoading && <p className="vazio">carregando…</p>}

      {!isLoading && itens.length === 0 && (
        <p className="vazio">
          Nenhuma consulta ainda. <Link to="/consulta/nova">Comece por uma.</Link>
        </p>
      )}

      {itens.length > 0 && (
        <div className="tabela-rolavel">
          <table>
            <thead>
              <tr>
                <th>quando</th>
                <th>quem julgou</th>
                <th>caso</th>
                <th>prognóstico</th>
                <th className="num">você</th>
                <th className="num">juiz</th>
                <th className="num">US$</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((i) => (
                <tr key={i.thread}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <Link to={`/consulta/${i.thread}`}>{dataBR(i.criado_em)}</Link>
                    <div style={{ color: 'var(--tinta-3)', fontSize: 'var(--t-xs)' }}>
                      {(i.criado_em ?? '').slice(11, 16)}
                      {i.da_cli && ' · terminal'}
                    </div>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {i.cerebro_nome}
                    {i.comparacao && (
                      <div style={{ fontSize: 'var(--t-xs)' }}>
                        <Link to={`/comparacao/${i.comparacao}`}>ver a comparação</Link>
                      </div>
                    )}
                  </td>
                  <td style={{ maxWidth: 420 }}>
                    <Link to={`/consulta/${i.thread}`} style={{ color: 'var(--tinta)' }}>
                      {i.resumo || <span style={{ color: 'var(--tinta-3)' }}>(sem texto)</span>}
                    </Link>
                    {i.erro && (
                      <div style={{ color: 'var(--alerta)', fontSize: 'var(--t-xs)' }}>{i.erro}</div>
                    )}
                  </td>
                  <td>
                    <EstadoConsulta i={i} />
                  </td>
                  <td className="num">{i.nota_humano?.toFixed(1) ?? '—'}</td>
                  <td className="num">{i.nota_juiz?.toFixed(1) ?? '—'}</td>
                  <td className="num">{i.custo_usd != null ? i.custo_usd.toFixed(4) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
