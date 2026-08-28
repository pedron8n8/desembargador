# Linguagem visual

Referência: publicação jurídica e jornal de formato grande. Papel quente, tinta,
**um acento só**, medida generosa. O produto é lido por advogado sênior, e o
teste final é este:

> **Imprima `/consulta/:thread` em PDF pelo Chrome. Se não ler como documento, o
> design falhou.**

## Proibido

Esta lista existe porque o padrão da indústria vai voltando sorrateiramente, um
componente por vez. `npm run lint:css` faz valer a parte que dá para automatizar.

- roxo, violeta, índigo — em qualquer lugar
- gradiente de qualquer tipo
- acento neon ou saturado; **mais de uma cor de acento**
- glassmorphism, `backdrop-filter`, painel translúcido
- `box-shadow`, glow, qualquer sistema de elevação
- `border-radius` acima de 2px
- balão de chat em pílula, avatar, ícone de robô, ✨
- animação de "digitando"
- emoji em qualquer superfície do produto
- shimmer, skeleton pulsante — **este produto tem progresso de verdade** (o SSE
  entrega nó a nó). Esqueleto falso aqui é pior que inútil: substitui informação
  real por teatro.
- layout de marketing (hero centralizado, CTA grande)
- botão só com ícone, sem rótulo

## Cor

Um acento (`--selo`, verde-garrafa dessaturado) e uma cor de alerta
(`--alerta`, terracota). As cores de resultado processual são de dado, não de
marca: sépia para reforma, ardósia para manutenção, cinza para processual.

Sem modo escuro na v1. É decisão, não esquecimento: jornal não tem modo escuro,
e ele dobraria o QA visual de cada gráfico.

## Tipografia

O texto jurídico é serifado; o cromo de interface é sem serifa; número de
processo e consulta FTS5 são monoespaçados.

A v1 usa **pilha de sistema** (`Charter, Georgia` para o corpo). Nenhuma fonte é
baixada de CDN — as consultas são confidenciais e não se vaza nem o referrer.

> **Uma exceção, e só uma:** `/apresentacao` carrega Fira Sans do Google Fonts,
> e apenas dentro das caixas dos diagramas. A apresentação é comercial, é aberta
> na frente de alguém e não tem consulta a proteger. O `<link>` é injetado em
> tempo de execução por `paginas/Apresentacao.tsx`, **não** pelo `index.html`,
> justamente para que o produto nunca toque em `fonts.googleapis.com`. Se essa
> injeção migrar para o HTML, a regra acima passa a estar quebrada.
Para trocar por Source Serif 4 self-hosted: coloque os `.woff2` em
`public/fontes/`, declare `@font-face` em `estilo/tokens.css` e ponha a família
na frente de `--fonte-serif`. Nada mais no código muda.

- corpo jurídico 18px / 1.62, medida travada em `68ch`
- interface 14px, pesos 400 e 500 — **nunca 700 em cromo**
- `font-variant-numeric: tabular-nums` em toda tabela e todo número que alinha

## Gráficos

- sem malha de grade — uma régua de base e nada mais
- rótulo direto no traço em vez de legenda, sempre que couber
- zero animação de entrada
- a faixa "NÃO DECIDO" é uma região **hachurada**, não um alerta vermelho: é o
  comportamento correto do sistema, não uma falha

## Ordem que não é estética

`/consulta/:thread` abre em **Evidências**. O prognóstico vem depois, sempre.
Quem lê o percentual primeiro ancora nele e lê o resto procurando confirmação —
é a mesma razão pela qual `cli.formatar` monta o markdown nessa ordem. Não
reordene as abas por conveniência de layout.
