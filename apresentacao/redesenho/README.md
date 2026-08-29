# apresentacao/redesenho/

Redesenho da apresentação do DrSec, em um `index.html` **único e autocontido**.

## O que é

Uma versão visual nova da apresentação (a "fatia vertical polida"), pensada como
scrollytelling: capa, o precedente (Harvard), o gabinete (fluxo de hoje x com o
DrSec), o cérebro (cascata em fundo escuro, cada estágio acende ao rolar), a
floresta de decisão (uma das árvores da random forest), dentro do eproc
(localizadores), a prova (confronto elemento a elemento) e o fechamento.

O arquivo não chama servidor nenhum: as imagens estão embutidas como data URI e a
única dependência externa é o Google Fonts. Abre no navegador, de um pendrive ou
como anexo. Para editar, basta abrir o `index.html` num editor.

## De onde vêm os dados

Os números e os textos de dados saem dos JSON reais gerados por
`apresentacao/montar.py` (`apresentacao/dados/apresentacao.json`,
`grafo.json`, `confronto.json`). Nenhum número foi digitado à mão.

## Relação com o resto da pasta

- `artefato.py` gera o HTML único a partir do build React
  (`frontend/dist-artefato/apresentacao.html`). Este redesenho é **paralelo** a
  esse pipeline: é um HTML escrito à parte, ainda **não portado** para o app React
  (`frontend/src/paginas/Apresentacao.tsx`). O próximo passo natural, se este
  visual for aprovado, é portá-lo para lá, para entrar na rota `/apresentacao`
  atrás da senha, como o resto.
- Enquanto não é portado, este arquivo serve como fonte de verdade do visual e
  para mostrar a apresentação sem subir o sistema todo.

## Regras respeitadas (não quebrar ao editar)

- Zero travessão (—) em texto visível. Vírgula, dois-pontos ou ponto.
- Nenhum nome de pessoa além de Rubens Schulz. Os nomes de outros magistrados que
  vinham em `confronto.json` foram redigidos ao embutir (papéis genéricos). Se
  reembutir os dados, redija de novo.
- Sem contraste "não é X, é Y". Texto afirmativo.
- Layout dos grafos é determinístico, para a ordem não embaralhar.
