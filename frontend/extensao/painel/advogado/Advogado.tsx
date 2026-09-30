import { useCallback, useEffect, useRef, useState } from 'react'
import { mensagemDoErro } from '../analisar/erro.ts'
import type { FonteAdvogado } from './fonteAdvogado.ts'
import { avisoSigilosos, mensagemVazia, prepararPainel, ROTULO_TIPO, type LinhaPainel } from './painelAdvogado.ts'

type Estado =
  | { t: 'carregando' }
  | { t: 'lista'; linhas: LinhaPainel[]; sigilosos: number; aviso?: string }
  | { t: 'erro'; mensagem: string }

const SITUACAO: Record<LinhaPainel['situacao'], string | null> = {
  vencido: 'prazo vencido, segundo a data do eproc',
  proximo: 'vence em até 7 dias',
  normal: null,
  sem_prazo: null,
}

type Props = { fonte: FonteAdvogado; instancia: '1g' | '2g' | null; hoje?: () => Date; sair: () => void }

/**
 * Intimações e prazos do advogado. Só lê a listagem e mostra o que o eproc informa: o
 * sistema não calcula prazo processual. "Abrir no eproc" abre o PROCESSO, nunca a
 * intimação (abrir intimação pode registrar ciência).
 */
export function Advogado({ fonte, instancia, hoje = () => new Date(), sair }: Props) {
  const [estado, setEstado] = useState<Estado>({ t: 'carregando' })
  const ocupado = useRef(false)

  const carregar = useCallback(async () => {
    if (ocupado.current) return
    ocupado.current = true
    setEstado({ t: 'carregando' })
    try {
      const r = prepararPainel(await fonte.painel(), hoje())
      setEstado({ t: 'lista', linhas: r.linhas, sigilosos: r.sigilosos })
    } catch (e) {
      setEstado({ t: 'erro', mensagem: mensagemDoErro(e) })
    } finally {
      ocupado.current = false
    }
  }, [fonte, hoje])

  useEffect(() => {
    void carregar()
  }, [carregar])

  async function abrir(ref: string, atual: Extract<Estado, { t: 'lista' }>) {
    try {
      await fonte.abrir(ref)
    } catch (e) {
      setEstado({ ...atual, aviso: mensagemDoErro(e) })
    }
  }

  if (estado.t === 'carregando') return <main className="painel"><p className="meta">Lendo o painel do advogado…</p></main>

  if (estado.t === 'erro') {
    return (
      <main className="painel">
        <p role="alert">{estado.mensagem}</p>
        <button onClick={() => void carregar()}>Tentar de novo</button>
        <button className="secundario" onClick={sair}>Voltar</button>
      </main>
    )
  }

  const vazia = mensagemVazia(estado, instancia)
  const sigilo = avisoSigilosos(estado.sigilosos)
  return (
    <main className="painel">
      <p className="meta">Intimações e prazos · eproc do TJSC ({instancia === '2g' ? '2º grau' : '1º grau'})</p>
      {estado.aviso && <p className="aviso" role="alert">{estado.aviso}</p>}
      {vazia && <p>{vazia}</p>}
      <ul className="lista">
        {estado.linhas.map((l) => (
          <li key={l.item.ref} className={l.situacao === 'sem_prazo' || l.situacao === 'normal' ? undefined : 'destaque'}>
            <strong>{l.processoFormatado}</strong> <span className="meta">· {ROTULO_TIPO[l.item.tipo]} · {l.item.classe}</span>
            <br />
            {l.item.evento}
            <br />
            <span className="meta">
              desde {l.item.inicio}
              {l.item.prazoFinal !== null && ` · prazo final (eproc): ${l.item.prazoFinal}`}
              {l.dataIlegivel && ' (data ilegível)'}
            </span>
            {SITUACAO[l.situacao] && <span className="aviso"> · {SITUACAO[l.situacao]}</span>}
            <br />
            <button className="secundario" onClick={() => void abrir(l.item.ref, estado)}>Abrir o processo no eproc</button>
          </li>
        ))}
      </ul>
      {sigilo && estado.linhas.length > 0 && <p className="meta">{sigilo}</p>}
      <button onClick={() => void carregar()}>Atualizar</button>
      <button className="secundario" onClick={sair}>Voltar</button>
    </main>
  )
}
