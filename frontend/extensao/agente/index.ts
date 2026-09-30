import { montarBotao } from './lib/botao.ts'
import { ehPedido, responder } from './lib/despacho.ts'

// Guarda contra listener duplicado: o manifest injeta este arquivo, e o painel
// reinjeta com chrome.scripting.executeScript em aba aberta antes da instalação.
// O nome da flag está duplicado em painel/chrome.ts (enviar); mudar os dois juntos.
const g = globalThis as { __agenteEprocSegundoCerebro?: boolean }
if (!g.__agenteEprocSegundoCerebro) {
  g.__agenteEprocSegundoCerebro = true
  // O que o agente sabe ler da página para o pedido de texto: a seleção e o texto visível.
  const leitor = {
    selecao: () => String(globalThis.getSelection?.() ?? ''),
    pagina: () => document.body?.innerText ?? '',
  }
  chrome.runtime.onMessage.addListener((msg, _remetente, responderAoPainel) => {
    const pronto = responder(msg, document, location.href, leitor)
    pronto.then((r) => r && responderAoPainel(r))
    // true mantém o canal aberto para a resposta assíncrona — mas só quando a
    // mensagem é nossa, senão o remetente espera para sempre.
    return ehPedido(msg)
  })
  // Botão flutuante que abre o painel lateral (o service worker faz o sidePanel.open).
  montarBotao(document, () => {
    // Pode lançar de forma síncrona ('Extension context invalidated', extensão recarregada).
    try {
      chrome.runtime.sendMessage({ tipo: 'abrir_painel' }).catch(() => {})
    } catch {
      // sem extensão viva não há painel para abrir
    }
  })
}
