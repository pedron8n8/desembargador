import { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/estilo/tokens.css'
import './painel.css'
import { fonteAdvogadoDemo } from './advogado/demo-advogado.ts'
import { apiDemo, fonteDemo } from './analisar/demo-analise.ts'
import { cenarios } from './demo-cenarios.ts'
import { apiSistemaDemo } from './sistema/demo-sistema.ts'
import { Painel } from './Painel.tsx'

// Texto de MENTIRA que o painel "leria" da tela do eproc na demonstração, com um CPF e uma OAB
// fictícios para a minimização aparecer. Nada aqui toca o eproc.
const TEXTO_DEMO = {
  texto: 'A apelante, EMPRESA EXEMPLO LTDA (CNPJ [CNPJ]), por seu advogado ([OAB]), requer a exclusão do ICMS da base de cálculo do PIS e da Cofins, conforme a tese firmada pelo Supremo Tribunal Federal, e a restituição dos valores recolhidos a maior nos últimos cinco anos.',
  fonte: 'selecao' as const,
  cortado: false,
}
const lerTextoDemo = async () => TEXTO_DEMO
const semObservar = () => () => {}

// Página de demonstração: só entra no build com EXT_DEMO=1 (ver
// vite.extensao.config.ts). É o painel de verdade com dados fictícios, para
// apresentar sem login no sistema e sem eproc.
function Demo() {
  const lista = useMemo(() => cenarios(), [])
  const fonte = useMemo(() => fonteDemo(), [])
  const api = useMemo(() => apiDemo(), [])
  const advogado = useMemo(() => fonteAdvogadoDemo(), [])
  const sistema = useMemo(() => apiSistemaDemo(), [])
  const [i, setI] = useState(0)
  return (
    <div style={{ display: 'flex', gap: 32, padding: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div style={{ maxWidth: 360 }}>
        <p style={{ margin: '0 0 12px', color: 'var(--alerta)' }}>
          <strong>DEMONSTRAÇÃO</strong> · dados fictícios. Nada aqui consulta o eproc nem o nosso sistema.
        </p>
        <div style={{ display: 'grid', gap: 6 }}>
          {lista.map((c, k) => (
            <button
              key={c.id}
              onClick={() => setI(k)}
              aria-pressed={i === k}
              className={i === k ? undefined : 'secundario'}
              style={{ textAlign: 'left', padding: '6px 12px', cursor: 'pointer', border: '1px solid var(--selo)',
                background: i === k ? 'var(--selo)' : 'transparent', color: i === k ? 'var(--papel)' : 'var(--selo)' }}
            >
              {c.nome}
            </button>
          ))}
        </div>
      </div>
      <div style={{ width: 344, border: '1px solid var(--linha-forte)', background: 'var(--papel)' }}>
        <Painel key={lista[i].id} deps={lista[i].deps} fonte={fonte} api={api} advogado={advogado} sistema={sistema} lerTexto={lerTextoDemo} observar={semObservar} abrir={() => {}} />
      </div>
    </div>
  )
}

createRoot(document.getElementById('raiz')!).render(<Demo />)
