import { responder } from './lib/despacho.ts'

// Guarda contra listener duplicado: o manifest injeta este arquivo, e o painel
// reinjeta com chrome.scripting.executeScript em aba aberta antes da instalação.
const g = globalThis as { __agenteEprocSegundoCerebro?: boolean }
if (!g.__agenteEprocSegundoCerebro) {
  g.__agenteEprocSegundoCerebro = true
  chrome.runtime.onMessage.addListener((msg, _remetente, responderAoPainel) => {
    const pronto = responder(msg, document, location.href)
    pronto.then((r) => r && responderAoPainel(r))
    // true mantém o canal aberto para a resposta assíncrona — mas só quando a
    // mensagem é nossa, senão o remetente espera para sempre.
    return (msg as { tipo?: unknown } | null)?.tipo === 'estado'
  })
}
