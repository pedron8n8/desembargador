# Deploy na VPS

Como pôr a interface web no ar num servidor Linux, com HTTPS. Para rodar na sua
máquina, o documento é o `COMO_RODAR.md` — este aqui é só o servidor.

São dois contêineres: a aplicação (Python + o frontend já construído) e o Caddy,
que faz o HTTPS. Os dados **não** vão pelo git: sobem por FTP, e a seção 3 diz
exatamente quais arquivos.

> **HTTPS não é opcional.** Em produção o cookie de sessão vai como `Secure`
> (`api/app.py`). Sem certificado o navegador descarta o cookie e o login não
> gruda — a senha é aceita e a tela volta para o login, sem mensagem de erro. É
> por isso que o Caddy está aqui.

---

## 1. O que a VPS precisa

| | |
|---|---|
| Sistema | Ubuntu 24.04 (ou qualquer coisa com Docker) |
| CPU | 2 vCPU |
| RAM | 4 GB (2 GB roda, mas aperta no treino) |
| **Disco** | **50 GB** — é o gargalo real |
| Rede | um domínio já apontando para o IP da VPS |

O disco manda porque cada desembargador novo custa 1 a 2 GB de acervo. CPU e RAM
sobram: a busca é FTS5 dentro do SQLite, o segundo estimador é um `floresta.pkl`
de ~40 MB, e **todo o trabalho de LLM é chamada HTTP para o OpenRouter**. Não há
modelo rodando no servidor, não há GPU, não há download de pesos no boot.

O domínio precisa estar apontado **antes** da primeira subida: o Caddy pede o
certificado ao Let's Encrypt no `up`, e o Let's Encrypt confere o DNS.

Instalar o Docker:

```bash
curl -fsSL https://get.docker.com | sh
```

## 2. Subir o código

```bash
sudo mkdir -p /srv/cerebro && sudo chown "$USER" /srv/cerebro
git clone <url-do-repo> /srv/cerebro
cd /srv/cerebro
mkdir -p output
cp .env.example .env
nano .env
```

No `.env`, duas linhas importam:

```
OPENROUTER_API_KEY=sk-or-v1-...      # https://openrouter.ai/keys
DOMINIO=cerebro.seudominio.com.br
```

O `git clone` traz **só o código**: `output/`, `.env` e `frontend/dist` são
ignorados pelo git. O `dist` o Docker constrói sozinho; os outros dois são os
passos 2 e 3.

> Variável de ambiente de verdade ganha do arquivo `.env` (`src/rag/llm.py` usa
> `os.environ.setdefault`). E o `config_rag.json` é lido uma vez e fica em cache:
> mexer nele com o servidor de pé não muda nada até `docker compose restart app`.

## 3. Mandar os dados por FTP

**Pare a aplicação antes de copiar** (`docker compose stop app`, se ela já subiu
alguma vez). Um `.db` copiado com escrita pendente no WAL chega truncado do outro
lado. Com a aplicação parada o SQLite faz o checkpoint sozinho no desligamento.

**Transferência em modo binário.** Cliente de FTP em modo texto corrompe `.db`,
`.pkl` e `.rtf` sem avisar.

Origem: `D:\projetos\scrapping desembargador\`
Destino: `/srv/cerebro/` (mesma estrutura, com `/` no lugar de `\`)

### 3.1 O que precisa ir

| Origem (Windows) | Destino (VPS) | Tamanho | O que é |
|---|---|---|---|
| `output\tjsc.db` | `output/tjsc.db` | 1,4 GB | acervo do Rubens Schulz: inteiro teor e `doc_path` |
| `output\rag.db` | `output/rag.db` | 67 MB | o índice FTS5 — é dele que sai toda busca |
| `output\floresta.pkl` | `output/floresta.pkl` | 38 MB | segundo estimador; carregado já no boot |
| `output\calibrador.pkl` | `output/calibrador.pkl` | 2 KB | calibração da confiança |
| `output\documentos\` | `output/documentos/` | 457 MB, 17.837 `.rtf` | o botão de baixar o documento |
| `output\cerebros\andre-luiz-dacol\` | `output/cerebros/andre-luiz-dacol/` | 2,2 GB | `tjsc.db` 1,71 GB + `rag.db` 53 MB + `floresta.pkl` 34 MB + `documentos\` 418 MB |
| `output\cerebros\joao-henrique-blasi\` | `output/cerebros/joao-henrique-blasi/` | 1,6 GB | `tjsc.db` 1,09 GB + `rag.db` 40 MB + `floresta.pkl` 31 MB + `documentos\` 412 MB |

**Total: ~5,8 GB** dos 11 GB que o `output\` tem.

Dá para começar só com o cérebro padrão — as **cinco primeiras linhas**, ~2 GB. O
sistema sobe e funciona com um cérebro só; os outros dois vão depois, sem
reiniciar nada além do `docker compose restart app`.

Nas pastas `cerebros\<slug>\` só interessam `tjsc.db`, `rag.db`, `floresta.pkl`,
`calibrador.pkl` e `documentos\`. As subpastas `exports\` e `logs\` de dentro
delas podem ficar para trás.

### 3.2 O que NÃO mandar

| Não mandar | Por quê |
|---|---|
| `output\exports\` (2,2 GB) | saída bruta do scraper. A API nunca abre. É metade do volume total |
| `output\cerebros\*\exports\`, `*\logs\`, `output\logs\` | idem |
| `*.db-wal`, `*.db-shm` | arquivos de transação. Com a aplicação parada não têm nada dentro |
| `.env` | a chave do OpenRouter você digita na VPS (passo 2). Não sobe em claro por FTP |
| `.venv\`, `frontend\node_modules\`, `frontend\dist\` | o Docker refaz tudo isso |
| `output\bench*.json` | resultado de benchmark local |

### 3.3 Opcionais

Não são necessários para subir; leve se quiser continuidade:

| | |
|---|---|
| `output\web.db` | contas e sessões. Sem ele, você cria a conta nova no passo 4 |
| `output\rag_runs.db` (21 MB) | histórico das execuções de consulta |
| `output\feedback.db` | os vereditos e boosts que você já marcou |
| `output\consultas\*.md` | os markdowns das consultas antigas |
| `cerebros.json` | já vem no git. Só reenvie se você mexeu nele pela tela (o superadmin ligando/desligando cérebro escreve nesse arquivo) |

### 3.4 Conferir a transferência

```bash
cd /srv/cerebro
du -sh output/*
ls output/documentos | wc -l          # tem de bater com a contagem do Windows
sqlite3 output/rag.db "pragma integrity_check;"    # tem de dizer "ok"
```

Se `sqlite3` não estiver instalado: `sudo apt install -y sqlite3`. O
`integrity_check` num banco de 1,4 GB leva um minuto e vale o minuto — é o único
jeito de pegar transferência truncada antes de o problema aparecer como resultado
vazio na tela.

## 4. Primeira subida

```bash
cd /srv/cerebro
docker compose up -d --build
docker compose exec -it app python -m api.usuarios --criar voce@escritorio.com --papel superadmin
```

O primeiro build leva alguns minutos (instala Node, npm, e as dependências
Python). Os seguintes reaproveitam o cache.

O `--criar` pergunta a senha sem ecoar, por isso o `-it`. **Sem conta ativa
ninguém entra**: não existe autocadastro em lugar nenhum da API. Papéis:

| Papel | Pode |
|---|---|
| `advogado` | as próprias consultas |
| `admin` | consultas de todos, custos globais, criar e remover contas |
| `superadmin` | tudo isso, mais ligar e desligar cérebros |

Abra `https://SEU-DOMINIO` e entre.

## 5. Operação

```bash
docker compose logs -f app        # acompanhar
docker compose restart app        # depois de mexer no config_rag.json
docker compose ps                 # o que está de pé
sh verificar.sh                   # dentro do container: docker compose exec app sh verificar.sh
```

**Atualizar o sistema:**

```bash
cd /srv/cerebro && git pull && docker compose up -d --build
```

Os dados não são tocados: `output/` é bind mount, vive no disco da VPS e não
entra na imagem.

**Backup:**

```bash
docker compose stop app
tar czf /root/cerebro-$(date +%F).tar.gz output/web.db output/feedback.db \
        output/rag_runs.db output/consultas cerebros.json
docker compose start app
```

Só isso: é o que não dá para regerar. Os acervos (`tjsc.db`, `rag.db`, os `.pkl`)
saem de novo da coleta e do treino, e são 99% do volume — não vale o backup.

**Mandar um cérebro novo depois:** FTP da pasta para
`output/cerebros/<slug>/`, acrescentar a entrada no `cerebros.json`, e
`docker compose restart app`.

## 6. Quando dá errado

| Sintoma | Causa |
|---|---|
| A senha é aceita e a tela volta para o login | Sem HTTPS válido. O cookie `Secure` foi descartado. `docker compose logs caddy` e olhe o certificado |
| A consulta abre mas a tela nunca atualiza | O SSE está sendo bufferizado. Confira o `flush_interval -1` no `Caddyfile` |
| "sem documento em disco" em todo precedente | `output/documentos/` não subiu, ou subiu no lugar errado. Confira o passo 3.4 |
| `429 tentativas demais` batendo em todo mundo ao mesmo tempo | O `--proxy-headers` do uvicorn sumiu do `Dockerfile`: sem ele todo cliente vira `127.0.0.1` e o limite por IP vira global |
| Consulta morre logo no começo | `OPENROUTER_API_KEY` ausente ou sem crédito. `docker compose logs app` mostra `SemChave` |
| O seletor de cérebro só mostra um | Os outros estão `"ativo": 0` no `cerebros.json`, ou a pasta deles não subiu |
| Precedente nenhum é encontrado | Faltou o `rag.db` (o índice), ou ele veio truncado. `integrity_check` no passo 3.4 |
| O build falha no `pip install` | A VPS não achou wheel para o Python 3.14. Troque `python:3.14-slim` por `python:3.13-slim` no `Dockerfile` |

## 7. Custo

Só o OpenRouter é pago. Nada mais no sistema faz chamada cobrada.

| | |
|---|---|
| Consulta completa | ~US$ 0,04 |
| Só prognóstico | ~US$ 0,014 |
| Turno de conversa | ~US$ 0,005 |

Duas consultas rodam ao mesmo tempo, no máximo (`MAX_WORKERS = 2` em
`api/execucao.py`). A terceira espera na fila. Isso é de propósito: o gargalo é
dólar por consulta, não CPU.

---

## O que este deploy não tem

Sem CI, sem healthcheck, sem métricas, sem réplica, sem backup externo. Um
servidor, dois contêineres, `git pull` para atualizar. Quando houver um segundo
servidor ou um segundo deploy por dia, aí compensa.
