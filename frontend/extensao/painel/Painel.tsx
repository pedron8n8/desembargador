import { useCallback, useEffect, useRef, useState } from 'react'
import { Advogado } from './advogado/Advogado.tsx'
import type { FonteAdvogado } from './advogado/fonteAdvogado.ts'
import { Analisar } from './analisar/Analisar.tsx'
import type { ApiAnalise } from './analisar/apiAnalise.ts'
import type { Fonte } from './analisar/fonte.ts'
import { abrirAba, executar, depsChrome, lerTextoDaAba, observarAba } from './chrome.ts'
import { abrirPainel, type Deps, type Tela } from './fluxo.ts'
import { diagnostico, MENSAGENS } from './mensagens.ts'
import { AnalisarTexto } from './texto/AnalisarTexto.tsx'
import type { TextoLido } from './texto/fonteTexto.ts'
import { Precedentes } from './texto/Precedentes.tsx'
import { debounce } from './util/debounce.ts'

const VERSAO = chrome.runtime.getManifest().version
const formatar = (n: string) => n.replace(/^(\d{7})(\d{2})(\d{4})(\d)(\d{2})(\d{4})$/, '$1-$2.$3.$4.$5.$6')

// `deps`, `fonte`, `advogado`, `lerTexto`, `observar` e `abrir` só mudam na página de
// demonstração (demo.tsx), que injeta um eproc e um servidor de mentira. No painel de
// verdade `fonte` e `advogado` ficam indefinidos até as primitivas de leitura do eproc
// existirem, e sem eles os botões "Analisar este processo" e "Intimações e prazos" nem
// aparecem: nenhum botão que não funciona. Já o texto da tela só precisa do agente e do
// servidor, que existem: `api` liga a busca de precedentes e a análise de texto.
type Props = {
  deps?: Deps
  fonte?: Fonte
  api?: ApiAnalise
  advogado?: FonteAdvogado
  lerTexto?: (abaId: number) => Promise<TextoLido>
  observar?: (aoMudar: () => void) => () => void
  abrir?: (url: string) => void
}

// Qual sub-tela está aberta por cima do painel (null = o painel). Com uma aberta, o
// painel NÃO se atualiza sozinho: isso derrubaria a tela em uso.
type Sub = null | { t: 'analisar' } | { t: 'advogado' } | { t: 'texto' } | { t: 'analisarTexto'; texto: string }

export function Painel({ deps = depsChrome, fonte, api, advogado, lerTexto = lerTextoDaAba, observar = observarAba, abrir = abrirAba }: Props) {
  const [tela, setTela] = useState<Tela | null>(null)
  const [sub, setSub] = useState<Sub>(null)
  const carregar = useCallback(() => {
    setTela(null)
    abrirPainel(deps).then(setTela, () => setTela({ tipo: 'erro', erro: 'LAYOUT' }))
  }, [deps])
  useEffect(carregar, [carregar])

  // Acompanha o advogado: troca de aba ou aba que termina de carregar atualiza o painel, em
  // silêncio (sem voltar ao "Verificando…") e só quando nenhuma sub-tela está aberta.
  const semSub = useRef(true)
  semSub.current = sub === null
  const atualizar = useCallback(() => {
    if (semSub.current) abrirPainel(deps).then(setTela, () => {})
  }, [deps])
  useEffect(() => {
    const espera = debounce(atualizar, 600)
    const parar = observar(espera)
    return () => { parar(); espera.cancelar() }
  }, [atualizar, observar])

  // O texto é lido da aba que o painel mostrou; estável enquanto a aba for a mesma.
  const abaId = tela?.tipo === 'pronto' ? tela.abaId : undefined
  const lerDaAba = useCallback(() => lerTexto(abaId as number), [lerTexto, abaId])

  if (!tela) return <main className="painel"><p className="meta">Verificando…</p></main>

  if (tela.tipo === 'sem_login') {
    return (
      <main className="painel">
        <p>Entre no sistema para usar a extensão.</p>
        <button onClick={() => executar('abrir_login')}>Entrar no sistema</button>
        <button className="secundario" onClick={carregar}>Verificar de novo</button>
      </main>
    )
  }

  if (tela.tipo === 'erro') {
    const m = MENSAGENS[tela.erro]
    return (
      <main className="painel">
        <p role="alert">{m.texto}</p>
        {m.acao === 'tentar_de_novo' && <button onClick={carregar}>Tentar de novo</button>}
        {m.acao === 'abrir_eproc' && <button onClick={() => executar('abrir_eproc')}>Abrir o eproc</button>}
        {m.acao === 'focar_eproc' && <button onClick={() => executar('focar_eproc')}>Ir para o eproc</button>}
        {m.acao === 'copiar_diagnostico' && (
          <button onClick={() => navigator.clipboard.writeText(diagnostico(tela.erro, VERSAO))}>Copiar diagnóstico</button>
        )}
        {m.acao !== 'tentar_de_novo' && <button className="secundario" onClick={carregar}>Verificar de novo</button>}
      </main>
    )
  }

  const { estado, email } = tela
  const origem = estado.processo && estado.instancia ? { eproc: estado.processo, instancia: estado.instancia } : undefined
  const fechar = () => setSub(null)
  if (sub?.t === 'analisar' && fonte && api && origem) {
    return <Analisar fonte={fonte} api={api} origem={origem} abrir={abrir} sair={fechar} />
  }
  if (sub?.t === 'advogado' && advogado) return <Advogado fonte={advogado} instancia={estado.instancia} sair={fechar} />
  if (sub?.t === 'texto' && api) {
    return <Precedentes lerTexto={lerDaAba} api={api} abrir={abrir} analisar={(texto) => setSub({ t: 'analisarTexto', texto })} sair={fechar} />
  }
  if (sub?.t === 'analisarTexto' && api) return <AnalisarTexto texto={sub.texto} api={api} origem={origem} abrir={abrir} sair={fechar} />
  return (
    <main className="painel">
      <p className="meta">{email}</p>
      <p>eproc do TJSC · {estado.instancia === '2g' ? '2º grau' : '1º grau'}</p>
      {estado.processo ? (
        <p>Processo aberto: <strong>{formatar(estado.processo)}</strong></p>
      ) : (
        <p className="meta">Nenhum processo aberto nesta aba.</p>
      )}
      {estado.processo && fonte && api && <button onClick={() => setSub({ t: 'analisar' })}>Analisar este processo</button>}
      {api && <button onClick={() => setSub({ t: 'texto' })}>Texto da tela do eproc</button>}
      {advogado && <button onClick={() => setSub({ t: 'advogado' })}>Intimações e prazos</button>}
      <button className="secundario" onClick={carregar}>Atualizar</button>
    </main>
  )
}
