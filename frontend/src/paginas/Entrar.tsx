import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { ErroApi, post } from '../api'

export function Entrar() {
  const qc = useQueryClient()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState(false)

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setOcupado(true)
    try {
      await post('/api/sessao', { email, senha })
      await qc.invalidateQueries({ queryKey: ['eu'] })
    } catch (x) {
      setErro(
        x instanceof ErroApi && x.status === 429
          ? 'Tentativas demais. Espere alguns minutos.'
          : 'Email ou senha incorretos.',
      )
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div
      style={{
        display: 'grid',
        placeItems: 'center',
        minHeight: '100vh',
        padding: 'var(--e6)',
      }}
    >
      <form
        onSubmit={enviar}
        style={{ width: 340, borderTop: '2px solid var(--selo)', paddingTop: 'var(--e6)' }}
      >
        <h1
          style={{
            fontFamily: 'var(--fonte-serif)',
            fontSize: 'var(--t-xl)',
            fontWeight: 400,
          }}
        >
          Segundo Cérebro
        </h1>
        <p style={{ color: 'var(--tinta-3)', fontSize: 'var(--t-sm)', margin: '4px 0 var(--e8)' }}>
          {/* sem nome de desembargador aqui: quem julga passou a ser escolha de
              quem consulta, e a tela de entrada é anterior a essa escolha */}
          Acervos de jurisprudência do TJSC
        </p>

        <label className="campo">
          <span>email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
            autoFocus
          />
        </label>
        <label className="campo">
          <span>senha</span>
          <input
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        {erro && (
          <p className="aviso forte" style={{ marginBottom: 'var(--e4)' }}>
            {erro}
          </p>
        )}

        <button className="botao" type="submit" disabled={ocupado} style={{ width: '100%' }}>
          {ocupado ? 'entrando…' : 'entrar'}
        </button>

        <p style={{ color: 'var(--tinta-3)', fontSize: 'var(--t-xs)', marginTop: 'var(--e6)' }}>
          Não há cadastro por aqui. As contas são criadas na máquina do servidor com{' '}
          <code>python -m api.usuarios --criar</code>.
        </p>
      </form>
    </div>
  )
}
