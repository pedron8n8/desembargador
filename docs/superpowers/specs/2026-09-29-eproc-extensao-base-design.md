# Extensão eproc — base (subprojeto A)

Data: 29/09/2026. Status: aprovado em 29/09/2026.

## Contexto e objetivo

O sistema passa a funcionar como uma extensão do eproc: quando precisar de algo que está no eproc, lê com a
sessão que o advogado já abriu no próprio Chrome, sem novo login e sem que cookies ou credenciais saiam do
navegador.

Um site no nosso domínio não consegue fazer isso sozinho (same-origin e CORS impedem ler cookies do eproc e
chamar o eproc com eles), e o eproc não tem API REST: as ações usam URLs assinadas por um `hash` gerado pelo
servidor e entregue no HTML (ver `eproc_guia_tecnico_extensao.md`, seção 4, fora do git). Por isso a peça que
lê o eproc é uma extensão Chrome MV3 rodando na aba do eproc, com `fetch` de mesma origem.

O trabalho foi dividido em subprojetos, cada um com seu spec:

| # | Subprojeto |
|---|---|
| 0 | HARs do eproc do TJSC (paginação de eventos, `acessar_documento`, 2FA, busca CPF/CNPJ, painel do advogado) |
| **A** | **Base (este spec)** |
| B | "Analisar este processo" |
| C | Busca por CPF/CNPJ |
| D | Painel do advogado |
| E | Pedidos sob demanda do servidor durante a consulta |

Fora de todos: escrever no eproc (peticionar, movimentar). Quando chegar a vez, investigar o MNI.

A base não entrega capacidade ao advogado. Entrega o esqueleto que B, C e D preenchem: extensão instalável,
painel lateral, agente eproc com a infraestrutura de requisição e as guardas, e a ligação com a nossa conta.

## Decisões de produto

1. **Uso:** o advogado usa o sistema no mesmo Chrome em que está logado no eproc. O sistema aparece dentro do
   eproc como painel lateral da extensão; o site continua existindo.
2. **Distribuição:** Chrome Web Store **pública**, mas **contas fechadas**: a extensão só funciona com conta
   criada por nós (`python -m api.usuarios --criar`). Cadastro aberto seria outro subprojeto.
3. **Painel enxuto:** processo da aba atual, botões das capacidades, progresso e prognóstico resumido. O que
   é pesado (rede, árvore, conversa, histórico) abre o site numa aba nova, já na consulta certa.
4. **Sigilo nunca sai:** processo ou documento em sigilo não é enviado ao servidor. Em listas, vira contagem.
5. **Só leitura:** nenhuma primitiva altera estado no eproc.

## Arquitetura

Abordagem escolhida: **o painel orquestra.** A página React do painel pede dados ao agente na aba do eproc
(`chrome.tabs.sendMessage`) e fala com a nossa API por `fetch`. O painel fica vivo enquanto está aberto, o que
evita o encerramento do service worker por inatividade (~30 s). Com o painel fechado nada acontece, o que é
coerente com "o advogado está presente".

Descartadas: service worker como orquestrador (precisa de pulso contra a inatividade e espalha o estado) e o
site como orquestrador via `externally_connectable` (não coloca o sistema dentro do eproc; pode ser somado
depois).

O agente não abre aba auxiliar: um content script tem `DOMParser`, então ele baixa com `fetch` o HTML da tela
de que precisa, faz o parse e lê as URLs assinadas. Basta haver uma aba do eproc aberta e logada.

### Componentes

Pasta nova `extensao/`, com build Vite próprio que importa de `../frontend/src` (`api.ts`, tokens de estilo,
componentes que servirem). No site, a única mudança é a página estática `/privacidade` (ver "Exigências da
loja").

| Peça | Arquivo | Responsabilidade | Usa `chrome.*` |
|---|---|---|---|
| Manifest | `extensao/manifest.json` | Permissões (abaixo) | – |
| Service worker | `extensao/sw.ts` | `setPanelBehavior({openPanelOnActionClick: true})` no load e no `onInstalled`. Nada mais | sim |
| Agente eproc | `extensao/agente/index.ts` | Content script. Registra o listener de mensagens (com guarda global contra registro duplo) e despacha para as primitivas. Na base, só `estado()` | sim, só aqui |
| Miolo do agente | `extensao/agente/lib/*.ts` | Lógica pura, testável em Node | não |
| Painel | `extensao/painel/*.tsx` | React. Orquestra agente e API, mostra estado e erros | sim |

Miolo (`extensao/agente/lib/`):

- `rede.ts`: `postar(url, pares)` e `baixarPagina(url)`. `fetch` de mesma origem com `credentials:
  "same-origin"`, `X-Requested-With: XMLHttpRequest`, timeout de 25 s. Corpo como `URLSearchParams` de lista de
  pares (aceita chave repetida). Decodifica bytes em UTF-8 estrito e recua para `windows-1252`. Detecta sessão
  caída (HTML com `input[type=password]` ou redirecionamento para `index.php` / `externo_controlador.php`),
  401/403, 5xx e JSON inválido. Uma fila única: uma requisição ao eproc por vez, com intervalo mínimo entre
  elas (valor inicial 1 s).
- `captcha.ts`: interpreta a resposta de `verifica_estado_captcha`. Só passa com `captcha_imagem === "false"`
  e `codigo_validade === 1`; qualquer outra coisa é `CAPTCHA`. Nunca tenta resolver.
- `sigilo.ts`: `id_sigilo !== "0"` em itens de lista, e "Nível N" com N > 0 no `title` de documentos, viram
  `SIGILOSO`. Em listas, separa públicos de uma contagem de sigilosos.
- `estado.ts`: a partir de um `Document`, devolve `{logado, instancia, usuario, processo}`. `processo` é o
  número de 20 dígitos quando a página é um detalhe de processo, senão `null`. Só lê o DOM, não faz requisição.
- `erros.ts`: conjunto fechado `NAO_LOGADO | CAPTCHA | LAYOUT | EPROC_FORA | SIGILOSO | SEM_ABA_EPROC`.

Primitivas que B, C e D acrescentarão (`processo`, `eventos`, `documento`, `buscarPorDocumento`,
`painelAdvogado`) passam obrigatoriamente por `rede.ts` e `sigilo.ts`.

### Manifest

- `permissions`: `sidePanel`, `scripting`.
- `host_permissions`: domínios do eproc do TJSC (`https://eproc1g.tjsc.jus.br/*`, `https://eproc2g.tjsc.jus.br/*`,
  a confirmar no subprojeto 0) e o domínio do nosso sistema.
- `content_scripts`: `agente` nos domínios do eproc, `run_at: document_idle`.
- Sem `cookies`, sem `tabs`, sem `<all_urls>`. `chrome.tabs.query({url})` funciona para hosts cobertos por
  `host_permissions`.
- Nenhum código remoto; fontes embutidas no pacote.

## Fluxo de dados

Abrir o painel (único fluxo completo da base):

1. Painel chama `GET /api/eu` na nossa API. O cookie `sessao` vai automaticamente. 401 → "Entre no sistema",
   com botão que abre o login do site.
2. Painel procura a aba do eproc com `chrome.tabs.query` nos domínios do TJSC. Nenhuma → `SEM_ABA_EPROC`. Aba
   com `discarded` → `chrome.tabs.reload` e espera `status === "complete"` **com a URL já no domínio do eproc**.
3. Painel envia `estado` ao agente. Se a mensagem falhar com "Receiving end does not exist", injeta o agente com
   `chrome.scripting.executeScript` e reenvia uma vez. `logado: false` → `NAO_LOGADO`.
4. Painel mostra usuário do eproc, instância e processo aberto, se houver.

**Backend: nenhuma mudança na base.** `/api/eu` já existe (`api/app.py:164`). Em métodos mutantes a extensão
manda `x-requerido-por: web` (exigido em `api/app.py:90`).

**Risco nº 1:** o cookie `sessao` é HttpOnly e `SameSite=Lax`. O Chrome deve tratar requisição de extensão
para host coberto por `host_permissions` como same-site, mas isso precisa ser confirmado no primeiro passo da
implementação. **Plano B**, só se falhar: token por instalação, gerado numa tela do site logado, guardado em
`chrome.storage.local` e enviado num cabeçalho; revogável; a API aceita cookie ou token.

**O que sai da aba do eproc:** só dado limpo e já filtrado por sigilo, e só para o painel. Cookies, hashes e URLs
assinadas nunca saem. Na base o painel não envia dado do eproc à nossa API.

## Erros na tela

| Erro | Mensagem | Ação |
|---|---|---|
| 401 da nossa API | "Entre no sistema para usar a extensão." | Abrir o login do site |
| `SEM_ABA_EPROC` | "Abra o eproc do TJSC e faça login." | Abrir o eproc numa aba nova |
| `NAO_LOGADO` | "Sua sessão no eproc caiu. Entre de novo no eproc." | Focar a aba do eproc |
| `CAPTCHA` | "O eproc pediu uma verificação. Faça uma consulta manual na aba do eproc e tente de novo." | Tentar de novo |
| `SIGILOSO` | "Este processo está em sigilo. Por segurança, a extensão não envia processos sigilosos para análise." | Nenhuma |
| `LAYOUT` | "O eproc mudou e a extensão não reconheceu a tela. Avise o suporte." | Copiar diagnóstico **sem dados do processo** (versão da extensão, primitiva, seletor que falhou) |
| `EPROC_FORA` / timeout | "O eproc não respondeu." | Tentar de novo |

`LAYOUT` nunca vira "lista vazia" nem "nenhum processo". Enquanto uma chamada roda, o botão que a disparou fica
desabilitado.

## Exigências da loja pública

- Permissões mínimas, como acima.
- Página `/privacidade` no nosso site listando exatamente o que sai do navegador e para onde. Na base: "nada
  além de verificar a sua conta". Cada capacidade acrescenta sua linha quando for entregue. Deixa explícito que
  cookies e credenciais do eproc nunca saem do navegador e que processos sigilosos não são enviados.
- Justificativa de propósito único: "ler, com a sessão do próprio advogado, dados de processos no eproc para
  análise no nosso sistema".
- Declarações de dados: "conteúdo do site" coletado só quando o advogado aciona uma capacidade; sem venda, sem
  anúncios.

## Testes

1. **Miolo puro com `node --test`**, sem dependência (o Node 25 roda `.ts` direto). Um `*.test.ts` por módulo
   de `extensao/agente/lib/`:
   - `rede`: `fetch` falso com ISO-8859-1 e acento cru, HTML de login no lugar de JSON, redirecionamento para
     `index.php`, 503, timeout, chave repetida preservada no corpo, fila serializando chamadas.
   - `captcha`: sem desafio passa; cada variação (`captcha_imagem: "true"`, `codigo_validade: 2`, campo
     ausente) vira `CAPTCHA`.
   - `sigilo`: `id_sigilo` `"0"` e `"1"`; `title` com "Nível 0" e "Nível 2"; lista mista gera públicos e
     contagem.
   - `estado`: logado com processo aberto, logado sem processo, tela de login.
2. **Fixtures fictícias** escritas à mão (CNPJ `11.222.333/0001-81`, processo `5001234-56.2020.4.04.7100`),
   versionadas. HAR real nunca entra no git (`*.har` no `.gitignore`). Se houver `*.har` na raiz, um teste extra
   roda o parse contra ele; se não houver, é pulado e diz isso.
3. **`tsc --noEmit` e build Vite da extensão** entram no `verificar.bat`.
4. **Checklist manual no Chrome real**, com a extensão carregada sem compactação e o eproc do TJSC:
   1. O cookie `sessao` vai na chamada do painel a `/api/eu` (senão, plano B do token).
   2. O painel abre pelo ícone; sem aba do eproc aparece `SEM_ABA_EPROC`; aba aberta antes da instalação
      funciona (reinjeção).
   3. Logado no eproc com um processo aberto: o painel mostra usuário, instância e número.
   4. Logout no eproc → `NAO_LOGADO`.

Fora da base: teste ponta a ponta automatizado com Chromium e eproc falso (exigiria reintroduzir o
Playwright; vale a partir de B).

**Pronto quando:** `node --test` e build verdes e os quatro itens do checklist confirmados no eproc do TJSC.

## Perguntas em aberto que não bloqueiam a base

- Domínios exatos do eproc do TJSC e se a estrutura de DOM é a mesma da JFRS (subprojeto 0). Afeta só
  `host_permissions` e os seletores de `estado.ts`, que serão ajustados com o HAR.
- Onde `estado.ts` encontra o nome do usuário logado no DOM do TJSC (o HAR da JFRS não mostra o cabeçalho da
  página com clareza). Até o HAR do TJSC chegar, `usuario` pode ser `null` sem quebrar nada.
