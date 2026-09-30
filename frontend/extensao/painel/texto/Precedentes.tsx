import { useEffect, useRef, useState } from 'react'
import { minimizar } from '../../agente/lib/minimizacao.ts'
import type { ListaCerebros } from '../../../src/api.ts'
import { escolherCerebro } from '../analisar/cerebro.ts'
import { mensagemDoErro } from '../analisar/erro.ts'
import type { ApiAnalise } from '../analisar/apiAnalise.ts'
import type { FonteDoTexto, TextoLido } from './fonteTexto.ts'
import { podeEnviar, ROTULO_SIGILO } from './envio.ts'
import { linhaDoPrecedente, type ResultadoPrecedentes } from './precedentes.ts'
import { termosDeBusca } from './termos.ts'

type Edicao = { texto: TextoLido; cerebros: ListaCerebros; aviso?: string }
type Etapa =
  | { t: 'carregando' }
  | { t: 'edicao'; e: Edicao }
  | { t: 'buscando' }
  | { t: 'resultados'; e: Edicao; r: ResultadoPrecedentes }
  | { t: 'erro'; mensagem: string }

// Quanto do texto entra na busca: os termos são as palavras mais frequentes, e o início basta.
const TEXTO_DA_BUSCA = 5000

type Props = {
  lerTexto: () => Promise<TextoLido>
  api: Pick<ApiAnalise, 'cerebros' | 'buscarPrecedentes' | 'urlDoPrecedente'>
  abrir: (url: string) => void
  /** Leva o texto (já minimizado) para o fluxo de análise. */
  analisar: (texto: string, fonte: FonteDoTexto) => void
  sair: () => void
}

/**
 * Busca de precedentes a partir do texto da tela do eproc (a seleção do advogado ou a
 * página). O texto é editável antes de buscar, sai minimizado, e vira palavras de
 * conteúdo (ver termos.ts). Os resultados abrem no site, na página do acervo.
 */
export function Precedentes({ lerTexto, api, abrir, analisar, sair }: Props) {
  const [etapa, setEtapa] = useState<Etapa>({ t: 'carregando' })
  const [texto, setTexto] = useState('')
  const [cerebro, setCerebro] = useState('')
  const [confirmou, setConfirmou] = useState(false)
  const ocupado = useRef(false)

  useEffect(() => {
    let vivo = true
    Promise.all([lerTexto(), api.cerebros()]).then(
      ([t, cerebros]) => {
        if (!vivo) return
        setTexto(t.texto)
        setCerebro(escolherCerebro(null, cerebros).slug)
        setEtapa({ t: 'edicao', e: { texto: t, cerebros } })
      },
      (e) => vivo && setEtapa({ t: 'erro', mensagem: mensagemDoErro(e) }),
    )
    return () => { vivo = false }
  }, [lerTexto, api])

  async function buscar(e: Edicao) {
    if (!podeEnviar({ fonte: e.texto.fonte, confirmou, texto })) return
    if (ocupado.current) return
    ocupado.current = true
    const q = termosDeBusca(minimizar(texto).slice(0, TEXTO_DA_BUSCA))
    if (!q) {
      setEtapa({ t: 'edicao', e: { ...e, aviso: 'Não encontrei palavras suficientes no texto para buscar.' } })
      ocupado.current = false
      return
    }
    setEtapa({ t: 'buscando' })
    try {
      setEtapa({ t: 'resultados', e, r: await api.buscarPrecedentes(q, cerebro) })
    } catch (err) {
      setEtapa({ t: 'edicao', e: { ...e, aviso: mensagemDoErro(err) } })
    } finally {
      ocupado.current = false
    }
  }

  switch (etapa.t) {
    case 'carregando':
      return <main className="painel"><p className="meta">Lendo o texto da tela…</p></main>

    case 'buscando':
      return <main className="painel"><p role="status">Buscando precedentes…</p></main>

    case 'edicao': {
      const { e } = etapa
      const ativos = e.cerebros.itens.filter((c) => c.ativo && c.tem_indice)
      return (
        <main className="painel">
          {e.aviso && <p className="aviso" role="alert">{e.aviso}</p>}
          <p className="meta">
            Texto {e.texto.fonte === 'selecao' ? 'selecionado na tela' : 'da página'}
            {e.texto.cortado && ' (cortado: o fim ficou de fora)'}
          </p>
          <p className="aviso">O texto vem da tela do eproc. Não use conteúdo de processo em sigilo.</p>
          {e.texto.fonte === 'pagina' && (
            <label><input type="checkbox" checked={confirmou} onChange={(ev) => setConfirmou(ev.target.checked)} /> {ROTULO_SIGILO}</label>
          )}
          <textarea className="caso" value={texto} onChange={(ev) => setTexto(ev.target.value)} rows={8} aria-label="Texto para a busca" />
          <label>Cérebro{' '}
            <select value={cerebro} onChange={(ev) => setCerebro(ev.target.value)}>
              {ativos.map((c) => <option key={c.slug} value={c.slug}>{c.nome}</option>)}
            </select>
          </label>
          {(() => {
            const ok = podeEnviar({ fonte: e.texto.fonte, confirmou, texto })
            return (
              <>
                <button disabled={!ok || !cerebro} onClick={() => void buscar(e)}>Buscar precedentes</button>
                <button className="secundario" disabled={!ok} onClick={() => analisar(minimizar(texto), e.texto.fonte)}>Analisar este texto</button>
              </>
            )
          })()}
          <button className="secundario" onClick={sair}>Voltar</button>
        </main>
      )
    }

    case 'resultados': {
      const { e, r } = etapa
      return (
        <main className="painel">
          <p className="meta">{r.total === 0 ? 'Nenhum precedente encontrado para estes termos.' : `${r.total.toLocaleString('pt-BR')} precedentes; os ${r.itens.length} mais relevantes:`}</p>
          <ul className="lista">
            {r.itens.map((p) => {
              const l = linhaDoPrecedente(p)
              return (
                <li key={p.id}>
                  <strong>{l.titulo}</strong>
                  {l.meta && <><br /><span className="meta">{l.meta}</span></>}
                  {l.ementa && <><br />{l.ementa}</>}
                  <br />
                  <button className="secundario" onClick={() => abrir(api.urlDoPrecedente(cerebro, p.id))}>Abrir no sistema</button>
                </li>
              )
            })}
          </ul>
          <button onClick={() => setEtapa({ t: 'edicao', e })}>Ajustar o texto</button>
          <button className="secundario" onClick={sair}>Voltar</button>
        </main>
      )
    }

    case 'erro':
      return (
        <main className="painel">
          <p role="alert">{etapa.mensagem}</p>
          <button className="secundario" onClick={sair}>Voltar</button>
        </main>
      )
  }
}
