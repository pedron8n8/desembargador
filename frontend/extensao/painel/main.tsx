import { createRoot } from 'react-dom/client'
import '../../src/estilo/tokens.css'
import './painel.css'
import { apiReal } from './analisar/apiReal.ts'
import { apiSistemaReal } from './sistema/apiSistemaReal.ts'
import { Painel } from './Painel.tsx'

// `api` real liga "Texto da tela do eproc" (busca de precedentes e análise do texto). Os botões
// que dependem da leitura do eproc (`fonte`, `advogado`) seguem ausentes até existirem.
createRoot(document.getElementById('raiz')!).render(<Painel api={apiReal} sistema={apiSistemaReal} />)
