import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { get, type ItemListaComparacao } from '../api'
import { dataBR } from '../hooks'

const RODANDO = new Set(['fila', 'rodando'])

/**
 * Todas as comparações já rodadas.
 *
 * O Δ vem do servidor, não daqui: subtrair um percentual calibrado de um cru —
 * ou de um lado que se recusou a cravar — fabrica precisão que ninguém mediu.
 * A regra vive em `_comparavel` (api/app.py) e vale igual nesta lista e na tela
 * da comparação.
 */
function EstadoComparacao({ i }: { i: ItemListaComparacao }) {
  if (i.estados.some((e) => RODANDO.has(e))) return <span className="selo acento">rodando</span>
  if (i.estados.some((e) => e === 'erro' || e === 'interrompido'))
    return <span className="selo alerta">parou</span>
  if (i.delta_pp === null)
    return <span className="selo">sem Δ — {i.por_que_sem_delta}</span>
  return <span className="selo acento">Δ {i.delta_pp} pp</span>
}

export function Comparacoes() {
  const { data, isLoading } = useQuery({
    queryKey: ['comparacoes'],
    queryFn: () => get<{ itens: ItemListaComparacao[] }>('/api/comparacoes'),
    refetchInterval: (q) =>
      (q.state.data?.itens ?? []).some((i) => i.estados.some((e) => RODANDO.has(e)))
        ? 4000
        : false,
  })

  const itens = data?.itens ?? []

  return (
    <>
      <header className="cabecalho">
        <div>
          <h1>Comparações</h1>
          <p className="sub">
            {data ? `${itens.length} no total` : 'carregando…'} · a mesma peça lida por mais
            de um acervo
          </p>
        </div>
        <Link className="botao" to="/consulta/nova">
          Nova consulta
        </Link>
      </header>

      {isLoading && <p className="vazio">carregando…</p>}

      {!isLoading && itens.length === 0 && (
        <p className="vazio">
          Nenhuma comparação ainda. Em <Link to="/consulta/nova">nova consulta</Link>, marque
          um segundo cérebro em “segundo ponto de vista”.
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
                <th>resultado</th>
                <th className="num">US$</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((i) => (
                <tr key={i.comparacao}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <Link to={`/comparacao/${i.comparacao}`}>{dataBR(i.criado_em)}</Link>
                    <div style={{ color: 'var(--tinta-3)', fontSize: 'var(--t-xs)' }}>
                      {(i.criado_em ?? '').slice(11, 16)}
                    </div>
                  </td>
                  <td>{i.cerebros.join(' × ')}</td>
                  <td style={{ maxWidth: 420 }}>
                    <Link to={`/comparacao/${i.comparacao}`} style={{ color: 'var(--tinta)' }}>
                      {i.resumo || <span style={{ color: 'var(--tinta-3)' }}>(sem texto)</span>}
                    </Link>
                  </td>
                  <td>
                    <EstadoComparacao i={i} />
                  </td>
                  <td className="num">{i.custo_usd ? i.custo_usd.toFixed(4) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
