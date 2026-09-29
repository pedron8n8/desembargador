# Roteiro de captura no eproc do TJSC

Para fazer numa call com o advogado. Leva cerca de 20 minutos. O objetivo é gravar o tráfego de rede do
eproc do TJSC nos fluxos que a extensão vai usar. Nada é alterado no eproc: são só telas que o advogado já
abre no dia a dia.

## Antes de começar

1. Use o **Google Chrome**, já logado no eproc do TJSC (1º grau).
2. Tenha em mãos:
   - um processo **não sigiloso** com **mais de 100 eventos** e com **petição inicial e sentença (ou decisão)**
     nos autos;
   - se houver, um processo **não sigiloso no 2º grau** (eproc2g), para vermos a capa com o relator;
   - um **CPF** e um **CNPJ** de partes com processos no TJSC. Se der, um CNPJ com **mais de 30 processos**.
3. Abra o DevTools com **F12** e vá na aba **Network (Rede)**.
4. Marque **Preserve log (Preservar registro)**. Sem isso, o registro é apagado a cada tela nova.
5. Clique no ícone de lixeira (🚫) para limpar o que já estava ali.

**Grave tudo num arquivo só, na ordem abaixo, sem fechar o DevTools.** Anote o horário aproximado de cada passo
(pode ser no chat da call). Isso ajuda a separar os fluxos depois.

## Os passos

### 1. Processo com muitos eventos (1º grau)
1. Abra o processo com mais de 100 eventos.
2. Desça até a lista de eventos e clique na **página 2** da paginação.
3. **Anote:** a página 2 carregou sem recarregar a tela inteira?

### 2. Documentos
No mesmo processo:
1. Clique na **petição inicial** (evento 1 ou próximo dele).
2. Volte e clique numa **sentença ou decisão**.
3. **Anote:** o eproc pediu o **código de verificação (2FA)** ao abrir? Abriu em aba nova? Veio em PDF ou
   como página?

### 3. Busca por CPF e por CNPJ
1. Vá em **Consultar processo**.
2. Escolha a busca **por documento da parte** e pesquise o **CPF**.
3. Repita com o **CNPJ**. Se houver, use o que tem mais de 30 processos, e **anote** quantos resultados apareceram.
4. **Anote:** apareceu alguma verificação (captcha, imagem)?

### 4. Processo no 2º grau (se houver)
1. Abra o eproc do 2º grau e, nele, o processo.
2. Só a capa basta.
3. **Anote:** o endereço exato que aparece na barra (por exemplo, `eproc2g.tjsc.jus.br/...`).

### 5. Painel do advogado
1. Abra o **painel inicial do advogado**, a tela com intimações e prazos.
2. Se houver paginação ou filtro, clique uma vez.
3. **Não abra nenhuma intimação nova.** Abrir pode registrar ciência, e isso conta prazo.
   - Só se houver uma intimação **já lida** (com ciência já registrada), abra essa. Se tiver qualquer dúvida
     sobre ela já ter sido lida, **pule este item**.

### 6. Salvar
1. Na aba Network, clique com o botão direito em qualquer linha.
2. Escolha **Save all as HAR with content**. Nas versões novas do Chrome, a opção se chama **Export HAR
   (sanitized)**. Use a "sanitized", **não** a "with sensitive data".
3. Salve como `tjsc-eproc.har`.

## Cuidados com o arquivo

- A versão "sanitized" já tira cookies e senhas. Mesmo assim, o arquivo tem **nomes de partes e números de
  processo reais**.
- Envie por um canal privado (Drive com acesso restrito, por exemplo). Não mande em grupo nem por e-mail aberto.
- Quem recebe o arquivo guarda na raiz do projeto, onde o `*.har` está fora do git, e apaga depois de extrair
  as fixtures (que usam dados fictícios).

## Se sobrar tempo na call: testar a extensão (base)

Só se a base já estiver pronta e o advogado tiver conta no nosso sistema.

1. Em `chrome://extensions`, ligue o **Modo do desenvolvedor**, clique em **Carregar sem compactação** e escolha a
   pasta `frontend/extensao/dist`.
2. Entre no nosso sistema no mesmo Chrome.
3. Com o eproc aberto, clique no ícone da extensão e confira os quatro itens do checklist do spec da base
   (`docs/superpowers/specs/2026-09-29-eproc-extensao-base-design.md`, seção Testes).
4. Com uma aba do eproc aberta, clique em **Recarregar** no cartão da extensão em `chrome://extensions`, volte à aba
   e abra o painel: ele deve responder sem precisar atualizar a página do eproc (é o caso de atualização da extensão).
