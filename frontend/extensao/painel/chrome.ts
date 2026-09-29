import { get } from '../../src/api.ts'
import { EPROC_HOSTS } from '../manifest.ts'
import type { Acao } from './mensagens.ts'
import type { Deps } from './fluxo.ts'

const EPROC_RE = /^https:\/\/eproc[12]g\.tjsc\.jus\.br\//
const AGENTE_AUSENTE = /Receiving end does not exist|Could not establish connection/i

async function esperarCarregar(id: number, limiteMs = 40000) {
  const inicio = Date.now()
  while (Date.now() - inicio < limiteMs) {
    const aba = await chrome.tabs.get(id)
    // 'complete' sozinho não basta: aba recém-criada reporta complete da
    // about:blank antes de navegar (armadilha 1 do guia).
    if (aba.status === 'complete' && EPROC_RE.test(aba.url ?? '')) return
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error('o eproc demorou demais para abrir')
}

export const depsChrome: Deps = {
  eu: () => get<{ email: string }>('/api/eu'),
  async abasEproc() {
    const abas = await chrome.tabs.query({ url: EPROC_HOSTS })
    return abas.filter((a) => a.id !== undefined).map((a) => ({ id: a.id!, ativa: a.active, descartada: a.discarded }))
  },
  async recarregar(id) {
    await chrome.tabs.reload(id)
    await esperarCarregar(id)
  },
  async enviar(id, msg) {
    try {
      return await chrome.tabs.sendMessage(id, msg)
    } catch (e) {
      // Aba aberta antes de instalar/atualizar a extensão não tem o agente.
      if (!AGENTE_AUSENTE.test(String((e as Error)?.message))) throw e
      await chrome.scripting.executeScript({ target: { tabId: id }, files: ['agente.js'] })
      return await chrome.tabs.sendMessage(id, msg)
    }
  },
}

export async function executar(acao: Acao) {
  const base = import.meta.env.VITE_API_BASE as string
  if (acao === 'abrir_login') await chrome.tabs.create({ url: base + '/' })
  if (acao === 'abrir_eproc') await chrome.tabs.create({ url: 'https://eproc1g.tjsc.jus.br/' })
  if (acao === 'focar_eproc') {
    const [aba] = await chrome.tabs.query({ url: EPROC_HOSTS })
    if (aba?.id !== undefined) await chrome.tabs.update(aba.id, { active: true })
    else await chrome.tabs.create({ url: 'https://eproc1g.tjsc.jus.br/' })
  }
}
