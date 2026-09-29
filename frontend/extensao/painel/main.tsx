import { createRoot } from 'react-dom/client'
import '../../src/estilo/tokens.css'
import './painel.css'
import { Painel } from './Painel.tsx'

createRoot(document.getElementById('raiz')!).render(<Painel />)
