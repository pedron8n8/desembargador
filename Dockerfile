# Uma imagem, um processo, uma porta. O frontend e' construido aqui dentro
# porque o mount de estaticos em api/app.py e' registrado no import: se o
# frontend/dist nao existir quando o Python subir, as rotas da SPA simplesmente
# nao se registram e o site responde 404 em tudo que nao seja /api.
FROM node:24-alpine AS web
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.14-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
COPY requirements.txt requirements-web.txt ./
RUN pip install --no-cache-dir -r requirements.txt -r requirements-web.txt
COPY src/ src/
COPY api/ api/
COPY verificar.sh ./
COPY --from=web /app/frontend/dist frontend/dist

# O config_rag.json e o cerebros.json NAO entram na imagem: vem por bind mount
# do compose. O cerebros.json e' reescrito em execucao (src/cerebros.py, _gravar)
# quando o superadmin liga ou desliga um cerebro — dentro da imagem essa escrita
# se perderia no proximo build.

# uvicorn direto, sem api/servir.py: o preflight dele exige um .venv/ na raiz,
# que num container nao existe.
#
# UM processo so'. O ThreadPoolExecutor das consultas (api/execucao.py), o
# registro de assinantes do SSE e os escritores SQLite todos presumem processo
# unico — --workers 2 daria duas filas brigando pelo mesmo banco.
#
# --proxy-headers: sem isto request.client.host e' sempre 127.0.0.1 atras do
# Caddy, e o limite de tentativas de login por IP (api/auth.py) vira global.
CMD ["python", "-X", "utf8", "-m", "uvicorn", "api.app:app", \
     "--host", "0.0.0.0", "--port", "8000", \
     "--proxy-headers", "--forwarded-allow-ips", "*"]
