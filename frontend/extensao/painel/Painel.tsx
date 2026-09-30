import { useCallback, useEffect, useState } from 'react'
import { Analisar } from './analisar/Analisar.tsx'
import type { ApiAnalise } from './analisar/apiAnalise.ts'
import type { Fonte } from './analisar/fonte.ts'
import { abrirAba, executar, depsChrome } from './chrome.ts'
import { abrirPainel, type Deps, type Tela } from './fluxo.ts'
import { diagnostico, MENSAGENS } from './mensagens.ts'

const VERSAO = chrome.runtime.getManifest().version
const formatar = (n: string) => n.replace(/^(\d{7})(\d{2})(\d{4})(\d)(\d{2})(\d{4})$/, '$1-$2.$3.$4.$5.$6')

// `deps`, `fonte`, `api` e `abrir` só são passados na página de demonstração (demo.tsx),
// que injeta um eproc e um servidor de mentira. No painel de verdade `fonte` fica
// indefinida até as primitivas de rede da B existirem, e sem ela o botão "Analisar"
// nem aparece: nenhum botão que não funciona.
type Props = { deps?: Deps; fonte?: Fonte; api?: ApiAnalise; abrir?: (url: string) => void }

export function Painel({ deps = depsChrome, fonte, api, abrir = abrirAba }: Props) {
  const [tela, setTela] = useState<Tela | null>(null)
  const [analisando, setAnalisando] = useState(false)
  const carregar = useCallback(() => {
    setTela(null)
    abrirPainel(deps).then(setTela, () => setTela({ tipo: 'erro', erro: 'LAYOUT' }))
  }, [deps])
  useEffect(carregar, [carregar])

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
  if (analisando && fonte && api && estado.processo && estado.instancia) {
    return (
      <Analisar fonte={fonte} api={api} origem={{ eproc: estado.processo, instancia: estado.instancia }}
        abrir={abrir} sair={() => setAnalisando(false)} />
    )
  }
  return (
    <main className="painel">
      <p className="meta">{email}</p>
      <p>eproc do TJSC · {estado.instancia === '2g' ? '2º grau' : '1º grau'}</p>
      {estado.processo ? (
        <p>Processo aberto: <strong>{formatar(estado.processo)}</strong></p>
      ) : (
        <p className="meta">Nenhum processo aberto nesta aba.</p>
      )}
      {estado.processo && fonte && api && <button onClick={() => setAnalisando(true)}>Analisar este processo</button>}
      <button className="secundario" onClick={carregar}>Atualizar</button>
    </main>
  )
}
