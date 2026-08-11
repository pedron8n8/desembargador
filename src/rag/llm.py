"""Cliente OpenRouter — HTTP puro, sem SDK.

O custo nao e' estimado por tabela de precos: pedimos `usage.include` e o
OpenRouter devolve o custo real da chamada em USD. Assim a conta bate mesmo
quando o modelo cai para um provedor com preco diferente.
"""
import json
import os
import re
import time

import requests

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
URL = "https://openrouter.ai/api/v1/chat/completions"
_cfg = None


def config():
    global _cfg
    if _cfg is None:
        env = os.path.join(RAIZ, ".env")
        if os.path.exists(env):
            with open(env, encoding="utf-8") as f:
                for linha in f:
                    if "=" in linha and not linha.strip().startswith("#"):
                        k, _, v = linha.partition("=")
                        os.environ.setdefault(k.strip(), v.strip())
        with open(os.path.join(RAIZ, "config_rag.json"), encoding="utf-8") as f:
            _cfg = json.load(f)
    return _cfg


class SemChave(RuntimeError):
    pass


class SemCredito(RuntimeError):
    pass


def chamar(no, mensagens, max_tokens=None, extra=None):
    """Devolve (texto, {modelo, custo_usd, tokens_in, tokens_out, anotacoes}).

    `no` e' a chave em config_rag.json["modelos"] — cada no do grafo usa um
    modelo diferente; ver o README para o porque de cada escolha.

    `extra` e' mesclado no corpo da requisicao. Serve para o que e' de UMA
    chamada so' e nao vale um parametro proprio — hoje, o `plugins` do
    file-parser que a extracao de PDF usa (src/rag/extrair.py).
    """
    cfg = config()
    chave = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not chave:
        raise SemChave(
            "Falta OPENROUTER_API_KEY. Crie a chave em https://openrouter.ai/keys "
            "e coloque no arquivo .env como:  OPENROUTER_API_KEY=sk-or-v1-...")
    modelo = cfg["modelos"][no]
    corpo = {
        "model": modelo,
        "messages": mensagens,
        "temperature": cfg.get("temperatura", {}).get(no, 0.2),
        "max_tokens": max_tokens or cfg.get("max_tokens", {}).get(no, 4000),
        "usage": {"include": True},
    }
    corpo.update(extra or {})
    espera = 2
    for tentativa in range(cfg.get("max_retries", 4)):
        try:
            r = requests.post(
                URL, timeout=cfg.get("timeout_segundos", 180),
                headers={"Authorization": "Bearer " + chave,
                         "Content-Type": "application/json",
                         # o OpenRouter usa esses dois so' para atribuicao
                         "HTTP-Referer": "https://localhost/scrapping-desembargador",
                         "X-Title": "Segundo Cerebro TJSC"},
                data=json.dumps(corpo, ensure_ascii=False).encode("utf-8"))
        except requests.RequestException as e:
            if tentativa == cfg.get("max_retries", 4) - 1:
                raise
            print("  rede falhou (%s), tentando de novo em %ds" % (e, espera))
            time.sleep(espera)
            espera *= 2
            continue
        if r.status_code in (429, 500, 502, 503, 504):
            if tentativa == cfg.get("max_retries", 4) - 1:
                r.raise_for_status()
            print("  HTTP %d de %s, tentando de novo em %ds"
                  % (r.status_code, modelo, espera))
            time.sleep(espera)
            espera *= 2
            continue
        if r.status_code == 402:
            # Conta sem credito: o free tier do OpenRouter limita o tamanho do
            # prompt (~19 mil tokens) e da resposta. Vale a mensagem clara, nao
            # o stack trace — o conserto e' do lado do usuario.
            raise SemCredito(
                "Sem crédito no OpenRouter (nó '%s', modelo %s).\n"
                "  Resposta: %s\n"
                "  Conserto: adicione crédito em https://openrouter.ai/settings/credits\n"
                "  (US$ 5 dão ~25 consultas completas nesta configuração)\n"
                "  Alternativa sem gastar: baixe 'busca.chars_por_precedente' para\n"
                "  5000 e 'busca.precedentes' para 5 em config_rag.json — cabe no\n"
                "  free tier, com menos material para o redator."
                % (no, modelo, (r.json().get("error") or {}).get("message", r.text)[:200]))
        if r.status_code >= 400:
            raise RuntimeError("OpenRouter HTTP %d: %s" % (r.status_code, r.text[:400]))
        d = r.json()
        if "choices" not in d:
            raise RuntimeError("resposta sem choices: %s" % json.dumps(d)[:400])
        uso = d.get("usage") or {}
        escolha = d["choices"][0]
        return escolha["message"]["content"] or "", {
            "no": no, "modelo": modelo,
            "custo_usd": float(uso.get("cost") or 0.0),
            "tokens_in": uso.get("prompt_tokens") or 0,
            "tokens_out": uso.get("completion_tokens") or 0,
            # 'length' = bateu no teto de max_tokens, ou seja, o texto veio
            # cortado no meio. Sem isso, o revisor gasta um ciclo inteiro
            # reclamando de um problema que e' de configuracao, nao de conteudo.
            "cortado": escolha.get("finish_reason") == "length",
            # o file-parser devolve o texto extraido AQUI, nao na resposta do
            # modelo: pedir para ele repetir a peca inteira pagaria tokens de
            # saida e ele resumiria no meio do caminho
            "anotacoes": escolha["message"].get("annotations") or [],
        }
    raise RuntimeError("esgotou as tentativas em " + modelo)


_BLOCO = re.compile(r"```(?:json)?\s*(.+?)```", re.S)


def json_da_resposta(texto, padrao=None):
    """Modelos teimam em embrulhar JSON em cerca de codigo ou prosa. Aceita os tres."""
    for candidato in ([m.group(1) for m in _BLOCO.finditer(texto)] + [texto]):
        candidato = candidato.strip()
        try:
            return json.loads(candidato)
        except json.JSONDecodeError:
            pass
        i, j = candidato.find("{"), candidato.rfind("}")
        if i >= 0 and j > i:
            try:
                return json.loads(candidato[i:j + 1])
            except json.JSONDecodeError:
                pass
    if padrao is not None:
        return padrao
    raise ValueError("resposta nao continha JSON: " + texto[:300])


if __name__ == "__main__":
    # self-check offline: so' o parser, que e' a parte que quebra na pratica
    assert json_da_resposta('{"a": 1}') == {"a": 1}
    assert json_da_resposta('```json\n{"a": 2}\n```') == {"a": 2}
    assert json_da_resposta('Claro! Segue:\n{"a": 3}\nEspero ter ajudado.') == {"a": 3}
    assert json_da_resposta("nada aqui", padrao={}) == {}
    print("self-check OK")
    print("modelos configurados:", json.dumps(config()["modelos"], indent=2))
    print("chave presente:", bool(os.environ.get("OPENROUTER_API_KEY", "").strip()))
