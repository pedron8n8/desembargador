// Só isto. Quem orquestra é o painel (ver spec, "Arquitetura"): ele fica vivo
// enquanto aberto, e o service worker morre depois de ~30 s ocioso.
const abrirNoClique = () =>
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})
abrirNoClique()
chrome.runtime.onInstalled.addListener(abrirNoClique)

// O botão flutuante do agente (agente/lib/botao.ts) pede para abrir o painel. Só aceitamos
// pedido dos NOSSOS content scripts, e sem `await` antes: sidePanel.open precisa rodar no
// mesmo turno do gesto do usuário (o clique).
chrome.runtime.onMessage.addListener((msg, remetente) => {
  const tabId = remetente.tab?.id
  if (remetente.id === chrome.runtime.id && msg?.tipo === 'abrir_painel' && tabId !== undefined) {
    chrome.sidePanel.open({ tabId }).catch(() => {})
  }
})
