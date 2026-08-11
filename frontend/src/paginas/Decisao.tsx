import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'

import { get, type Precedente } from '../api'
import { SeloResultado } from '../comp/Precedente'
import { dataBR } from '../hooks'

type Detalhe = Precedente & {
  dispositivo: string | null
  usos: { thread: string; nota_triagem: number | null; veredito: string | null }[]
  usos_totais: number
  boost: number | null
  tem_documento: boolean
}

export function Decisao() {
  // o cérebro vem da URL, não do seletor: o link tem de abrir sempre a mesma
  // decisão, mesmo colado noutra sessão com outro acervo selecionado
  const { cerebro, id } = useParams()
  const { data: d, error } = useQuery({
    queryKey: ['decisao', cerebro, id],
    queryFn: () => get<Detalhe>(`/api/corpus/${cerebro}/${id}`),
    retry: false,
  })
  const { data: teor } = useQuery({
    queryKey: ['teor', cerebro, id],
    queryFn: () => get<string>(`/api/corpus/${cerebro}/${id}/teor`),
    retry: false,
  })

  if (error) return <p className="vazio">Decisão não encontrada.</p>
  if (!d) return <p className="vazio">carregando…</p>

  return (
    <>
      <header className="cabecalho">
        <div>
          <h1 style={{ fontFamily: 'var(--fonte-mono)', fontSize: 'var(--t-lg)' }}>{d.numero}</h1>
          <p className="sub">
            {[d.classe, d.orgao, d.comarca].filter(Boolean).join(' · ')} · {dataBR(d.data)}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--e2)', alignItems: 'center' }} className="nao-imprime">
          <SeloResultado r={d.resultado} />
          {d.url && (
            <a className="leve" href={d.url} target="_blank" rel="noreferrer noopener">
              ver no TJSC
            </a>
          )}
          {d.tem_documento && (
            <a className="leve" href={`/api/corpus/${cerebro}/${d.id}/documento`} download>
              baixar .rtf
            </a>
          )}
        </div>
      </header>

      <div className="faixa" style={{ marginBottom: 'var(--e8)' }}>
        <div className="medida">
          <dt>âncora</dt>
          <dd style={{ fontSize: 'var(--t-md)' }}>{d.ancora ?? '—'}</dd>
        </div>
        <div className="medida">
          <dt>votação</dt>
          <dd style={{ fontSize: 'var(--t-md)' }}>
            {d.unanime === 1 ? 'unânime' : d.unanime === 0 ? 'por maioria' : 'não identificada'}
          </dd>
        </div>
        <div className="medida">
          <dt>de onde saiu o resultado</dt>
          <dd style={{ fontSize: 'var(--t-md)' }}>{d.confianca ?? '—'}</dd>
        </div>
        <div className="medida">
          <dt>já usada em</dt>
          <dd>
            {d.usos_totais}
            <small> consultas</small>
          </dd>
        </div>
        {d.boost != null && (
          <div className="medida">
            <dt>ajuste por feedback</dt>
            <dd>{d.boost.toFixed(2)}×</dd>
          </div>
        )}
      </div>

      <section className="secao">
        <h2>Procedência</h2>
        <p>{d.ficha}</p>
        {d.ancoras.length > 0 && (
          <p className="prec-linha">
            <b>Citações</b>
            {d.ancoras.join(' · ')}
          </p>
        )}
        {d.efeito && (
          <p className="prec-linha">
            <b>Datajud</b>
            {[
              d.efeito.transitou && 'transitou em julgado',
              d.efeito.subiu && 'subiu para STJ/STF',
              d.efeito.sobrestado && 'sobrestado',
            ]
              .filter(Boolean)
              .join(' · ') || 'sem efeito posterior registrado'}
          </p>
        )}
      </section>

      <section className="secao">
        <h2>Ementa</h2>
        <p className="juridico" style={{ whiteSpace: 'pre-wrap' }}>
          {d.ementa || '(sem ementa)'}
        </p>
      </section>

      {d.dispositivo && (
        <section className="secao">
          <h2>Dispositivo</h2>
          <p className="juridico" style={{ whiteSpace: 'pre-wrap' }}>
            {d.dispositivo}
          </p>
        </section>
      )}

      {teor && (
        <section className="secao">
          <h2>Inteiro teor</h2>
          <p className="nota">
            {teor.length.toLocaleString('pt-BR')} caracteres. É este texto que o redator recebe,
            cortado no começo e no fim quando não cabe.
          </p>
          <details>
            <summary style={{ cursor: 'pointer', color: 'var(--selo)', marginBottom: 'var(--e4)' }}>
              mostrar
            </summary>
            <div className="juridico" style={{ whiteSpace: 'pre-wrap' }}>
              {teor}
            </div>
          </details>
        </section>
      )}

      {d.usos.length > 0 && (
        <section className="secao">
          <h2>Onde você já usou esta decisão</h2>
          <table style={{ maxWidth: 560 }}>
            <thead>
              <tr>
                <th>consulta</th>
                <th className="num">analogia</th>
                <th>seu veredito</th>
              </tr>
            </thead>
            <tbody>
              {d.usos.map((u) => (
                <tr key={u.thread}>
                  <td>
                    <Link to={`/consulta/${u.thread}`}>{u.thread}</Link>
                  </td>
                  <td className="num">{u.nota_triagem ?? '—'}</td>
                  <td>{u.veredito === 'util' ? 'serviu' : u.veredito === 'inutil' ? 'não serviu' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {d.usos_totais > d.usos.length && (
            <p className="nota">
              Foi usada em {d.usos_totais} consultas no total; as demais são de outros usuários.
            </p>
          )}
        </section>
      )}
    </>
  )
}
