import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { get, post, type Consulta, type Mensagem } from '../api'
import { Markdown } from '../comp/Markdown'
import { usd } from '../hooks'

export function Conversa() {
  const { thread } = useParams()
  const qc = useQueryClient()
  const [texto, setTexto] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')

  const { data: c } = useQuery({
    queryKey: ['consulta', thread],
    queryFn: () => get<Consulta>(`/api/consultas/${thread}`),
  })
  const { data: msgs } = useQuery({
    queryKey: ['mensagens', thread],
    queryFn: () => get<{ itens: Mensagem[] }>(`/api/consultas/${thread}/mensagens`),
  })

  const itens = msgs?.itens ?? []
  const gasto = itens.reduce((s, m) => s + (m.custo_usd ?? 0), 0)

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    if (!texto.trim()) return
    setOcupado(true)
    setErro('')
    try {
      await post(`/api/consultas/${thread}/mensagens`, { texto })
      setTexto('')
      qc.invalidateQueries({ queryKey: ['mensagens', thread] })
    } catch (x: any) {
      setErro(x.message ?? 'o modelo não respondeu')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <>
      <header className="cabecalho">
        <div>
          <h1>Perguntar sobre a análise</h1>
          <p className="sub">
            <Link to={`/consulta/${thread}`}>{c?.triagem.materia || thread}</Link>
            {itens.length > 0 && ` · ${itens.length / 2} perguntas · ${usd(gasto)}`}
          </p>
        </div>
        <Link className="leve" to="/consulta/nova">
          nova consulta completa
        </Link>
      </header>

      <div className="aviso" style={{ marginBottom: 'var(--e8)' }}>
        Aqui <b>não há busca nova</b>. As respostas saem dos {c?.precedentes.length ?? 0}{' '}
        precedentes que esta consulta já recuperou, do prognóstico e da minuta — uma chamada de
        modelo, centavos, segundos. Para trazer precedentes novos é preciso{' '}
        <Link to="/consulta/nova">rodar uma consulta completa</Link>, que custa ~US$ 0,20 e leva
        minutos.
      </div>

      <div className="chat">
        {itens.length === 0 && (
          <p className="vazio">
            Nada perguntado ainda. Por exemplo: “por que o 0301234 pesou mais que os outros?”,
            “onde a minuta se afasta dos precedentes?”, “o que precisaria estar provado nos autos
            para virar o resultado?”
          </p>
        )}

        {itens.map((m) => (
          <div key={m.id} className={`chat-turno ${m.papel}`}>
            <div className="chat-quem">
              <span>{m.papel === 'usuario' ? 'você' : 'sistema'}</span>
              {m.modelo && (
                <span className="mono" style={{ textTransform: 'none' }}>
                  {m.modelo}
                </span>
              )}
              {m.custo_usd != null && <span>{usd(m.custo_usd)}</span>}
            </div>
            {m.papel === 'assistente' ? (
              <Markdown texto={m.texto} />
            ) : (
              <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{m.texto}</p>
            )}
          </div>
        ))}
      </div>

      {erro && (
        <p className="aviso forte" style={{ marginTop: 'var(--e6)' }}>
          {erro}
        </p>
      )}

      <form onSubmit={enviar} style={{ marginTop: 'var(--e8)', maxWidth: 'var(--medida)' }}>
        <label className="campo">
          <span>sua pergunta</span>
          <textarea
            rows={4}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            disabled={ocupado}
          />
        </label>
        <button className="botao" type="submit" disabled={ocupado || !texto.trim()}>
          {ocupado ? 'pensando…' : 'perguntar'}
        </button>
      </form>
    </>
  )
}
