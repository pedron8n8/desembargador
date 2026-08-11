import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { ErroApi, get, req, type ListaCerebros } from '../api'

/**
 * Tela do superadmin: quais desembargadores ficam disponíveis para julgar.
 *
 * O que ela decide não é cosmético. Um cérebro ativo aparece no seletor de
 * todo mundo e pode receber consulta paga; um inativo não existe para o resto
 * do sistema. Por isso o servidor recusa ativar acervo sem índice, e por isso
 * esta tela mostra o tamanho do acervo ao lado do botão.
 */
export function Cerebros() {
  const qc = useQueryClient()
  const [erro, setErro] = useState('')
  const { data } = useQuery({
    queryKey: ['cerebros', 'todos'],
    queryFn: () => get<ListaCerebros>('/api/cerebros?todos=1'),
  })

  const alternar = useMutation({
    mutationFn: ({ slug, ativo }: { slug: string; ativo: boolean }) =>
      req<{ slug: string }>(`/api/cerebros/${slug}`, {
        method: 'PATCH',
        body: JSON.stringify({ ativo }),
      }),
    onSuccess: () => {
      setErro('')
      // as duas listas: a de todos (esta tela) e a dos ativos (o seletor)
      qc.invalidateQueries({ queryKey: ['cerebros'] })
    },
    onError: (e) => setErro(e instanceof ErroApi ? e.message : String(e)),
  })

  if (!data) return <p className="vazio">carregando…</p>

  return (
    <>
      <header className="cabecalho">
        <div>
          <h1>Cérebros</h1>
          <p className="sub">
            De quem o escritório tem um segundo cérebro, e quem está disponível para julgar
          </p>
        </div>
      </header>

      {erro && <p className="aviso forte">{erro}</p>}

      <table>
        <thead>
          <tr>
            <th>Quem</th>
            <th className="num">Decisões</th>
            <th className="num">Mérito</th>
            <th>Prognóstico</th>
            <th>Disponível</th>
          </tr>
        </thead>
        <tbody>
          {data.itens.map((c) => (
            <tr key={c.slug}>
              <td>
                <strong>
                  {c.titulo} {c.nome}
                </strong>
                <br />
                <span className="prec-meta">
                  {c.tribunal} · {c.slug}
                  {c.slug === data.padrao ? ' · padrão' : ''}
                </span>
              </td>
              <td className="num">{c.tem_indice ? c.n_decisoes.toLocaleString('pt-BR') : '—'}</td>
              <td className="num">{c.tem_indice ? c.n_merito.toLocaleString('pt-BR') : '—'}</td>
              <td>
                {!c.tem_indice ? (
                  <span className="prec-meta">sem índice</span>
                ) : !c.crava ? (
                  <span title={`mínimo de ${data.minimo_para_cravar} decisões de mérito`}>
                    recusado — acervo pequeno
                  </span>
                ) : c.calibrado ? (
                  'calibrado'
                ) : (
                  'sem calibrador (o número ordena, não é probabilidade)'
                )}
              </td>
              <td>
                <button
                  type="button"
                  disabled={alternar.isPending || (!c.ativo && !c.tem_indice)}
                  onClick={() => alternar.mutate({ slug: c.slug, ativo: !c.ativo })}
                >
                  {c.ativo ? 'ativo — desligar' : 'inativo — ligar'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="nota">
        <h2>Como entra um cérebro novo</h2>
        <p>
          Um cérebro é o acervo de um relator: as decisões dele, raspadas do portal, indexadas e
          usadas como precedente e como estilo. Nasce inativo porque acervo vazio responderia com
          zero precedente e pareceria defeito do sistema.
        </p>
        <ol>
          <li>
            declare o cérebro em <code>cerebros.json</code> (nome exatamente como o portal grafa)
          </li>
          <li>
            <code>python -m src.main --cerebro SLUG</code> — a coleta
          </li>
          <li>
            <code>python -m src.rag.indexar --cerebro SLUG</code>
          </li>
          <li>
            <code>python -m src.rag.floresta --treinar --cerebro SLUG</code> e{' '}
            <code>python -m src.rag.calibrar --ajustar --cerebro SLUG</code> — os dois podem se
            recusar se o acervo for pequeno, e recusar é o comportamento certo
          </li>
          <li>ligue aqui</li>
        </ol>
        <p className="prec-meta">
          Abaixo de {data.minimo_para_cravar.toLocaleString('pt-BR')} decisões de mérito o sistema
          entrega os precedentes mas se recusa a dar percentual: sem histórico não há o que
          calibrar, e um número ali seria palpite com cara de medição.
        </p>
      </section>
    </>
  )
}
