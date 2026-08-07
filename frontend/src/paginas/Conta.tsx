import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { useEu } from '../App'
import { del, get, post } from '../api'
import { dataBR } from '../hooks'

export function Conta() {
  const { data: u } = useEu()
  const qc = useQueryClient()
  const [novo, setNovo] = useState({ email: '', senha: '', papel: 'advogado' })
  const [msg, setMsg] = useState('')

  const { data: usuarios } = useQuery({
    queryKey: ['usuarios'],
    queryFn: () => get<{ itens: any[] }>('/api/admin/usuarios'),
    enabled: u?.papel === 'admin',
    retry: false,
  })

  if (!u) return null

  return (
    <>
      <header className="cabecalho">
        <div>
          <h1>Conta</h1>
          <p className="sub">
            {u.email} · {u.papel === 'admin' ? 'administrador' : 'advogado'}
          </p>
        </div>
        <button
          type="button"
          className="leve"
          onClick={async () => {
            await del('/api/sessao')
            qc.clear()
            location.href = '/entrar'
          }}
        >
          sair
        </button>
      </header>

      <section className="secao">
        <h2>Sessões abertas</h2>
        <p className="nota">
          A sessão fica no servidor, não num token assinado — por isso dá para encerrá-la de
          verdade. Trocar a senha (<code>python -m api.usuarios --senha</code>) derruba todas.
        </p>
        <div className="tabela-rolavel">
          <table>
            <thead>
              <tr>
                <th>aberta em</th>
                <th>expira</th>
                <th>ip</th>
                <th>navegador</th>
              </tr>
            </thead>
            <tbody>
              {u.sessoes.map((s, i) => (
                <tr key={i}>
                  <td>{dataBR(s.criado_em)}</td>
                  <td>{dataBR(s.expira_em)}</td>
                  <td className="mono">{s.ip || '—'}</td>
                  <td style={{ color: 'var(--tinta-3)', fontSize: 'var(--t-xs)', maxWidth: 340 }}>
                    {s.agente || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {u.papel === 'admin' && (
        <section className="secao">
          <h2>Usuários</h2>
          <p className="nota">
            Não há auto-cadastro. As consultas são confidenciais: cada advogado vê só as suas, e
            o administrador vê todas — inclusive as rodadas pelo terminal, que não têm dono.
          </p>
          <div className="tabela-rolavel">
            <table>
              <thead>
                <tr>
                  <th>email</th>
                  <th>papel</th>
                  <th>criado</th>
                  <th className="num">sessões</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(usuarios?.itens ?? []).map((x) => (
                  <tr key={x.email} style={{ opacity: x.ativo ? 1 : 0.5 }}>
                    <td>{x.email}</td>
                    <td>{x.papel}</td>
                    <td>{dataBR(x.criado_em)}</td>
                    <td className="num">{x.sessoes}</td>
                    <td style={{ textAlign: 'right' }}>
                      {x.ativo && x.email !== u.email && (
                        <button
                          type="button"
                          className="leve"
                          onClick={async () => {
                            await del(`/api/admin/usuarios/${encodeURIComponent(x.email)}`)
                            qc.invalidateQueries({ queryKey: ['usuarios'] })
                          }}
                        >
                          desativar
                        </button>
                      )}
                      {!x.ativo && <span style={{ color: 'var(--tinta-3)' }}>desativado</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 style={{ fontSize: 'var(--t-md)', margin: 'var(--e8) 0 var(--e3)' }}>Novo usuário</h3>
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              setMsg('')
              try {
                await post('/api/admin/usuarios', novo)
                setNovo({ email: '', senha: '', papel: 'advogado' })
                qc.invalidateQueries({ queryKey: ['usuarios'] })
                setMsg('criado')
              } catch (x: any) {
                setMsg(x.message ?? 'não foi possível criar')
              }
            }}
            style={{ display: 'flex', gap: 'var(--e3)', alignItems: 'flex-end', flexWrap: 'wrap' }}
          >
            <label className="campo" style={{ flex: '1 1 240px', marginBottom: 0 }}>
              <span>email</span>
              <input
                type="email"
                value={novo.email}
                required
                onChange={(e) => setNovo({ ...novo, email: e.target.value })}
              />
            </label>
            <label className="campo" style={{ flex: '1 1 200px', marginBottom: 0 }}>
              <span>senha (mínimo 10)</span>
              <input
                type="password"
                value={novo.senha}
                required
                minLength={10}
                onChange={(e) => setNovo({ ...novo, senha: e.target.value })}
              />
            </label>
            <label className="campo" style={{ flex: '0 1 150px', marginBottom: 0 }}>
              <span>papel</span>
              <select
                value={novo.papel}
                onChange={(e) => setNovo({ ...novo, papel: e.target.value })}
              >
                <option value="advogado">advogado</option>
                <option value="admin">administrador</option>
              </select>
            </label>
            <button className="botao" type="submit">
              criar
            </button>
          </form>
          {msg && <p className="nota">{msg}</p>}
        </section>
      )}
    </>
  )
}
