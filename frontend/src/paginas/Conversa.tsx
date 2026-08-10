import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { ACEITA, extrairArquivo, get, post, type Consulta, type Mensagem } from '../api'
import { Markdown } from '../comp/Markdown'
import { usd } from '../hooks'

// O anexo vai grudado na pergunta, num campo só: a mensagem continua sendo uma
// string, então histórico, banco e prompt não mudam. Esta linha é o que separa
// os dois de novo — para a tela e para o modelo, que a recebe como marcação.
const MARCA = '--- documento anexado'

/** Pergunta em cima, documento dobrado embaixo: um anexo de 10 mil caracteres
 *  não pode empurrar a conversa inteira para fora da tela. */
function TurnoUsuario({ texto }: { texto: string }) {
  const corte = texto.indexOf(MARCA)
  const corpo = { margin: 0, whiteSpace: 'pre-wrap' } as const
  if (corte < 0) return <p style={corpo}>{texto}</p>
  return (
    <>
      <p style={corpo}>{texto.slice(0, corte).trim() || '(sem pergunta, só o documento)'}</p>
      <details style={{ marginTop: 'var(--e2)' }}>
        <summary style={{ cursor: 'pointer', color: 'var(--tinta-3)', fontSize: 'var(--t-xs)' }}>
          documento anexado — {(texto.length - corte).toLocaleString('pt-BR')} caracteres
        </summary>
        <p style={{ ...corpo, color: 'var(--tinta-2)', fontSize: 'var(--t-sm)' }}>
          {texto.slice(corte)}
        </p>
      </details>
    </>
  )
}

export function Conversa() {
  const { thread } = useParams()
  const qc = useQueryClient()
  const [texto, setTexto] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [lendo, setLendo] = useState(false)
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

  async function anexar(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setErro('')
    setLendo(true)
    try {
      // o servidor é quem lê o arquivo: PDF escaneado passa por OCR lá
      const { texto: conteudo } = await extrairArquivo(f)
      // acrescenta, não substitui: o que você já escreveu é a pergunta sobre o anexo
      setTexto((x) => `${x}\n\n${MARCA}: ${f.name} ---\n${conteudo}`.trim())
    } catch (x: any) {
      setErro(x.message ?? 'não foi possível ler o arquivo')
    } finally {
      setLendo(false)
      e.target.value = '' // deixa reanexar o mesmo arquivo depois de editado
    }
  }

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
        precedentes que esta consulta já recuperou, do prognóstico, da minuta — e do documento
        que você anexar, se anexar. Uma chamada de modelo, centavos, segundos. O anexo é material
        seu, não do acervo: serve para confrontar a análise, não vira precedente. Para trazer
        precedentes novos é preciso{' '}
        <Link to="/consulta/nova">rodar uma consulta completa</Link>, que custa ~US$ 0,04 e leva
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
              <TurnoUsuario texto={m.texto} />
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
        <p style={{ marginTop: 'calc(var(--e4) * -1)', marginBottom: 'var(--e4)' }}>
          <input type="file" accept={ACEITA} onChange={anexar} disabled={ocupado || lendo} />
          <span className="prec-meta">
            {lendo
              ? ' extraindo o texto…'
              : ' anexar .pdf, .docx, .txt ou .md — vai junto com a pergunta'}
          </span>
        </p>
        <button className="botao" type="submit" disabled={ocupado || lendo || !texto.trim()}>
          {ocupado ? 'pensando…' : 'perguntar'}
        </button>
      </form>
    </>
  )
}
