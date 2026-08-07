import { useQuery } from '@tanstack/react-query'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'

import { get, type Usuario } from './api'
import { Acervo } from './paginas/Acervo'
import { Conta } from './paginas/Conta'
import { Consulta } from './paginas/Consulta'
import { Conversa } from './paginas/Conversa'
import { Decisao } from './paginas/Decisao'
import { Entrar } from './paginas/Entrar'
import { Estatisticas } from './paginas/Estatisticas'
import { Modelo } from './paginas/Modelo'
import { NovaConsulta } from './paginas/NovaConsulta'
import { Painel } from './paginas/Painel'

export function useEu() {
  return useQuery({
    queryKey: ['eu'],
    queryFn: () => get<Usuario>('/api/eu'),
    retry: false,
    staleTime: 5 * 60_000,
  })
}

function Lateral({ u }: { u: Usuario }) {
  const item = ({ isActive }: { isActive: boolean }) => (isActive ? 'ativo' : '')
  return (
    <nav className="lateral nao-imprime">
      <div className="marca">
        <strong>Segundo Cérebro</strong>
        <span>Des. Rubens Schulz · TJSC</span>
      </div>
      <div className="nav">
        <NavLink to="/" end className={item}>
          Consultas
        </NavLink>
        <NavLink to="/consulta/nova" className={item}>
          Nova consulta
        </NavLink>
        <hr />
        <NavLink to="/acervo" className={item}>
          Acervo
        </NavLink>
        <NavLink to="/estatisticas" className={item}>
          Estatísticas
        </NavLink>
        <NavLink to="/modelo" className={item}>
          O modelo
        </NavLink>
        <hr />
        <NavLink to="/conta" className={item}>
          Conta
        </NavLink>
      </div>
      <div className="rodape-lateral">
        {u.email}
        <br />
        {u.papel === 'admin' ? 'administrador' : 'advogado'}
      </div>
    </nav>
  )
}

export function App() {
  const { data: u, isLoading, isError } = useEu()
  const local = useLocation()

  if (isLoading) return null
  if (isError || !u) {
    return local.pathname === '/entrar' ? <Entrar /> : <Navigate to="/entrar" replace />
  }
  if (local.pathname === '/entrar') return <Navigate to="/" replace />

  return (
    <div className="app">
      <Lateral u={u} />
      <main className="conteudo">
        <Routes>
          <Route path="/" element={<Painel />} />
          <Route path="/consulta/nova" element={<NovaConsulta />} />
          <Route path="/consulta/:thread" element={<Consulta />} />
          <Route path="/consulta/:thread/:aba" element={<Consulta />} />
          <Route path="/conversa/:thread" element={<Conversa />} />
          <Route path="/acervo" element={<Acervo />} />
          <Route path="/acervo/:id" element={<Decisao />} />
          <Route path="/estatisticas" element={<Estatisticas />} />
          <Route path="/modelo" element={<Modelo />} />
          <Route path="/conta" element={<Conta />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}
