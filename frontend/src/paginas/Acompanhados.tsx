import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { del, get, put, type Acompanhado } from '../api'
import { dataBR, numeroCNJ } from '../hooks'

/** Processos que o advogado marcou para acompanhar (pelo painel da extensão ou aqui). */
export function Acompanhados() {
  const qc = useQueryClient()
  const [numero, setNumero] = useState('')
  const [erro, setErro] = useState('')
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['acompanhados'],
    queryFn: () => get<{ itens: Acompanhado[] }>('/api/acompanhados'),
  })
  const itens = data?.itens ?? []
  const digitos = numero.replace(/\D/g, '')

  async function adicionar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    if (digitos.length !== 20) return setErro('O número do processo tem 20 dígitos.')
    try {
      await put(`/api/acompanhados/${digitos}`)
      setNumero('')
      qc.invalidateQueries({ queryKey: ['acompanhados'] })
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui salvar.')
    }
  }

  async function remover(processo: string) {
    setErro('')
    try {
      await del(`/api/acompanhados/${processo}`)
      qc.invalidateQueries({ queryKey: ['acompanhados'] })
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não consegui parar de acompanhar.')
    }
  }

  return (
    <>
      <header className="cabecalho">
        <div>
          <h1>Processos acompanhados</h1>
          <p className="sub">{isLoading ? 'carregando…' : isError ? 'indisponível' : `${itens.length} no total`}</p>
        </div>
      </header>

      <form onSubmit={adicionar} style={{ display: 'flex', gap: 'var(--e8)', alignItems: 'flex-end', marginBottom: 'var(--e8)' }}>
        <label className="campo" style={{ flex: '1 1 320px', marginBottom: 0 }}>
          Número do processo
          <input value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="0000000-00.0000.0.00.0000" />
        </label>
        <button className="botao" type="submit">Acompanhar</button>
      </form>
      {erro && <p role="alert" style={{ color: 'var(--alerta)' }}>{erro}</p>}

      {isError && (
        <p role="alert" style={{ color: 'var(--alerta)' }}>
          Não consegui carregar a lista.{' '}
          <button type="button" className="leve" onClick={() => void refetch()}>tentar de novo</button>
        </p>
      )}

      {!isLoading && !isError && itens.length === 0 && <p className="vazio">Nenhum processo acompanhado.</p>}

      {itens.length > 0 && (
        <div className="tabela-rolavel">
          <table>
            <thead>
              <tr>
                <th>processo</th>
                <th>grau</th>
                <th>desde</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {itens.map((i) => (
                <tr key={i.processo}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <Link to={`/?eproc=${i.processo}`}>{numeroCNJ(i.processo)}</Link>
                  </td>
                  <td>{i.instancia === '2g' ? '2º grau' : i.instancia === '1g' ? '1º grau' : '—'}</td>
                  <td>{dataBR(i.criado_em)}</td>
                  <td>
                    <button type="button" className="leve" onClick={() => remover(i.processo)}>
                      parar de acompanhar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
