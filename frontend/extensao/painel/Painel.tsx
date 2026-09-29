import { useCallback, useEffect, useState } from 'react'
import { executar, depsChrome } from './chrome.ts'
import { abrirPainel, type Tela } from './fluxo.ts'
import { diagnostico, MENSAGENS } from './mensagens.ts'

const VERSAO = chrome.runtime.getManifest().version
const formatar = (n: string) => n.replace(/^(\d{7})(\d{2})(\d{4})(\d)(\d{2})(\d{4})$/, '$1-$2.$3.$4.$5.$6')

export function Painel() {
  const [tela, setTela] = useState<Tela | null>(null)
  const carregar = useCallback(() => {
    setTela(null)
    abrirPainel(depsChrome).then(setTela, () => setTela({ tipo: 'erro', erro: 'LAYOUT' }))
  }, [])
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
  return (
    <main className="painel">
      <p className="meta">{email}</p>
      <p>eproc do TJSC · {estado.instancia === '2g' ? '2º grau' : '1º grau'}</p>
      {estado.processo ? (
        <p>Processo aberto: <strong>{formatar(estado.processo)}</strong></p>
      ) : (
        <p className="meta">Nenhum processo aberto nesta aba.</p>
      )}
      <button className="secundario" onClick={carregar}>Atualizar</button>
    </main>
  )
}
