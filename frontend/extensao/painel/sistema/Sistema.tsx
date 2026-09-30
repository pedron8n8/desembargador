import { useEffect, useRef, useState } from 'react'
import { mensagemDoErro } from '../analisar/erro.ts'
import { ehAcompanhado, linhaDoHistorico, type Acompanhado, type ApiSistema, type Instancia, type ItemHistorico } from './apiSistema.ts'

const formatar = (n: string) => n.replace(/^(\d{7})(\d{2})(\d{4})(\d)(\d{2})(\d{4})$/, '$1-$2.$3.$4.$5.$6')

type Props = {
  api: ApiSistema
  /** O processo aberto na aba, quando há (senão a tela mostra só os acompanhados). */
  processo?: { numero: string; instancia: Instancia }
  abrir: (url: string) => void
  sair: () => void
}

/**
 * A ligação com o sistema: o histórico de consultas do processo aberto, marcar/desmarcar
 * como acompanhado, e a lista de processos acompanhados (cada um abre no site).
 */
export function Sistema({ api, processo, abrir, sair }: Props) {
  const [dados, setDados] = useState<{ historico: ItemHistorico[]; lista: Acompanhado[] } | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const ocupado = useRef(false)
  const numero = processo?.numero

  useEffect(() => {
    let vivo = true
    Promise.all([numero ? api.historico(numero) : Promise.resolve([]), api.acompanhados()]).then(
      ([historico, lista]) => vivo && setDados({ historico, lista }),
      (e) => vivo && setErro(mensagemDoErro(e)),
    )
    return () => { vivo = false }
  }, [api, numero])

  async function alternar() {
    if (!processo || !dados || ocupado.current) return
    ocupado.current = true
    try {
      if (ehAcompanhado(dados.lista, processo.numero)) await api.parar(processo.numero)
      else await api.acompanhar(processo.numero, processo.instancia)
      setDados({ ...dados, lista: await api.acompanhados() })
      setErro(null)
    } catch (e) {
      setErro(mensagemDoErro(e))
    } finally {
      ocupado.current = false
    }
  }

  if (!dados && !erro) return <main className="painel"><p className="meta">Carregando…</p></main>
  if (!dados) {
    return (
      <main className="painel">
        <p role="alert">{erro}</p>
        <button className="secundario" onClick={sair}>Voltar</button>
      </main>
    )
  }

  const { historico, lista } = dados
  return (
    <main className="painel">
      {erro && <p className="aviso" role="alert">{erro}</p>}
      {processo && (
        <>
          <p>Processo <strong>{formatar(processo.numero)}</strong></p>
          <button onClick={() => void alternar()}>
            {ehAcompanhado(lista, processo.numero) ? 'Parar de acompanhar' : 'Acompanhar este processo'}
          </button>
          <h2 className="resumo">Consultas deste processo</h2>
          {historico.length === 0 && <p className="meta">Nenhuma consulta ainda.</p>}
          <ul className="lista">
            {historico.map((i) => {
              const l = linhaDoHistorico(i)
              return (
                <li key={i.thread}>
                  <strong>{l.titulo}</strong><br />
                  <span className="meta">{l.estado}</span><br />
                  <button className="secundario" onClick={() => abrir(api.urlDaConsulta(i.thread))}>Abrir no sistema</button>
                </li>
              )
            })}
          </ul>
          {historico.length > 0 && <button className="secundario" onClick={() => abrir(api.urlDoHistorico(processo.numero))}>Ver todas no sistema</button>}
        </>
      )}
      <h2 className="resumo">Processos acompanhados</h2>
      {lista.length === 0 && <p className="meta">Nenhum processo acompanhado.</p>}
      <ul className="lista">
        {lista.map((a) => (
          <li key={a.processo}>
            <strong>{formatar(a.processo)}</strong>
            {a.instancia && <span className="meta"> · {a.instancia === '2g' ? '2º grau' : '1º grau'}</span>}<br />
            <button className="secundario" onClick={() => abrir(api.urlDoHistorico(a.processo))}>Consultas no sistema</button>
          </li>
        ))}
      </ul>
      <button className="secundario" onClick={sair}>Voltar</button>
    </main>
  )
}
