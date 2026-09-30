# Extensão eproc — features futuras

Levantamento de 29/09/2026. Serve de estoque de ideias: nada aqui está aprovado nem especificado, exceto o que
consta como "em andamento".

**Como ler.** Esforço: P, M ou G. Valor: ★ a ★★★ (estimativa). **[HAR]** = depende de captura de tráfego do eproc
do TJSC (só temos o HAR e o guia da JFRS). Os fatos do eproc vêm de `eproc_guia_tecnico_extensao.md` (fora do
git, contém dados reais de processo).

## Em andamento (specs aprovados em `docs/superpowers/specs/`)

| Sub | Feature | Esforço | Valor | Notas |
|---|---|---|---|---|
| A | Base da extensão (painel, agente, guardas) | – | – | **Implementada** no branch `eproc-extensao`; falta o teste manual no Chrome |
| B | Analisar este processo | G | ★★★ | Monta o caso a partir da capa e das peças-chave e roda a consulta. [HAR] eventos, documento, 2FA |
| C | Busca por CPF/CNPJ | M | ★★ | Fluxo já validado na JFRS. [HAR] TJSC |
| D | Painel do advogado (intimações e prazos) | M | ★★ | Depende totalmente de [HAR] |
| E | Pedidos sob demanda durante a consulta | G | ★ | O servidor pede uma peça faltante. Só depois da B |

## Análise do processo aberto (sobre a B)

| Feature | Esforço | Valor | Notas |
|---|---|---|---|
| Só o prognóstico, sem minuta | P | ★★★ | O sistema já tem `so_prognostico`: rápido e barato, ideal para o painel |
| Conversa sobre o processo no painel | M | ★★ | Reaproveita as mensagens da consulta |
| Nota e "precedente útil/inútil" no painel | P | ★ | Alimenta o feedback existente |
| Resumo e linha do tempo em linguagem simples | M | ★★ | LLM sobre os eventos, sem precedentes; custo por processo |
| Extração de dados da petição (valor da causa, pedidos, datas) | M | ★★ | LLM; vira campos para conferir |
| Gerar minuta (recurso ou contrarrazões) a partir do processo | G | ★★★ | A minuta já existe no pipeline; sai como arquivo local, sem escrever no eproc |
| Comparar o processo com outros do acervo (rede de precedentes) | P | ★ | Abre o site na consulta certa |
| Análise em lote de processos marcados | G | ★★ | Precisa da D; cuidado com custo e ritmo |
| Escolha automática do cérebro pelo relator | P | ★★ | Já previsto na B |

## Leitura do eproc

| Feature | Esforço | Valor | Notas |
|---|---|---|---|
| Buscar por número do processo | P | ★★ | Há uma ação de busca por número. [HAR] |
| Eventos filtrados (só decisões e sentenças) | P | ★★ | O eproc já filtra na própria tela. [HAR] |
| Processos relacionados (conexos, recurso ↔ origem) | M | ★★ | Há um bloco de relacionados na tela do processo. [HAR] |
| Perfil de litigância de uma parte | M | ★★ | Usa a busca por CPF/CNPJ; o polo é o ponto difícil |
| Checagem de conflito ao receber cliente novo | P | ★★ | CPF/CNPJ como parte adversa em processos do escritório |
| Mostrar suspensões e feriados do processo | P | ★ | Só exibe, sem calcular prazo |
| Exportar lista ou eventos para planilha | P | ★★ | Só dados públicos |
| Baixar peças e montar dossiê local | M | ★★ | [HAR] documento e 2FA; cuidado com volume e ritmo |
| Acompanhar processos e ver o que mudou | M | ★★ | Só atualiza ao abrir o painel, sem segundo plano |

## Dentro da página do eproc

| Feature | Esforço | Valor | Notas |
|---|---|---|---|
| Selecionar texto de uma peça e buscar precedentes | P | ★★★ | Menu de contexto; **não depende de nenhuma tela do TJSC** |
| Botão "Analisar" injetado na tela do processo | M | ★★ | Mexe no DOM do eproc; quebra quando o layout mudar |
| Analisar o documento aberto (decisão ou petição em HTML) | M | ★★ | Reaproveita a extração de texto |
| Painel que acompanha troca de aba e navegação | P | ★★ | Hoje só atualiza pelo botão "Atualizar" |

## Ligação sistema ↔ eproc

| Feature | Esforço | Valor | Notas |
|---|---|---|---|
| Histórico de consultas por processo no site | P | ★★ | O campo `origem` da B já permite |
| Lista de processos acompanhados no sistema | M | ★★ | Base para o acompanhamento de mudanças |
| Outras seções (JFRS, JFSC, JFPR) e TRF4 | M | ★ | Adicionar hosts; o acervo de precedentes hoje é só do TJSC |

## Escrita no eproc (fora do escopo atual)

| Feature | Notas |
|---|---|
| Peticionar ou juntar minuta pelo MNI (serviço do CNJ) | Exige credencial ou certificado do advogado; risco jurídico alto; projeto próprio |
| Cadastrar lembrete, etiqueta ou localizador | Escrita leve, mas escrita; decidir depois |

## Plataforma e produto

| Feature | Esforço | Notas |
|---|---|---|
| Ícones, ficha e revisão da Chrome Web Store | P | Obrigatório antes de publicar |
| Cadastro aberto, contas por escritório, cobrança e teto de gasto | G | O "F" que separamos; só se abrirmos para outros escritórios |
| Teste ponta a ponta com Chromium e eproc falso | M | Vale a partir da B |
| Onboarding no primeiro uso | P | |
| Acessibilidade do painel (foco, leitores de tela, alto contraste) | P | Itens menores deixados na revisão da base |
| Feedback ao copiar o diagnóstico; tratar falha de cópia | P | Menor, deixado para depois |
| Suporte ao Edge | P | Quase de graça (Chromium) |
| Checagem de origem em `rede.ts` antes de buscar links vindos do HTML do eproc | P | Segurança: fazer antes de a B começar a seguir links |
| Ajuste automático de seletores quando o eproc mudar | G | Código remoto é proibido, só configuração; não recomendado agora |

## Obrigações da leitura real

Dependem do eproc real (HAR); a base atual não as resolve.

- **Sigilo no texto da tela:** `agente/lib/texto.ts` deve detectar o marcador de sigilo da tela e devolver `ErroEproc` `SIGILOSO`. Até lá, sem seleção o painel exige a confirmação do advogado.
- **Abas (M1):** `observarAba` dispara em qualquer aba (não só do eproc) e `abasEproc` cai em `abas[0]` quando nenhuma está ativa; a leitura real deve olhar só a aba ativa da janela e ignorar mudanças de outras.
- **Iframes (M2):** o agente roda só no frame de topo; se o eproc renderizar o processo em iframes, será preciso `all_frames` no manifest e escolher/mesclar o frame certo (hoje `document.body.innerText` e a seleção não entram nos iframes).

## Não fazer (e por quê)

- **Abrir ou marcar intimação:** registra ciência e conta prazo.
- **Resolver ou contornar captcha:** regra do projeto.
- **Alimentar o acervo de precedentes com processos do eproc:** o acervo vem de jurisprudência pública; processo do
  eproc tem partes, sigilo e LGPD.
- **Copiar a sessão do eproc para o nosso servidor:** descartado na decisão de arquitetura.
- **Calcular prazo processual por conta própria:** responsabilidade jurídica que decidimos não assumir.

## Ordem sugerida

1. **B**, com a variante só-prognóstico (onde o sistema mais economiza trabalho; depende do HAR do TJSC).
2. **Selecionar texto → buscar precedentes** (independente do resto e do eproc do TJSC).
3. **C** com o perfil de litigância (barata; o guia já tem o fluxo).
