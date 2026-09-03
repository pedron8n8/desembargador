"""Coleta no Portal de Jurisprudência do TJSC (https://busca.tjsc.jus.br/jurisprudencia/).

Descoberto por inspeção do portal (out./2025 em diante):
- A pesquisa avançada é um form que dispara o endpoint AJAX `buscaajax.do`, que
  devolve o HTML dos resultados. Ou seja: NÃO precisa de navegador/Playwright —
  `requests` puro resolve, é ~50x mais rápido e não quebra com mudança de CSS.
- `ps` (page size) só aceita 10/20/50 — qualquer outro valor cai para 20.
- A paginação vai até o fim (ex.: 14.662 acórdãos = 294 páginas de 50). Passar de
  pg=última faz o portal VOLTAR à primeira página, então o laço para em
  ceil(total/ps) — não em "página vazia".
- O filtro por data (datainicial/datafinal) é inconsistente: a soma dos totais
  ano a ano não bate com o total geral. Por isso NÃO particionamos por data.
- Cada resultado aparece uma vez como `<strong>Processo:</strong>` DEPOIS de
  removidos os comentários HTML (o template repete o campo dentro de um <!-- -->).
- `categoria` separa as bases (acórdãos, monocráticas, turmas recursais...);
  cada uma é paginada em separado.
- Processos antigos (turmas de recursos) usam numeração pré-CNJ ("2013.200692-5"),
  que é preservada em `numero_processo_raw`.

Coleta em duas fases, ambas retomáveis:
  1. listagem  -> metadados + ementa (rápido: ~1 request por 50 decisões)
  2. detalhe   -> inteiro teor (html.do) e documento (integra.do), 1 request cada
"""
import calendar
import html as htmllib
import logging
import re
import time
from datetime import date
from pathlib import Path

import requests

log = logging.getLogger("portal")

FONTE = "portal_tjsc"
BASE = "https://busca.tjsc.jus.br/jurisprudencia/"

RE_COMENT = re.compile(r"<!--.*?-->", re.S)
RE_TOTAL = re.compile(r"<b>(\d+)</b>\s*resultados")
RE_BLOCO = re.compile(r"<strong>Processo:</strong>")
RE_NUMERO = re.compile(r"<u>\s*([^<(]+?)\s*(?:\(([^)]*)\))?\s*</u>")
# Identificador do documento. Usar o link do ícone de download NÃO serve: parte dos
# itens não tem ícone (medido: 39 links para 42 itens numa página), e o item sem ícone
# acabava herdando o id do vizinho — como o id é chave primária, um registro
# sobrescrevia o outro e a decisão sumia. Já o botão "Inteiro Teor" (abreIntegra)
# existe em 100% dos itens e fica DENTRO do bloco, depois do rótulo "Processo:".
# Atenção ao charset do id: ele é base64-ish e inclui '+' (ex.: AAAbmQAACAAGi+pAAH).
# Com \w+ o id não casava e ~1,7% das decisões ficavam sem forma de buscar o teor.
RE_ABRE = re.compile(r"abreIntegra\('\d+','([^']+)','([^']+)'")
RE_DOC = re.compile(r"integra\.do\?rowid=([^&\"']+)&tipo=([^&\"']+)")
RE_DOC2 = re.compile(r"html\.do\?[^']*?id=([^&\"']+)&categoria=([^&\"']+)")
RE_EMENTA = re.compile(r'id="text_ementa_\d+"[^>]*>(.*?)</textarea>', re.S)
RE_TAGS = re.compile(r"<(script|style)\b.*?</\1>|<[^>]+>", re.S)
RE_CNJ = re.compile(r"\d{7}-?\d{2}\.?\d{4}\.?\d\.?\d{2}\.?\d{4}")
# processos sob sigilo: o portal devolve esta mensagem no lugar do inteiro teor
RE_SIGILO = re.compile(r"segredo de justi[çc]a", re.I)

MESES = dict(zip("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(),
                 range(1, 13)))
# "Thu Jan 29 00:00:00 GMT-03:00 2026" -> 2026-01-29
RE_DATA_JAVA = re.compile(r"\w{3}\s+(\w{3})\s+(\d{1,2})\s+[\d:]+\s+\S+\s+(\d{4})")

# o portal serve o rótulo com acento literal, mas há páginas com entidade HTML
ROTULO_ORGAO = r"Org(?:ã|&atilde;)o Julgador"


def _texto(fragmento):
    """HTML -> texto puro."""
    return htmllib.unescape(RE_TAGS.sub(" ", fragmento or "")).strip()


def _campo(bloco, rotulo):
    # "Classe" fecha em </div>, os demais em <br /> — aceita ambos
    m = re.search(rf"<strong>{rotulo}:</strong>(.*?)(?:<br\s*/?>|</div>|</p>)", bloco, re.S)
    return re.sub(r"\s+", " ", _texto(m.group(1))) if m else None


def _data_iso(bloco):
    m = re.search(r"<strong>Julgado em:</strong>(.*?)<", bloco, re.S)
    if not m:
        return None
    d = RE_DATA_JAVA.search(m.group(1))
    if d:
        return f"{d.group(3)}-{MESES.get(d.group(1), 0):02d}-{int(d.group(2)):02d}"
    return re.sub(r"\s+", " ", _texto(m.group(1))) or None


def normaliza_cnj(texto):
    """Extrai o nº CNJ (20 dígitos) do texto; '' quando a numeração é pré-CNJ."""
    m = RE_CNJ.search(texto or "")
    if not m:
        return ""
    d = re.sub(r"\D", "", m.group(0))
    return d if len(d) == 20 else ""


class PortalClient:
    def __init__(self, cfg):
        self.delay = cfg.get("delay_segundos", 1.0)
        self.timeout = cfg.get("timeout_segundos", 90)
        self.max_retries = cfg.get("max_retries", 5)
        self.s = requests.Session()
        self.s.headers.update({
            "User-Agent": cfg.get("user_agent",
                                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                                  "AppleWebKit/537.36 (KHTML, like Gecko) "
                                  "Chrome/151.0.0.0 Safari/537.36"),
            "Referer": BASE,
        })

    # O portal responde 200 com uma pagina de bloqueio em vez do documento. Nao
    # e' erro de rede nem captcha: e' o servidor pedindo para recuar. Medido em
    # 04/08/2026, o titulo era "Bloqueio temporario do portal institucional" e a
    # palavra "captcha" nao aparecia em lugar nenhum.
    _MARCAS_BLOQUEIO = ("captcha", "bloqueio tempor", "acesso bloqueado",
                        "too many requests", "forbidden")
    pausa_bloqueio = 60

    @classmethod
    def _bloqueado(cls, r, binario):
        """True quando veio pagina em vez de documento/resultado.

        A checagem antiga so' rodava com binario=False, entao integra.do — que
        pede binario — nunca era conferido. Consequencia real: uma pagina de
        bloqueio de 12 kB era gravada como se fosse o documento (com extensao
        .txt) e a decisao ficava marcada como concluida para sempre. Content-Type
        resolve o caso binario sem precisar decodificar o corpo.
        """
        tipo = (r.headers.get("Content-Type") or "").lower()
        if binario:
            # pedimos .rtf/.pdf; se veio HTML, e' pagina de erro ou de bloqueio
            if "html" in tipo or r.content[:9].lower().startswith(b"<!doctype"):
                return True
            return False
        return any(m in r.text[:4000].lower() for m in cls._MARCAS_BLOQUEIO)

    def get(self, caminho, params, binario=False):
        """GET com retry/backoff. Devolve resposta ou None (após esgotar tentativas)."""
        for tentativa in range(self.max_retries):
            time.sleep(self.delay)
            try:
                r = self.s.get(BASE + caminho, params=params, timeout=self.timeout)
                if r.status_code == 200:
                    if self._bloqueado(r, binario):
                        log.warning("Portal pediu recuo (bloqueio/captcha) em %s — "
                                    "pausando %ss.", caminho, self.pausa_bloqueio)
                        time.sleep(self.pausa_bloqueio)
                        continue
                    return r
                log.warning("Portal HTTP %s em %s (tentativa %s)",
                            r.status_code, caminho, tentativa + 1)
            except requests.RequestException as e:
                log.warning("Erro de rede no portal (tentativa %s): %s", tentativa + 1, e)
            time.sleep(2 ** tentativa)
        log.error("Portal: desisti de %s após %s tentativas", caminho, self.max_retries)
        return None

    def pagina(self, relator, categoria, pg, ps, cfg):
        params = {"q": "", "only_ementa": "", "frase": "", "excluir": "", "qualquer": "",
                  "prox1": "", "prox2": "", "proxc": "", "sort": "dtJulgamento desc",
                  "ps": str(ps), "busca": "avancada", "pg": str(pg),
                  "categoria": categoria, "relator": relator, "flapto": "1",
                  "radio_campo": "integra" if cfg.get("buscar_em_inteiro_teor") else "ementa"}
        if cfg.get("data_inicio_br"):
            params["datainicial"] = cfg["data_inicio_br"]
        if cfg.get("data_fim_br"):
            params["datafinal"] = cfg["data_fim_br"]
        return self.get("buscaajax.do", params)


def parse_resultados(corpo_html):
    """Divide a página em blocos e extrai os campos de cada decisão."""
    corpo = RE_COMENT.sub("", corpo_html)
    i = corpo.find("###inicio_resultado###")
    if i > 0:
        corpo = corpo[i:]
    cortes = [m.start() for m in RE_BLOCO.finditer(corpo)]
    itens = []
    for n, ini in enumerate(cortes):
        # cada bloco vai do seu rótulo "Processo:" até o do item seguinte
        trecho = corpo[ini:cortes[n + 1] if n + 1 < len(cortes) else len(corpo)]

        m = RE_NUMERO.search(trecho)
        numero_raw = (m.group(1).strip() if m else "")
        tipo_desc = (m.group(2) or "").strip() if m else ""
        # só procura o id DENTRO do próprio bloco, nunca no vizinho
        doc = RE_ABRE.search(trecho) or RE_DOC.search(trecho) or RE_DOC2.search(trecho)
        ementa = RE_EMENTA.search(trecho)

        itens.append({
            "doc_id": doc.group(1) if doc else "",
            "tipo_doc": doc.group(2) if doc else "",
            "numero_processo": normaliza_cnj(numero_raw),
            "numero_processo_raw": numero_raw,
            "tipo_documento": tipo_desc,
            "relator": _campo(trecho, "Relator"),
            "origem": _campo(trecho, "Origem"),
            "orgao": _campo(trecho, ROTULO_ORGAO),
            "classe": _campo(trecho, "Classe"),
            "data_julgamento": _data_iso(trecho),
            "ementa": htmllib.unescape(ementa.group(1)).strip() if ementa
                      else re.sub(r"\s{2,}", " ", _texto(trecho)),
        })
    return itens


def _total(cli, relator, categoria, cfg, ini="", fim=""):
    """Nº de resultados. None = a requisicao falhou; 0 = a consulta e' vazia.

    Eram a mesma coisa (-1) e as duas caiam no mesmo `<= 0`: uma queda de rede
    na contagem de um ano fazia o ano inteiro ser pulado em silencio, logado
    como se nao houvesse decisao nenhuma naquele periodo.
    """
    c = dict(cfg, data_inicio_br=ini, data_fim_br=fim)
    r = cli.pagina(relator, categoria, 1, 10, c)
    if r is None:
        return None
    m = RE_TOTAL.search(r.text)
    return int(m.group(1)) if m else 0


def _fatias(cli, relator, categoria, cfg, total_geral):
    """Divide a busca em fatias de data pequenas o bastante para paginar sem perda.

    Motivo: a partir de ~100 páginas o portal reordena os resultados entre uma
    página e outra e itens se perdem (medido: ~2,6% de perda na página 140 de 294).
    O filtro de data, ao contrário, é exato — a soma dos totais ano a ano bate
    com o total geral. Então: fatia por ano e, se o ano ainda for grande, por mês.
    """
    limite = cfg.get("limite_fatia", 500)
    if total_geral <= limite:
        yield "", "", total_geral          # pequeno: uma fatia só, sem filtro
        return
    # respeita o intervalo do config quando houver; senão varre a faixa configurada
    ano_ini = int((cfg.get("data_inicio_br") or "").split("/")[-1] or
                  cfg.get("ano_inicio", 1990))
    ano_fim = int((cfg.get("data_fim_br") or "").split("/")[-1] or
                  cfg.get("ano_fim") or date.today().year + 1)
    for ano in range(ano_ini, ano_fim + 1):
        t = _total(cli, relator, categoria, cfg, f"01/01/{ano}", f"31/12/{ano}")
        if t is None:
            log.error("Portal [%s] %s: contagem falhou — o ano NAO foi varrido. "
                      "Rode de novo quando o portal voltar.", categoria, ano)
            continue
        if t == 0:
            continue
        if t <= limite:
            yield f"01/01/{ano}", f"31/12/{ano}", t
            continue
        for mes in range(1, 13):
            ult = calendar.monthrange(ano, mes)[1]
            i2, f2 = f"01/{mes:02d}/{ano}", f"{ult:02d}/{mes:02d}/{ano}"
            t2 = _total(cli, relator, categoria, cfg, i2, f2)
            if t2 is None:
                log.error("Portal [%s] %s/%s: contagem falhou — mes NAO varrido.",
                          categoria, mes, ano)
                continue
            if t2 > 0:
                yield i2, f2, t2


def _pagina_fatia(cli, relator, categoria, cfg, storage, ini, fim, total):
    """Pagina uma fatia inteira. Devolve quantos itens distintos foram vistos."""
    ps = cfg.get("ps", 50)
    c = dict(cfg, data_inicio_br=ini, data_fim_br=fim)
    vistos = set()
    for pg in range(1, -(-total // ps) + 1):  # ceil
        r = cli.pagina(relator, categoria, pg, ps, c)
        if r is None:
            break
        for d in parse_resultados(r.text):
            d.update({"fonte": FONTE, "categoria": categoria,
                      "url": f"{BASE}html.do?id={d['doc_id']}&categoria={d['tipo_doc']}"
                             if d["doc_id"] else BASE})
            storage.upsert_decisao(d)
            # mesma chave da tabela: se dois itens colidirem aqui, um apagaria o outro
            vistos.add((d["categoria"], d["numero_processo_raw"],
                        d["data_julgamento"], d["hash"]))
        storage.commit()
    return len(vistos)


def _coletar_listagem(cli, cfg, config, storage):
    """Fase 1: para cada categoria, fatia a busca por data e pagina cada fatia."""
    relator = config["relator"]
    for categoria in cfg["categorias"]:
        chave = f"{FONTE}:{categoria}"
        feitas = set((storage.get_checkpoint(chave) or {}).get("fatias_ok", []))
        total_geral = _total(cli, relator, categoria, cfg,
                             cfg.get("data_inicio_br", ""), cfg.get("data_fim_br", ""))
        if total_geral is None:
            log.error("Portal [%s]: contagem geral falhou para %s — categoria "
                      "NAO coletada nesta execução.", categoria, relator)
            continue
        if total_geral == 0:
            log.info("Portal [%s]: nenhum resultado para %s", categoria, relator)
            continue
        log.info("Portal [%s]: %s decisões — montando fatias%s", categoria, total_geral,
                 f" ({len(feitas)} já concluídas)" if feitas else "")
        somado = 0
        for ini, fim, total in _fatias(cli, relator, categoria, cfg, total_geral):
            rotulo = f"{ini}..{fim}" if ini else "tudo"
            somado += total
            if rotulo in feitas:
                continue
            vistos = _pagina_fatia(cli, relator, categoria, cfg, storage, ini, fim, total)
            if vistos < total:  # reordenação do índice: uma segunda passada recupera
                log.warning("Portal [%s] %s: %s/%s na 1ª passada — repassando.",
                            categoria, rotulo, vistos, total)
                vistos = max(vistos, _pagina_fatia(cli, relator, categoria, cfg,
                                                   storage, ini, fim, total))
            # A segunda passada existe para a REORDENACAO do indice do portal.
            # Quando o que falhou foi a rede, ela tambem falha — e marcar a
            # fatia como feita apagava aquelas decisoes do acervo para sempre,
            # porque fatia em `feitas` nunca mais e' revisitada (nem com
            # --recoletar, que so' limpa checkpoint).
            if vistos < total:
                log.error("Portal [%s] %s: %s/%s mesmo apos repassar — fatia "
                          "NAO marcada como concluída; rode de novo.",
                          categoria, rotulo, vistos, total)
                continue
            feitas.add(rotulo)
            storage.set_checkpoint(chave, {"fatias_ok": sorted(feitas)})
            log.info("Portal [%s] %s: %s/%s (banco: %s decisões)",
                     categoria, rotulo, vistos, total, storage.count("decisoes"))
        log.info("Portal [%s]: listagem concluída (%s esperados).", categoria, somado)


def _coletar_detalhes(cli, cfg, storage, out):
    """Fase 2: inteiro teor (html.do) e documento (integra.do) por decisão.

    Retomável por natureza: só busca o que ainda está faltando no banco.
    """
    quer_teor = cfg.get("baixar_inteiro_teor", True)
    quer_doc = cfg.get("baixar_documentos", True)
    if not (quer_teor or quer_doc):
        return
    pendentes = storage.decisoes_sem_detalhe()
    log.info("Portal detalhes: %s decisões pendentes (inteiro teor=%s, documento=%s)",
             len(pendentes), quer_teor, quer_doc)
    Path(out["documentos"]).mkdir(parents=True, exist_ok=True)
    # Disjuntor: se um endpoint cai de vez (já aconteceu com o integra.do devolvendo
    # HTTP 500 em série), insistir custa ~30s por item em retries e só castiga um
    # servidor que já está mal. Depois de N falhas seguidas, desiste dele nesta
    # execução; os itens ficam pendentes e são retomados na próxima.
    limite_seguidas = cfg.get("falhas_seguidas_ate_desistir", 20)
    seguidas = {"html.do": 0, "integra.do": 0}

    sigilo = sem_conteudo = parciais = 0
    for i, d in enumerate(pendentes, 1):
        doc_id, tipo = d["doc_id"], d["tipo_doc"]
        teor = caminho = nota = None
        completo = True  # só marca detalhe_em quando nada ficou faltando
        if quer_teor and not d["tem_teor"]:
            if seguidas["html.do"] >= limite_seguidas:
                completo = False
            else:
                # ajax=1 devolve só o documento, sem o cabeçalho/rodapé do site
                r = cli.get("html.do", {"ajax": "1", "q": "", "id": doc_id,
                                        "categoria": tipo})
                if r is None:
                    seguidas["html.do"] += 1
                    completo = False
                else:
                    seguidas["html.do"] = 0
                    bruto = RE_COMENT.sub("", r.text)
                    txt = re.sub(r"\n{3,}", "\n\n", _texto(bruto)).strip()
                    if RE_SIGILO.search(txt):
                        nota = "segredo_de_justica"  # o portal exige login para esses
                    elif len(txt) > 200:
                        teor = txt
                    else:
                        nota = "sem_conteudo"
        if quer_doc and not d["tem_doc"] and nota != "segredo_de_justica":
            if seguidas["integra.do"] >= limite_seguidas:
                completo = False
            else:
                r = cli.get("integra.do", {"rowid": doc_id, "tipo": tipo}, binario=True)
                if r is None:
                    seguidas["integra.do"] += 1
                    completo = False
                else:
                    seguidas["integra.do"] = 0
                    if r.content:
                        ext = ".pdf" if r.content[:4] == b"%PDF" else (
                            ".rtf" if "rtf" in (r.headers.get("Content-Type") or "")
                            else ".txt")
                        nome = (d["numero_processo"] or d["numero_processo_raw"]
                                or doc_id).replace("/", "-").replace("\\", "-")
                        destino = Path(out["documentos"]) / f"{nome}_{doc_id[:12]}{ext}"
                        destino.write_bytes(r.content)
                        caminho = str(destino)
        if nota == "segredo_de_justica":
            sigilo += 1
        elif completo and not (teor or caminho):
            sem_conteudo += 1
        if not completo:
            parciais += 1
        # grava sempre o que foi obtido, mesmo com a outra metade pendente
        storage.atualizar_detalhe(d["id"], teor, caminho, nota, concluido=completo)
        if i % 50 == 0:
            storage.commit()
            log.info("Portal detalhes: %s/%s (%s em segredo de justiça, %s parciais)",
                     i, len(pendentes), sigilo, parciais)
        for nome_ep, n in seguidas.items():
            if n == limite_seguidas:
                log.error("Portal: %s falhou %s vezes seguidas — desistindo dele nesta "
                          "execução. Rode de novo mais tarde para completar.", nome_ep, n)
                seguidas[nome_ep] += 1  # não repete o aviso
    storage.commit()
    log.info("Portal detalhes: fim — %s em segredo de justiça, %s sem conteúdo, "
             "%s parciais (pendentes p/ a próxima execução).",
             sigilo, sem_conteudo, parciais)


def _prep(config):
    cfg = config["portal"]
    # o portal usa dd/mm/aaaa; converte as datas ISO do config
    for origem, destino in (("data_inicio", "data_inicio_br"), ("data_fim", "data_fim_br")):
        v = config.get(origem) or ""
        cfg[destino] = "/".join(reversed(v.split("-"))) if v.count("-") == 2 else ""
    return PortalClient(cfg), cfg


def coletar_listagem(config, storage):
    """Fase 1 (rápida): ~1 request por 50 decisões."""
    cli, cfg = _prep(config)
    _coletar_listagem(cli, cfg, config, storage)


def coletar_detalhes(config, storage):
    """Fase 2 (lenta): 1-2 requests por decisão. Rodada por último, é retomável."""
    cli, cfg = _prep(config)
    _coletar_detalhes(cli, cfg, storage, config["saida"])


def coletar(config, storage):
    coletar_listagem(config, storage)
    coletar_detalhes(config, storage)


if __name__ == "__main__":
    # Self-check do parser (sem rede). O 2º item NÃO tem ícone de download — é o caso
    # que antes fazia o item herdar o id do vizinho e uma decisão sobrescrever a outra.
    amostra = """
    ###inicio_resultado###
    <div class="icones"><a href="integra.do?rowid=ABC123&tipo=acordao_eproc"></a></div>
    <p><!-- <strong>Processo:</strong> ignorar isto -->
    <strong>Processo:</strong> <a href="#"><u>5105112-53.2025.8.24.0000 (Ac&oacute;rd&atilde;o do Tribunal de Justi&ccedil;a)</u></a><br />
    <strong>Relator:</strong> RUBENS SCHULZ<br />
    <strong>Origem:</strong> Tribunal de Justi&ccedil;a de Santa Catarina<br />
    <strong>Org&atilde;o Julgador:</strong> 6&ordf; C&acirc;mara de Direito Comercial<br />
    <strong>Julgado em:</strong> Thu Jan 29 00:00:00 GMT-03:00 2026
      <a href='#' onclick="abreIntegra('1','ABC123','acordao_eproc','2706610');return false;"></a><br />
    <div><strong>Classe:</strong> Agravo de Instrumento</div>
    <textarea id="text_ementa_1">AGRAVO DE INSTRUMENTO. TESTE.</textarea>
    <p><strong>Processo:</strong> <a href="#"><u>2013.200692-5 (Ac&oacute;rd&atilde;o das Turmas de Recursos)</u></a><br />
    <strong>Relator:</strong> Rubens Schulz<br />
    <strong>Julgado em:</strong> Tue Nov 05 00:00:00 GMT-03:00 2013
      <a href='#' onclick="abreIntegra('2','AAAbmQAACAAGi+pAAH','atr','2708561');return false;"></a><br />
    <div><strong>Classe:</strong> Apela&ccedil;&atilde;o Criminal</div>
    <textarea id="text_ementa_2">APELA&Ccedil;&Atilde;O CRIMINAL. TESTE 2.</textarea>
    """
    itens = parse_resultados(amostra)
    assert len(itens) == 2, f"esperava 2 blocos, veio {len(itens)}"
    a, b = itens
    assert a["numero_processo"] == "51051125320258240000", a["numero_processo"]
    assert a["numero_processo_raw"] == "5105112-53.2025.8.24.0000"
    assert a["doc_id"] == "ABC123" and a["tipo_doc"] == "acordao_eproc"
    assert a["relator"] == "RUBENS SCHULZ", a["relator"]
    assert a["orgao"] == "6ª Câmara de Direito Comercial", a["orgao"]
    assert a["classe"] == "Agravo de Instrumento", a["classe"]
    assert a["data_julgamento"] == "2026-01-29", a["data_julgamento"]
    assert a["ementa"] == "AGRAVO DE INSTRUMENTO. TESTE."
    # o item sem ícone precisa ter id PRÓPRIO, senão uma decisão apaga a outra;
    # e o id pode conter '+', que um \w+ descartaria silenciosamente
    assert b["doc_id"] == "AAAbmQAACAAGi+pAAH", b["doc_id"]
    assert b["tipo_doc"] == "atr" and b["classe"] == "Apelação Criminal"
    assert b["data_julgamento"] == "2013-11-05", b["data_julgamento"]
    assert a["doc_id"] != b["doc_id"], "ids colidiram — haveria perda de decisões"
    assert normaliza_cnj("2013.200692-5") == ""  # numeração pré-CNJ não vira chave

    # --- deteccao de bloqueio. Em 04/08/2026 o integra.do respondeu HTTP 200
    # com "Bloqueio temporario do portal institucional" em HTML, e o codigo
    # gravou-a-ia como se fosse o documento (extensao .txt), marcando 601
    # decisoes como concluidas com lixo dentro. Sem rede: respostas de mentira.
    class _R:
        def __init__(self, corpo, tipo):
            self.content = corpo if isinstance(corpo, bytes) else corpo.encode()
            self.text = corpo if isinstance(corpo, str) else ""
            self.headers = {"Content-Type": tipo}

    bloqueio = "<!DOCTYPE html><title>Tribunal de Justiça - Bloqueio temporário " \
               "do portal institucional</title>"
    assert PortalClient._bloqueado(_R(bloqueio, "text/html"), binario=True), \
        "pagina de bloqueio passaria como documento — foi este o bug"
    assert PortalClient._bloqueado(_R(bloqueio, "text/html"), binario=False)
    # a palavra 'captcha' nao aparece na pagina real: procurar so' por ela falha
    assert "captcha" not in bloqueio.lower()
    # documento de verdade tem que passar
    assert not PortalClient._bloqueado(_R(b"{\\rtf1\\ansi teste", "application/rtf"),
                                       binario=True)
    assert not PortalClient._bloqueado(_R(b"%PDF-1.4 teste", "application/pdf"),
                                       binario=True)
    # HTML legitimo do html.do (inteiro teor) nao pode ser confundido com bloqueio
    assert not PortalClient._bloqueado(
        _R("<div>ACORDAM os Desembargadores...</div>", "text/html"), binario=False)

    # --- falha de rede nao pode virar "fatia concluida" nem "zero resultados"
    class ClienteQueCai:
        """Devolve o total certo na contagem e None ao paginar: e' exatamente o
        portal saindo do ar no meio de uma fatia."""
        def __init__(self):
            self.paginas = 0

        def pagina(self, relator, categoria, pg, ps, cfg):
            if ps == 10:                       # a chamada de _total
                r = type("R", (), {})()
                r.text = "Resultados <b>1</b> a <b>10</b> de <b>400</b> resultados"
                return r
            self.paginas += 1                  # tentativa real de paginacao
            return None                        # a paginacao morre

    class StorageFalso:
        def __init__(self):
            self.checkpoints = {}

        def upsert_decisao(self, d):
            pass

        def commit(self):
            pass

        def count(self, t):
            return 0

        def get_checkpoint(self, chave):
            return self.checkpoints.get(chave)

        def set_checkpoint(self, chave, valor):
            self.checkpoints[chave] = valor

    st = StorageFalso()
    portal_cfg = {"categorias": ["acordaos"], "ps": 50, "limite_fatia": 100000,
                  "delay_segundos": 0, "baixar_inteiro_teor": False,
                  "baixar_documentos": False}
    config = {"relator": "Fulano"}
    cliente = ClienteQueCai()
    _coletar_listagem(cliente, portal_cfg, config, st)
    # mesma expressao usada dentro de _coletar_listagem para montar a chave
    chave = f"{FONTE}:acordaos"
    marcadas = st.checkpoints.get(chave, {}).get("fatias_ok", [])
    assert marcadas == [], "fatia incompleta foi marcada como concluida: %r" % marcadas
    # prova que o caminho exercitado foi mesmo a paginacao falhando (1a e 2a
    # passada), e nao um total vazio que faria o laco das fatias nem rodar
    assert cliente.paginas == 2, ("esperava 2 tentativas de paginacao (1a e 2a "
                                   "passada); veio %r" % cliente.paginas)
    print("portal_jurisprudencia: self-check OK (fatia incompleta nao e' marcada)")
