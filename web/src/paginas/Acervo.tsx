import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { get, type Precedente as P } from '../api'
import { Precedente } from '../comp/Precedente'

type Resposta = {
  total: number
  consulta_fts: string | null
  ordenado_por: string
  itens: P[]
}

export function Acervo() {
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState(params.get('q') ?? '')

  const filtros = {
    q: params.get('q') ?? '',
    classe: params.get('classe') ?? '',
    ancora: params.get('ancora') ?? '',
    resultado: params.get('resultado') ?? '',
    ano_min: params.get('ano_min') ?? '',
    pagina: Number(params.get('pagina') ?? 0),
  }

  const consulta = new URLSearchParams(
    Object.entries({ ...filtros, por_pagina: 25 }).filter(([, v]) => v !== '' && v != null) as [
      string,
      string,
    ][],
  ).toString()

  const { data, isLoading } = useQuery({
    queryKey: ['corpus', consulta],
    queryFn: () => get<Resposta>(`/api/corpus?${consulta}`),
  })
  const { data: facetas } = useQuery({
    queryKey: ['facetas'],
    queryFn: () => get<Record<string, { valor: string; n: number }[]>>('/api/corpus/facetas'),
    staleTime: Infinity,
  })
  const { data: est } = useQuery({
    queryKey: ['est-documentos'],
    queryFn: () => get<any>('/api/estatisticas/documentos'),
    staleTime: Infinity,
  })

  const trocar = (chave: string, valor: string) => {
    const p = new URLSearchParams(params)
    valor ? p.set(chave, valor) : p.delete(chave)
    if (chave !== 'pagina') p.delete('pagina')
    setParams(p)
  }

  const paginas = Math.ceil((data?.total ?? 0) / 25)

  return (
    <>
      <header className="cabecalho">
        <div>
          <h1>Acervo</h1>
          <p className="sub">
            {est
              ? `${est.indexadas.toLocaleString('pt-BR')} decisões indexadas · ${est.com_inteiro_teor.toLocaleString('pt-BR')} com inteiro teor · ${(est.rtf ?? 0).toLocaleString('pt-BR')} documentos em disco`
              : 'carregando…'}
          </p>
        </div>
      </header>

      <p className="aviso" style={{ marginBottom: 'var(--e6)' }}>
        Este é o material que o sistema usa — todas as decisões públicas do relator raspadas do
        portal do TJSC e do Datajud. Não há treino de modelo de linguagem sobre elas: a busca é
        BM25 sobre índice FTS5, e o único modelo treinado é a Random Forest, sobre as decisões
        até 2023.
      </p>

      <form
        className="nao-imprime"
        onSubmit={(e) => {
          e.preventDefault()
          trocar('q', q)
        }}
        style={{ display: 'flex', gap: 'var(--e3)', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 'var(--e6)' }}
      >
        <label className="campo" style={{ flex: '1 1 320px', marginBottom: 0 }}>
          <span>buscar na ementa e no dispositivo</span>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="prescrição intercorrente; honorários recursais"
          />
        </label>
        <button className="botao" type="submit">
          buscar
        </button>
        {(filtros.q || filtros.classe || filtros.ancora || filtros.resultado) && (
          <button
            type="button"
            className="leve"
            onClick={() => {
              setQ('')
              setParams(new URLSearchParams())
            }}
          >
            limpar
          </button>
        )}
      </form>

      <div style={{ display: 'flex', gap: 'var(--e4)', flexWrap: 'wrap', marginBottom: 'var(--e6)' }}>
        {(
          [
            ['classe', 'classe'],
            ['resultado', 'resultado'],
            ['ancora', 'âncora'],
          ] as const
        ).map(([campo, rotulo]) => (
          <label className="campo" key={campo} style={{ flex: '1 1 200px', marginBottom: 0 }}>
            <span>{rotulo}</span>
            <select
              value={(filtros as any)[campo]}
              onChange={(e) => trocar(campo, e.target.value)}
            >
              <option value="">todas</option>
              {(facetas?.[campo] ?? []).map((f) => (
                <option key={f.valor} value={f.valor}>
                  {f.valor} ({f.n.toLocaleString('pt-BR')})
                </option>
              ))}
            </select>
          </label>
        ))}
        <label className="campo" style={{ flex: '0 1 140px', marginBottom: 0 }}>
          <span>a partir de</span>
          <input
            type="number"
            value={filtros.ano_min}
            onChange={(e) => trocar('ano_min', e.target.value)}
            placeholder="ano"
          />
        </label>
      </div>

      {isLoading && <p className="vazio">buscando…</p>}

      {data && (
        <>
          <p className="nota">
            {data.total.toLocaleString('pt-BR')} decisões ·{' '}
            {data.ordenado_por === 'data'
              ? 'ordenadas por data'
              : 'ordenadas por BM25 e re-ranking — cada item explica a própria posição'}
            {data.consulta_fts && (
              <>
                {' · '}
                <code>{data.consulta_fts}</code>
              </>
            )}
          </p>

          {data.itens.map((p) => (
            <Precedente key={p.id} p={p} detalhe={data.ordenado_por !== 'data'} />
          ))}

          {data.itens.length === 0 && <p className="vazio">nada encontrado</p>}

          {paginas > 1 && (
            <div style={{ display: 'flex', gap: 'var(--e3)', alignItems: 'center', marginTop: 'var(--e6)' }}>
              <button
                type="button"
                className="leve"
                disabled={filtros.pagina <= 0}
                onClick={() => trocar('pagina', String(filtros.pagina - 1))}
              >
                anterior
              </button>
              <span style={{ color: 'var(--tinta-3)' }}>
                página {filtros.pagina + 1} de {paginas.toLocaleString('pt-BR')}
              </span>
              <button
                type="button"
                className="leve"
                disabled={filtros.pagina + 1 >= paginas}
                onClick={() => trocar('pagina', String(filtros.pagina + 1))}
              >
                próxima
              </button>
            </div>
          )}
        </>
      )}
    </>
  )
}
