# Como rodar

Dois jeitos de usar o sistema: **linha de comando** (só Python) e **interface web**
(Python + Node). A web usa exatamente os mesmos módulos — não há lógica
duplicada lá dentro.

Tudo abaixo é Windows, na raiz do projeto (`D:\projetos\scrapping desembargador`).

---

## 0. O que precisa estar instalado

|        | versão testada | como conferir                           |
| ------ | --------------- | --------------------------------------- |
| Python | 3.14.2          | `python -V`                           |
| Node   | 25.2.1          | `node -v` — **só para a web** |

Python 3.14 é recente e nem toda biblioteca tem wheel para ele. As versões que
funcionam estão travadas no `requirements.txt` — não atualize por conta.

---

## 1. Primeira vez (uma vez só, ~10 minutos)

### 1.1 Ambiente Python

```bat
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
```

### 1.2 Chaves

Crie um arquivo `.env` na raiz com:

```
OPENROUTER_API_KEY=sk-or-v1-...
DATAJUD_API_KEY=...
```

- **OpenRouter** (https://openrouter.ai/keys) — obrigatória para consultar. É a
  única coisa que custa dinheiro: ~US$ 0,04 por consulta completa.
- **Datajud** — a chave pública do CNJ, divulgada em
  https://datajud-wiki.cnj.jus.br/api-publica/acesso. Só é usada para coletar.

### 1.3 Os dados

O sistema precisa de `output/tjsc.db` (1,4 GB, as 20.363 decisões coletadas).
Se você já tem, pule. Se não:

```bat
run.bat
```

Leva horas — é o scraper. **Respeite os delays do `config.json`**: os dados são
públicos, mas os servidores do TJSC não são infinitos.

### 1.4 Índice e modelos

```bat
.venv\Scripts\python -X utf8 -m src.rag.indexar          REM ~4,5 min
.venv\Scripts\python -X utf8 -m src.rag.floresta --treinar   REM ~2 min
.venv\Scripts\python -X utf8 -m src.rag.calibrar --ajustar   REM ~1 min
```

Nessa ordem, e **sempre os três juntos**. Ver "Reindexei e apareceu um aviso"
mais abaixo.

---

## 2. Linha de comando

```bat
consultar.bat exemplos\caso.txt
```

O sistema pergunta a linha de análise:

```
  1) neutra     — o que o acervo diz, sem lado. A única com prognóstico.
  2) reformar   — só os precedentes que sustentam dar provimento
  3) manter     — só os que sustentam negar provimento
  4) histórico  — processos e consultas que você já usou
```

Para pular a pergunta (scripts, automação):

```bat
consultar.bat exemplos\caso.txt --tese reformar
consultar.bat exemplos\caso.txt --so-prognostico    REM para antes da minuta, ~US$ 0,014
consultar.bat --historico 0302503                   REM só consulta, não gasta
```

O relatório sai em `output\consultas\<thread>.md` e também no terminal.

Depois, qualifique — é o que valida o juiz automático:

```bat
qualificar.bat --thread <thread>
```

---

## 3. Interface web

### 3.1 Dependências (uma vez)

```bat
.venv\Scripts\pip install -r requirements-web.txt
cd frontend && npm install && cd ..
```

### 3.2 Crie a primeira conta

**Este comando você tem de rodar — ele pede uma senha, e senha não se passa por
argumento nem se deixa em arquivo:**

```bat
.venv\Scripts\python -m api.usuarios --criar voce@escritorio.com --papel admin
```

Ele pergunta a senha duas vezes (mínimo 10 caracteres). Para depois:

```bat
.venv\Scripts\python -m api.usuarios --listar
.venv\Scripts\python -m api.usuarios --senha voce@escritorio.com     REM trocar
.venv\Scripts\python -m api.usuarios --desativar fulano@escritorio.com
```

### 3.3 Subir — tudo num terminal só

```bat
.venv\Scripts\python -m api.servir
```

Sobe a API e o Vite **em primeiro plano, no terminal em que você está**, com o
log dos dois prefixado (`[api]` / `[web]`). **Ctrl+C para parar os dois.**

|     | onde                  | o que é                                  |
| --- | --------------------- | ----------------------------------------- |
| API | http://127.0.0.1:8000 | FastAPI (uvicorn)                         |
| Web | http://localhost:5173 | Vite em modo dev, com recarga automática |

Abra a **5173** — é ela que faz proxy de `/api` para a 8000, mantendo tudo
same-origin (sem CORS e sem cookie cross-site para configurar).

```bat
python -m api.servir --api            REM só a API (serve o dist, se existir)
python -m api.servir --prod           REM produção: uma porta, sem Node
python -m api.servir --porta 8080 --porta-web 5180
python -m api.servir --host 0.0.0.0   REM expõe na rede local
python -m api.servir --sem-conferir   REM pula o preflight (CI)
```

Trocar `--porta` **também acerta o proxy do Vite** (via `API_PORT`) — não é
preciso mexer no `vite.config.ts`.

`web.bat` é só um invólucro disso; existe para quem prefere dois cliques.

> **Não há workers para subir.** A consulta roda num
> `ThreadPoolExecutor(max_workers=2)` dentro do próprio processo do uvicorn —
> sem Celery e sem Redis, de propósito: o gargalo é USD por consulta, não CPU, e
> a durabilidade já está no `rag_runs.db`. Subir a API sobe os workers junto.

O comando não usa `--reload`: no Windows ele mata as threads de consulta em voo,
e consulta em voo é dinheiro já gasto. Mexeu na API? Ctrl+C e suba de novo. O
frontend recarrega sozinho (Vite), só a API precisa disso.

### 3.4 Modo produção (um processo, uma porta)

```bat
cd frontend && npm run build && cd ..
.venv\Scripts\python -m api.servir --prod
```

O FastAPI passa a servir o `frontend\dist` na mesma porta. Não precisa de Node
rodando. Rotas internas (`/consultas/xxx`) caem no `index.html`, então recarregar
a página ou colar um link funciona.

Em `--prod` o `WEB_DEV` **não** é ligado, e o cookie de sessão vai como
`Secure` — ou seja, **você precisa de HTTPS**, senão o navegador descarta o
cookie e o login não gruda. Para testar sem TLS em `http://localhost`, use
`python -m api.servir --api` (que liga `WEB_DEV=1`).

Para pôr no ar de verdade, num servidor Linux com HTTPS, o documento é o
[`DEPLOY.md`](DEPLOY.md) — Docker + Caddy, e a lista dos arquivos que vão por FTP.

---

## 4. Conferir se está tudo de pé

```bat
verificar.bat
```

Roda os self-checks de todos os módulos (domínio, API e frontend), sem rede e
sem gastar nada. Tem de terminar com `TUDO OK`.

---

## 5. Quando dá errado

### "Ambiente virtual nao encontrado em .venv"

Você pulou o passo 1.1.

### "nenhuma conta cadastrada"

O preflight se recusa a subir sem usuário. Passo 3.2.

### "porta 8000 (API) já está ocupada"

Sobrou processo de uma execução anterior. O comando para matar vem impresso
junto com o erro:

```bat
netstat -ano | findstr :8000
taskkill /PID <pid> /T /F
```

Acontece quando o servidor foi encerrado com `kill`/`Stop-Process` em vez de
Ctrl+C: no Windows isso é `TerminateProcess`, que **não dá para interceptar** —
o processo morre sem rodar a limpeza, e o `npm` deixa o `node` vivo segurando a
5173. Encerrando com Ctrl+C isso não acontece: a limpeza mata a árvore inteira
(`taskkill /T`).

### Login não gruda / volta para a tela de entrar

O cookie está sendo descartado por não ter TLS. `python -m api.servir` liga
`WEB_DEV=1` sozinho, que tira o `Secure` do cookie — mas `--prod` não liga, de
propósito. Se subiu o uvicorn na mão, exporte antes:

```bat
set WEB_DEV=1
```

### O índice ficou vazio / "esperava 20.363 decisoes, achei 0"

**`src.rag.indexar` não é self-check — é o construtor.** Ele apaga o
`output\rag.db` e reconstrói do zero. Interrompido no meio, deixa o índice
vazio. O conserto é rodar de novo, inteiro, e esperar os ~4,5 min.

### "AVISO: rag.db mudou depois deste modelo"

Aparece no stderr quando o índice tem outra contagem de decisões que a do
treino. O sistema continua funcionando, só avisando que as previsões podem estar
piores que o medido. Conserto:

```bat
.venv\Scripts\python -X utf8 -m src.rag.floresta --treinar
.venv\Scripts\python -X utf8 -m src.rag.calibrar --ajustar
```

Os dois são semeados: com o mesmo índice, reproduzem os mesmos números.

O selo compara **contagem e maior id**, não data de modificação. Reindexar o
mesmo `tjsc.db` devolve o mesmo selo e não dispara o aviso — porque o modelo
continua válido de fato. (Era por data até descobrir que o boot da API abria o
`rag.db` e fazia o aviso disparar sozinho a cada subida. Alarme que dispara
sozinho é alarme que se aprende a ignorar.)

### "Este documento não tem prognóstico"

Não é erro. Se você escolheu `reformar` ou `manter`, a amostra foi escolhida
por sustentar o seu lado — contar resultado nela mediria a escolha, não o
tribunal. Rode a mesma peça em **neutra** para o percentual calibrado.

### A consulta parou no meio (crédito acabou, internet caiu)

Nada foi perdido: o LangGraph guarda checkpoint por nó em
`output\rag_runs.db`. Na CLI, repita com o mesmo `--thread` e ele retoma do nó
onde parou, sem repagar o que já saiu. Na web, use o botão de retomar.

### Porta 8000 ou 5173 ocupada

```bat
netstat -ano | findstr :8000
taskkill /PID <pid> /F
```

---

## 6. Onde ficam as coisas

```
output\tjsc.db          1,4 GB  as decisões cruas + inteiro teor
output\rag.db            70 MB  índice FTS5 (reconstruível)
output\floresta.pkl      40 MB  segundo estimador (reconstruível)
output\calibrador.pkl     2 KB  isotônica (reconstruível)
output\rag_runs.db              checkpoints do LangGraph
output\feedback.db              consultas, notas e vereditos por precedente
output\web.db                   usuários e sessões da web
output\consultas\*.md           os relatórios
```

Os quatro marcados como reconstruíveis podem ser apagados sem perda — só
custam tempo de CPU. `tjsc.db`, `feedback.db` e `web.db` **não**: um custou
horas de scraping, os outros dois são o seu histórico.

> O `backup.sh` na raiz salva exatamente os não-reconstruíveis. Ver DEPLOY.md
> para o timer que o roda sozinho e manda a cópia para fora da máquina.

---

## 7. O que custa dinheiro

Só o OpenRouter. Nada mais no sistema faz chamada paga.

|                                                                | custo          |
| -------------------------------------------------------------- | -------------- |
| consulta completa (com minuta)                                 | ~US$ 0,04      |
| `--so-prognostico`                                           | ~US$ 0,014     |
| `--historico`, `verificar.bat`, indexar, treinar, calibrar | **zero** |
| bench de 8 modelos × 4 casos                                  | ~US$ 3,00      |

O rastro de custo por nó sai no fim de cada relatório e fica gravado no
`feedback.db`.

---

## 8. Extensão do eproc (Chrome)

Gerar, a partir de `frontend/`, apontando para a API que a extensão vai usar:

```powershell
$env:EXT_API_BASE='https://seu-dominio'   # em dev: http://localhost:5173
npm run build:extensao
```

Carregar: `chrome://extensions` → ligar **Modo do desenvolvedor** → **Carregar sem compactação** →
escolher `frontend/extensao/dist`. Depois de cada build, clique em **Recarregar** no cartão da extensão.

Em dev, entre no sistema por `http://localhost:5173` no mesmo Chrome: o cookie de `localhost` vale para
qualquer porta, e a extensão chama a API pelo proxy do Vite.

O `verificar.bat` gera a extensão numa pasta temporária e nunca toca em `frontend/extensao/dist`. Para
mandar um build para outro lugar, defina `EXT_OUT_DIR` (opcional); essa pasta é apagada a cada build, então
use uma que possa ser descartada.

Testes: `npm run test:extensao`. Se houver um `*.har` na raiz, parte dos testes roda contra ele; o HAR
nunca entra no git.

### Demonstração da extensão (sem login e sem eproc)

Para apresentar o painel sem conta no sistema e sem estar logado no eproc, gere um build de demonstração
numa pasta própria (PowerShell, a partir de `frontend/`):

```powershell
$env:EXT_DEMO='1'; $env:EXT_API_BASE='http://localhost:5173'; $env:EXT_OUT_DIR="$PWD\extensao\dist-demo"
npm run build:extensao
Remove-Item Env:EXT_DEMO, Env:EXT_OUT_DIR
```

Carregue `frontend/extensao/dist-demo` em `chrome://extensions`. Copie o **ID** da extensão no cartão dela e
abra `chrome-extension://<ID>/demo.html`: a página mostra o painel de verdade com dados fictícios e uma lista
de cenários (processo aberto no 1º e no 2º grau, sessão caída, captcha, sigilo, sistema fora do ar...).
`EXT_DEMO` nunca deve estar definida no build que vai para a loja: a página de demonstração só existe nele.
