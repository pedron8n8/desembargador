// Só isto. Quem orquestra é o painel (ver spec, "Arquitetura"): ele fica vivo
// enquanto aberto, e o service worker morre depois de ~30 s ocioso.
const abrirNoClique = () =>
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})
abrirNoClique()
chrome.runtime.onInstalled.addListener(abrirNoClique)
