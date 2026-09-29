// O manifest é gerado no build (vite.extensao.config.ts) porque a origem da
// nossa API muda entre dev e produção, e ela entra em host_permissions.
export const EPROC_HOSTS = ['https://eproc1g.tjsc.jus.br/*', 'https://eproc2g.tjsc.jus.br/*']

export function montarManifest(apiBase: string): chrome.runtime.ManifestV3 {
  let url: URL
  try {
    url = new URL(apiBase)
  } catch {
    throw new Error('EXT_API_BASE ausente ou inválida: ' + JSON.stringify(apiBase))
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('EXT_API_BASE tem de ser https (http só em localhost): ' + apiBase)
  }
  return {
    manifest_version: 3,
    name: 'Segundo Cérebro — eproc',
    version: '0.1.0',
    description: 'Analisa processos do eproc do TJSC com a sessão do próprio advogado.',
    minimum_chrome_version: '116',
    action: { default_title: 'Segundo Cérebro' },
    side_panel: { default_path: 'painel.html' },
    background: { service_worker: 'sw.js', type: 'module' },
    // Sem 'cookies': quem anexa o cookie do eproc é o próprio navegador, no
    // fetch de mesma origem do agente. A extensão nunca lê cookie nenhum.
    permissions: ['sidePanel', 'scripting'],
    host_permissions: [...EPROC_HOSTS, url.origin + '/*'],
    content_scripts: [{ matches: EPROC_HOSTS, js: ['agente.js'], run_at: 'document_idle' }],
  }
}
