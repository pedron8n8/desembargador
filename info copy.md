# Segundo cerebo

# Funcionalidades

## Scrapping de documentos

Hoje o sistema conta com um sistema complexo de scrapping de documentos bucando em todas as bases abertas (do estado/nacao) disponiveis para passar a maior quantidade de informacao para a machine Learning

## Analise de documentos

O sistema conta com um metodo robusto de treinamento focado em conceitos de machine learning

### Treinamento de maquinas

#### BM25

é um algoritmo usado por mecanismos de busca para calcular a relevância de um documento com base em palavras-chave

#### Random Forest

é um algoritmo popular de aprendizado de máquina ( *machine learning* ) supervisionado que junta várias árvores de decisão para dar uma resposta mais certa e seguro

#### ReRanking

Rerankiamento dos documentos ajustando os pesos e medidas antes de ser reenviados para o treinamento

### Pesos

Hoje o sistema conta com pesos de diversos maneiras para avaliar no reraking

#### Tempo

Quanto mais recente o documento, maior o peso que ele tem sobre a proxima decisao

#### Peso 2

breve explicacao

#### Peso 3

breve explicacao

#### Peso 4

Breve explicacao

## Fator de validacao do documento

### Treinamento

O treinamento das LLM sao feitos com documentos ate 2024, pegando assim o maximo de contexto possivel (alguns anos) para usarmos como treinamento

### Prova Real

A prova Real e feita apos o treinamento dos modelos, pois comparamos as informacoes que os modelos devolve com as decisoes de fato tomadas, assim permitindo ajustes precisos no reraking para chegar ao maximo proximo da decisao correta

## Geracao de documentos

### Redator

O redator do sistema e uma LLM (*Large Language Model* ou  **Grande Modelo de Linguagem** ) treinada com todas as informacoes que sao passadas pelo o algoritmo de machine Learning

### Validator 

usamos o conceito de LLM as Judge para avaliar os outputs(Respostas) dos modelos treinados, dando notas de 0 ate 5, sendo 5 a melhor nota
Voce tambem pode avaliar e passar seu feedback para ajudar a treinar o modelo

## Comprovacao 

### Grafos

Grafos nada mais é que uma estrutura matemática e computacional formada por um conjunto de pontos, chamados **vértices** (ou nós), unidos por linhas, chamadas **arestas** (ou arcos)

O sistema alem de gerar uma possivel resposta, te mostra um grafo com todos os documentos que ele usou para chegar naquela decisao, qual peso teve cada um para chegar naquela decisao para voce ter todo um mapa mental e conseguir consultar caso voce precise

Ele te mostra o peso de cada documento usadora na consulta

## Resposta

Como respota, voce recebe a defesa da parte que voce escolheu, a explicao porque o sistema indica isso, os documentos que voce tomou uma decisao parecida com essa, o peso que cada decisao pasada teve, o grafo ligando cada documento passado que foi usado pela machine learning para ajudar ela a chegar naquela decisao

Alem de tudo isso ele te abre uma janela para voce conversar com o maquina responsavel pela geracao do documento com todo treinamento que ela teve para gerar o documento para te ajudar e te axuliar a sanar suas duvidas perando a resposta dela
