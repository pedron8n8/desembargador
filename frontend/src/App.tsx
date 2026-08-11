import { useQuery } from '@tanstack/react-query'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'

import { ROTULO_PAPEL, get, type Usuario } from './api'
import { useCerebro } from './cerebro'
import { Acervo } from './paginas/Acervo'
import { Cerebros } from './paginas/Cerebros'
import { Comparacao } from './paginas/Comparacao'
import { Comparacoes } from './paginas/Comparacoes'
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

/**
 * Quem julga. Fica no topo da lateral, e não enterrado numa tela de ajustes:
 * é a escolha que muda TODAS as outras telas (acervo, estatísticas, consulta),
 * e o usuário precisa ver a qualquer momento em qual acervo está.
 */
function SeletorCerebro() {
  const [slug, escolher, lista] = useCerebro()
  const atual = lista?.itens.find((c) => c.slug === (slug || lista?.padrao))
  if (!lista || lista.itens.length === 0) return null
  if (lista.itens.length === 1) {
    return (
      <span>
        {atual ? `${atual.titulo} ${atual.nome} · ${atual.tribunal}` : '—'}
      </span>
    )
  }
  return (
    <label className="seletor-cerebro">
      <span className="rotulo-mudo">quem julga</span>
      <select value={slug || lista.padrao} onChange={(e) => escolher(e.target.value)}>
        {lista.itens.map((c) => (
          <option key={c.slug} value={c.slug}>
            {c.titulo} {c.nome} · {c.tribunal}
            {c.crava ? '' : ' (sem prognóstico)'}
          </option>
        ))}
      </select>
    </label>
  )
}

function Lateral({ u }: { u: Usuario }) {
  const item = ({ isActive }: { isActive: boolean }) => (isActive ? 'ativo' : '')
  return (
    <nav className="lateral nao-imprime">
      <div className="marca">
        <strong>Segundo Cérebro</strong>
        <SeletorCerebro />
      </div>
      <div className="nav">
        <NavLink to="/" end className={item}>
          Consultas
        </NavLink>
        <NavLink to="/comparacoes" className={item}>
          Comparações
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
        {u.papel === 'superadmin' && (
          <NavLink to="/cerebros" className={item}>
            Cérebros
          </NavLink>
        )}
        <hr />
        <NavLink to="/conta" className={item}>
          Conta
        </NavLink>
      </div>
      <div className="rodape-lateral">
        {u.email}
        <br />
        {ROTULO_PAPEL[u.papel]}
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
          <Route path="/comparacoes" element={<Comparacoes />} />
          <Route path="/comparacao/:comparacao" element={<Comparacao />} />
          <Route path="/acervo" element={<Acervo />} />
          {/* o cérebro vai no caminho: o link para uma decisão é auto-contido,
              e colá-lo não abre a decisão de mesmo id no acervo errado */}
          <Route path="/acervo/:cerebro/:id" element={<Decisao />} />
          <Route path="/estatisticas" element={<Estatisticas />} />
          <Route path="/modelo" element={<Modelo />} />
          {u.papel === 'superadmin' && <Route path="/cerebros" element={<Cerebros />} />}
          <Route path="/conta" element={<Conta />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}
