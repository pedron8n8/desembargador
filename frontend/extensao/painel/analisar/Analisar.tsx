import { useEffect, useRef, useState } from 'react'
import type { Capa } from '../../agente/lib/caso.ts'
import type { ListaCerebros } from '../../../src/api.ts'
import { montarCaso, type Montagem } from '../caso/montagem.ts'
import type { Papel } from '../caso/pecas.ts'
import { aplicar, andamentoInicial, type Andamento } from './andamento.ts'
import { corpoDaConsulta, LIMITE_ENVIO, type ApiAnalise, type Origem, type Tese } from './apiAnalise.ts'
import { escolherCerebro } from './cerebro.ts'
import { mensagemDoErro } from './erro.ts'
import type { Fonte } from './fonte.ts'
import { lerPecas, type FalhaDePeca } from './ler.ts'
import { alternar, marcadas, prepararLista, type ItemLista } from './lista.ts'
import { resumirPrognostico, type Resumo } from './resumo.ts'

type Lista = { capa: Capa; itens: ItemLista[]; bloqueadas: Papel[]; cerebros: ListaCerebros; aviso: string | null; limite: number }
type Etapa =
  | { t: 'carregando' }
  | { t: 'lista'; l: Lista; erro?: string }
  | { t: 'montando' }
  | { t: 'texto'; l: Lista; m: Montagem; falhas: FalhaDePeca[]; erro?: string }
  | { t: 'rodando'; andamento: Andamento }
  | { t: 'pronto'; thread: string; resumo: Resumo; custo: number }
  | { t: 'erro'; mensagem: string; thread?: string }

const PAPEL: Record<Papel, string> = {
  decisao: 'a decisão recorrida', recurso: 'o recurso', inicial: 'a petição inicial', contestacao: 'a contestação', outra: 'uma peça',
}
const NO: Record<string, string> = {
  triagem: 'lendo o caso', recuperar: 'buscando precedentes', triar: 'escolhendo os análogos', prognostico: 'calculando o prognóstico',
  redigir: 'redigindo a minuta', revisar: 'revisando a minuta', julgar: 'avaliando a minuta',
}

type Props = { fonte: Fonte; api: ApiAnalise; origem: Origem; abrir: (url: string) => void; sair: () => void }

export function Analisar({ fonte, api, origem, abrir, sair }: Props) {
  const [etapa, setEtapa] = useState<Etapa>({ t: 'carregando' })
  const [texto, setTexto] = useState('')
  const [tese, setTese] = useState<Tese>('neutra')
  const [soPrognostico, setSoPrognostico] = useState(false)
  const [cerebro, setCerebro] = useState('')
  // Trava contra clique duplo: o ref vale na hora (dois cliques no mesmo instante veem o
  // mesmo estado velho); o estado só desabilita o botão.
  const ocupado = useRef(false)
  const [bloqueado, setBloqueado] = useState(false)
  const falhou = (e: unknown, thread?: string) => setEtapa({ t: 'erro', mensagem: mensagemDoErro(e), thread })

  useEffect(() => {
    let vivo = true
    Promise.all([fonte.capa(), fonte.pecas(), api.cerebros(), api.limiteDoCaso()]).then(
      ([capa, pecas, cerebros, limite]) => {
        if (!vivo) return
        const { itens, bloqueadas } = prepararLista(pecas)
        const escolha = escolherCerebro(capa.relator, cerebros)
        setCerebro(escolha.slug)
        setEtapa({ t: 'lista', l: { capa, itens, bloqueadas, cerebros, aviso: escolha.aviso, limite } })
      },
      (e) => vivo && falhou(e),
    )
    return () => { vivo = false }
  }, [fonte, api])

  async function montar(l: Lista) {
    if (ocupado.current) return
    ocupado.current = true
    setBloqueado(true)
    setEtapa({ t: 'montando' })
    try {
      const { itens, falhas } = await lerPecas(fonte, api, marcadas(l.itens))
      const m = montarCaso(l.capa, itens, l.limite)
      setTexto(m.texto)
      setEtapa({ t: 'texto', l, m, falhas })
    } catch (e) {
      // volta à lista com as marcas, para não perder a escolha das peças
      setEtapa({ t: 'lista', l, erro: mensagemDoErro(e) })
    } finally {
      ocupado.current = false
      setBloqueado(false)
    }
  }

  async function rodar(atual: Extract<Etapa, { t: 'texto' }>) {
    if (ocupado.current) return
    ocupado.current = true
    setBloqueado(true)
    let thread: string | undefined
    try {
      const { thread: t } = await api.rodar(corpoDaConsulta({ texto, cerebro, tese, soPrognostico, origem }))
      thread = t
      let andamento = andamentoInicial()
      setEtapa({ t: 'rodando', andamento })
      await api.acompanhar(t, (e) => {
        andamento = aplicar(andamento, e)
        setEtapa({ t: 'rodando', andamento })
      })
      if (andamento.erro) return falhou(new Error(andamento.erro), t)
      if (!andamento.concluido) return falhou(new Error('Perdi a conexão com o acompanhamento. A consulta continua rodando no sistema.'), t)
      setEtapa({ t: 'pronto', thread: t, resumo: resumirPrognostico(await api.consulta(t)), custo: andamento.custo_usd })
    } catch (e) {
      // sem consulta criada no servidor: volta ao texto, que o advogado já montou e editou
      if (thread === undefined) setEtapa({ ...atual, erro: mensagemDoErro(e) })
      else falhou(e, thread)
    } finally {
      ocupado.current = false
      setBloqueado(false)
    }
  }

  switch (etapa.t) {
    case 'carregando':
      return <main className="painel"><p className="meta">Lendo o processo…</p></main>

    case 'montando':
      return <main className="painel"><p className="meta">Lendo as peças…</p></main>

    case 'lista': {
      const { l } = etapa
      const escolhidas = marcadas(l.itens).length
      return (
        <main className="painel">
          {etapa.erro && <p className="aviso" role="alert">{etapa.erro}</p>}
          <p className="meta">Peças que a análise vai ler</p>
          {l.bloqueadas.map((p) => (
            <p key={p} className="aviso" role="alert">Atenção: {PAPEL[p]} está em sigilo e não pode ser lida.</p>
          ))}
          <ul className="lista">
            {l.itens.map((i) => (
              <li key={i.peca.ref}>
                <label>
                  <input type="checkbox" checked={i.marcada} disabled={i.peca.sigiloso}
                    onChange={() => setEtapa({ t: 'lista', l: { ...l, itens: alternar(l.itens, i.peca.ref) } })} />
                  {' '}{i.peca.rotulo} <span className="meta">· evento {i.peca.evento}{i.peca.sigiloso ? ' · sigilo' : ''}</span>
                </label>
              </li>
            ))}
          </ul>
          <button disabled={escolhidas === 0 || bloqueado} onClick={() => montar(l)}>Montar o caso</button>
          <button className="secundario" onClick={sair}>Voltar</button>
        </main>
      )
    }

    case 'texto': {
      const { l, m, falhas } = etapa
      const passou = texto.length > m.limite
      const cerebrosAtivos = l.cerebros.itens.filter((c) => c.ativo && c.tem_indice)
      return (
        <main className="painel">
          {etapa.erro && <p className="aviso" role="alert">{etapa.erro}</p>}
          {l.aviso && <p className="aviso" role="alert">{l.aviso}</p>}
          {falhas.map((f) => <p key={f.rotulo} className="aviso" role="alert">{f.rotulo}: {f.motivo}; ficou de fora.</p>)}
          <textarea className="caso" value={texto} onChange={(e) => setTexto(e.target.value)} rows={12} aria-label="Texto do caso" disabled={bloqueado} />
          <p className={passou ? 'aviso' : 'meta'}>
            {texto.length.toLocaleString('pt-BR')} de {m.limite.toLocaleString('pt-BR')} caracteres
            {passou && `: o sistema lê só os primeiros ${m.limite.toLocaleString('pt-BR')}; o final não entra na análise${m.cortadas.length ? ` (no texto montado, ficariam de fora: ${m.cortadas.join('; ')})` : ''}.`}
          </p>
          {texto.length > LIMITE_ENVIO && (
            <p className="aviso">Acima de {LIMITE_ENVIO.toLocaleString('pt-BR')} caracteres o sistema recusa o caso: corte o texto ou desmarque peças.</p>
          )}
          <label>Cérebro{' '}
            <select value={cerebro} onChange={(e) => setCerebro(e.target.value)}>
              {cerebrosAtivos.map((c) => <option key={c.slug} value={c.slug}>{c.nome}</option>)}
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
          <button disabled={!texto.trim() || !cerebro || bloqueado || texto.length > LIMITE_ENVIO} onClick={() => rodar(etapa)}>Rodar a análise</button>
          <button className="secundario" disabled={bloqueado} onClick={() => setEtapa({ t: 'lista', l })}>Voltar às peças</button>
        </main>
      )
    }

    case 'rodando': {
      const { andamento } = etapa
      return (
        <main className="painel">
          <p role="status">{andamento.no ? `Analisando: ${NO[andamento.no] ?? andamento.no}…` : 'Na fila do sistema…'}</p>
          <p className="meta">etapas concluídas: {Math.max(0, andamento.nos.length - (andamento.no ? 1 : 0))}</p>
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
