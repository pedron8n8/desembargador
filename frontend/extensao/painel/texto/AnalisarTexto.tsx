import { useEffect, useRef, useState } from 'react'
import type { ListaCerebros } from '../../../src/api.ts'
import { aplicar, andamentoInicial, type Andamento } from '../analisar/andamento.ts'
import { corpoDaConsulta, LIMITE_ENVIO, type ApiAnalise, type Origem, type Tese } from '../analisar/apiAnalise.ts'
import { escolherCerebro } from '../analisar/cerebro.ts'
import { mensagemDoErro } from '../analisar/erro.ts'
import type { FonteDoTexto } from './fonteTexto.ts'
import { resumirPrognostico, type Resumo } from '../analisar/resumo.ts'
import { origemDoTexto, podeEnviar, ROTULO_SIGILO } from './envio.ts'

type Etapa =
  | { t: 'carregando' }
  | { t: 'texto'; cerebros: ListaCerebros; limite: number; aviso: string | null; erro?: string }
  | { t: 'rodando'; andamento: Andamento }
  | { t: 'pronto'; thread: string; resumo: Resumo; custo: number }
  | { t: 'erro'; mensagem: string; thread?: string }

const NO: Record<string, string> = {
  triagem: 'lendo o caso', recuperar: 'buscando precedentes', triar: 'escolhendo os análogos', prognostico: 'calculando o prognóstico',
  redigir: 'redigindo a minuta', revisar: 'revisando a minuta', julgar: 'avaliando a minuta',
}

type Props = { texto: string; fonte: FonteDoTexto; api: ApiAnalise; origem?: Origem; abrir: (url: string) => void; sair: () => void }

/**
 * Analisa um TEXTO avulso (o que o advogado selecionou na tela do eproc, ou a página
 * aberta): o mesmo caminho do "Analisar este processo" depois da montagem do caso, sem a
 * etapa de escolher peças. Reaproveita todos os módulos puros; só a tela é própria.
 */
export function AnalisarTexto({ texto: inicial, fonte, api, origem, abrir, sair }: Props) {
  const [etapa, setEtapa] = useState<Etapa>({ t: 'carregando' })
  const [texto, setTexto] = useState(inicial)
  const [tese, setTese] = useState<Tese>('neutra')
  const [soPrognostico, setSoPrognostico] = useState(false)
  const [cerebro, setCerebro] = useState('')
  const [bloqueado, setBloqueado] = useState(false)
  const [confirmou, setConfirmou] = useState(false)
  const ocupado = useRef(false)

  useEffect(() => {
    let vivo = true
    Promise.all([api.cerebros(), api.limiteDoCaso()]).then(
      ([cerebros, limite]) => {
        if (!vivo) return
        const escolha = escolherCerebro(null, cerebros)
        setCerebro(escolha.slug)
        setEtapa({ t: 'texto', cerebros, limite, aviso: escolha.aviso })
      },
      (e) => vivo && setEtapa({ t: 'erro', mensagem: mensagemDoErro(e) }),
    )
    return () => { vivo = false }
  }, [api])

  async function rodar(atual: Extract<Etapa, { t: 'texto' }>) {
    if (!podeEnviar({ fonte, confirmou, texto })) return
    if (ocupado.current) return // trava síncrona: dois cliques no mesmo instante criariam duas consultas pagas
    ocupado.current = true
    setBloqueado(true)
    let thread: string | undefined
    try {
      const { thread: t } = await api.rodar(corpoDaConsulta({ texto, cerebro, tese, soPrognostico, origem: origemDoTexto(fonte, origem) }))
      thread = t
      let andamento = andamentoInicial()
      setEtapa({ t: 'rodando', andamento })
      await api.acompanhar(t, (e) => {
        andamento = aplicar(andamento, e)
        setEtapa({ t: 'rodando', andamento })
      })
      if (andamento.erro) return setEtapa({ t: 'erro', mensagem: andamento.erro, thread: t })
      if (!andamento.concluido) {
        return setEtapa({ t: 'erro', mensagem: 'Perdi a conexão com o acompanhamento. A consulta continua rodando no sistema.', thread: t })
      }
      setEtapa({ t: 'pronto', thread: t, resumo: resumirPrognostico(await api.consulta(t)), custo: andamento.custo_usd })
    } catch (e) {
      // antes de existir consulta, o texto editado não se perde: volta para ele com o aviso
      if (!thread) setEtapa({ ...atual, erro: mensagemDoErro(e) })
      else setEtapa({ t: 'erro', mensagem: mensagemDoErro(e), thread })
    } finally {
      ocupado.current = false
      setBloqueado(false)
    }
  }

  switch (etapa.t) {
    case 'carregando':
      return <main className="painel"><p className="meta">Preparando…</p></main>

    case 'texto': {
      const passou = texto.length > etapa.limite
      const acima = texto.length > LIMITE_ENVIO
      const ativos = etapa.cerebros.itens.filter((c) => c.ativo && c.tem_indice)
      return (
        <main className="painel">
          {etapa.erro && <p className="aviso" role="alert">{etapa.erro}</p>}
          {etapa.aviso && <p className="aviso" role="alert">{etapa.aviso}</p>}
          <p className="aviso">O texto vem da tela do eproc. Não use conteúdo de processo em sigilo.</p>
          {fonte === 'pagina' && (
            <label><input type="checkbox" checked={confirmou} onChange={(e) => setConfirmou(e.target.checked)} disabled={bloqueado} /> {ROTULO_SIGILO}</label>
          )}
          <textarea className="caso" value={texto} onChange={(e) => setTexto(e.target.value)} rows={12} aria-label="Texto do caso" disabled={bloqueado} />
          <p className={passou ? 'aviso' : 'meta'}>
            {texto.length.toLocaleString('pt-BR')} de {etapa.limite.toLocaleString('pt-BR')} caracteres
            {passou && `: o sistema lê só os primeiros ${etapa.limite.toLocaleString('pt-BR')}; o final não entra na análise.`}
          </p>
          {acima && <p className="aviso">Acima de {LIMITE_ENVIO.toLocaleString('pt-BR')} caracteres o sistema recusa o caso: corte o texto.</p>}
          <label>Cérebro{' '}
            <select value={cerebro} onChange={(e) => setCerebro(e.target.value)}>
              {ativos.map((c) => <option key={c.slug} value={c.slug}>{c.nome}</option>)}
            </select>
          </label>
          <label>Tese{' '}
            <select value={tese} onChange={(e) => setTese(e.target.value as Tese)}>
              <option value="neutra">neutra</option>
              <option value="reformar">reformar a decisão</option>
              <option value="manter">manter a decisão</option>
            </select>
          </label>
          <label><input type="checkbox" checked={soPrognostico} onChange={(e) => setSoPrognostico(e.target.checked)} /> Só o prognóstico (mais rápido e barato)</label>
          <button disabled={!podeEnviar({ fonte, confirmou, texto }) || !cerebro || acima || bloqueado} onClick={() => void rodar(etapa)}>Rodar a análise</button>
          <button className="secundario" disabled={bloqueado} onClick={sair}>Voltar</button>
        </main>
      )
    }

    case 'rodando': {
      const { andamento } = etapa
      return (
        <main className="painel">
          <p role="status">{andamento.no ? `Analisando: ${NO[andamento.no] ?? andamento.no}…` : 'Na fila do sistema…'}</p>
        </main>
      )
    }

    case 'pronto': {
      const { resumo, thread, custo } = etapa
      return (
        <main className="painel">
          <h2 className="resumo">{resumo.titulo}</h2>
          {resumo.aviso && <p className="aviso" role="alert">{resumo.aviso}</p>}
          {resumo.linhas.map((x) => <p key={x} className="meta">{x}</p>)}
          <p className="meta">custo: US$ {custo.toFixed(4)}</p>
          <button onClick={() => abrir(api.urlDoSite(thread))}>Abrir no sistema</button>
          <button className="secundario" onClick={sair}>Fechar</button>
        </main>
      )
    }

    case 'erro':
      return (
        <main className="painel">
          <p role="alert">{etapa.mensagem}</p>
          {etapa.thread && <button onClick={() => abrir(api.urlDoSite(etapa.thread!))}>Abrir no sistema</button>}
          <button className="secundario" onClick={sair}>Voltar</button>
        </main>
      )
  }
}
