"""Arquivo (bytes) -> texto. Uma porta so', para a web e para o CLI.

O tipo e' decidido pelos MAGIC BYTES, nao pela extensao — a extensao mente, e
era exatamente por isso que o sistema aceitava um PDF renomeado, enchia a caixa
de lixo binario e rodava uma consulta paga em cima do lixo.

Caminhos:
  PDF com camada de texto  -> pypdf, local, de graca (a maioria das pecas)
  PDF escaneado            -> OCR pelo plugin file-parser do OpenRouter
  DOCX                     -> zipfile da stdlib (docx e' um zip com XML dentro)
  txt/md                   -> decodifica, recusando se for binario disfarcado

    python -m src.rag.extrair        # self-check offline (nao chama LLM)
"""
import base64
import glob
import html as htmllib
import io
import os
import re
import zipfile

LIMITE_BYTES = 20 * 1024 * 1024
# O zip diz o tamanho descomprimido no cabecalho: da' para recusar a bomba
# ANTES de descomprimir, que e' o unico momento em que recusar adianta.
LIMITE_DESCOMPRIMIDO = 60 * 1024 * 1024
MAX_PAGINAS_OCR = 100
# Abaixo disto por pagina o PDF nao tem camada de texto util (capa digitalizada,
# peca escaneada) e o pypdf devolve so' o rodape do carimbo.
MIN_CHARS_POR_PAGINA = 40
# ponytail: 'cloudflare-ai' e' a engine gratuita. Se aparecer digitalizacao ruim
# demais (manuscrito, pagina torta), trocar por 'mistral-ocr' — US$ 2/1.000
# paginas, mesma linha, mais nada muda.
ENGINE_OCR = "cloudflare-ai"


class NaoSuportado(ValueError):
    """Formato que nao da' para ler. A mensagem vai inteira para o usuario."""


# --------------------------------------------------------------------- docx

RE_QUEBRA = re.compile(r"</w:p>|<w:br/>|<w:br />")
RE_TAB = re.compile(r"<w:tab/>|<w:tab />")
RE_TAGS = re.compile(r"<[^>]+>")


def _docx(dados):
    with zipfile.ZipFile(io.BytesIO(dados)) as z:
        try:
            info = z.getinfo("word/document.xml")
        except KeyError:
            raise NaoSuportado(
                "esse .zip não é um .docx (falta word/document.xml). Se for um "
                ".odt ou .pages, salve como .docx ou .pdf.")
        if info.file_size > LIMITE_DESCOMPRIMIDO:
            raise NaoSuportado("documento descomprimido passa de %d MB"
                               % (LIMITE_DESCOMPRIMIDO // (1024 * 1024)))
        xml = z.read("word/document.xml").decode("utf-8", "replace")
    xml = RE_QUEBRA.sub("\n", RE_TAB.sub("\t", xml))
    texto = htmllib.unescape(RE_TAGS.sub("", xml)).strip()
    if not texto:
        raise NaoSuportado("o .docx não tem texto — se o conteúdo for imagem "
                           "digitalizada, exporte como PDF que aí roda o OCR")
    return texto


# ---------------------------------------------------------------------- pdf

def _pdf(nome, dados):
    from pypdf import PdfReader
    from pypdf.errors import PdfReadError

    try:
        leitor = PdfReader(io.BytesIO(dados))
        n = len(leitor.pages)
    except PdfReadError as e:
        # upload interrompido, arquivo truncado: erro do usuario, nao 500
        raise NaoSuportado("PDF corrompido ou incompleto (%s)" % e)
    if leitor.is_encrypted:
        # senha vazia resolve o caso comum: PDF do tribunal so' com permissoes
        # travadas, nao com senha de leitura
        try:
            aberto = leitor.decrypt("")
        except Exception:
            aberto = 0
        if not aberto:
            raise NaoSuportado("PDF protegido por senha — remova a proteção e "
                               "suba de novo")
    try:
        texto = "\n".join(p.extract_text() or "" for p in leitor.pages).strip()
    except PdfReadError as e:
        raise NaoSuportado("PDF corrompido ou incompleto (%s)" % e)
    if len(texto) >= MIN_CHARS_POR_PAGINA * max(1, n):
        return texto, 0.0
    return _ocr(nome, dados, n)


RE_ENVELOPE = re.compile(r"^<file\b[^>]*>|</file>\s*$")
# O cloudflare-ai devolve o texto embrulhado num <file> e precedido de um bloco
# "## Metadata" com PDFFormatVersion, IsXFAPresent e afins. Isso ia inteiro para
# dentro do prompt como se fosse a peca: tokens pagos por lixo que o modelo le'
# como conteudo do advogado.
# Os DOIS marcadores tem de aparecer: so' "## Contents" poderia estar no proprio
# sumario de uma peca, e ai o corte comeria o comeco do documento.
RE_METADADOS = re.compile(r"\A.*?^## Metadata\s*$.*?^## Contents\s*$", re.S | re.M)


def _limpar_ocr(texto):
    texto = RE_ENVELOPE.sub("", texto.strip()).strip()
    return RE_METADADOS.sub("", texto).strip()


def _ocr(nome, dados, paginas):
    """PDF sem camada de texto. O plugin file-parser do OpenRouter faz o OCR e
    devolve o texto nas ANOTACOES — nao na resposta do modelo, que resumiria."""
    if paginas > MAX_PAGINAS_OCR:
        raise NaoSuportado(
            "PDF escaneado de %d páginas; o OCR aqui vai até %d. Separe o "
            "documento ou suba a versão com texto." % (paginas, MAX_PAGINAS_OCR))
    from .llm import chamar

    _, meta = chamar(
        "ocr",
        [{"role": "user", "content": [
            {"type": "text", "text": "Responda apenas OK."},
            {"type": "file",
             "file": {"filename": nome,
                      "file_data": "data:application/pdf;base64,"
                                   + base64.b64encode(dados).decode()}}]}],
        max_tokens=16,
        extra={"plugins": [{"id": "file-parser", "pdf": {"engine": ENGINE_OCR}}]})
    partes = [c.get("text") or ""
              for a in meta["anotacoes"]
              for c in ((a.get("file") or {}).get("content") or [])
              if c.get("type") == "text"]
    texto = _limpar_ocr("\n".join(partes))
    if not texto:
        raise NaoSuportado("o OCR não encontrou texto nesse PDF — pode ser só "
                           "imagem em branco ou digitalização ilegível")
    return texto, meta["custo_usd"]


# --------------------------------------------------------------- texto puro

def _texto_puro(dados):
    """txt/md. Recusa binario disfarcado: latin-1 aceita QUALQUER byte, entao
    sem esta checagem um .exe renomeado vira 2 MB de lixo dentro do prompt."""
    if b"\x00" in dados[:8192]:
        raise NaoSuportado("arquivo binário de formato desconhecido — aceito "
                           ".pdf, .docx, .txt e .md")
    try:
        return dados.decode("utf-8")
    except UnicodeDecodeError:
        pass
    texto = dados.decode("latin-1")
    sujeira = sum(1 for c in texto if c < " " and c not in "\t\r\n")
    if sujeira > len(texto) * 0.01:
        raise NaoSuportado("arquivo binário de formato desconhecido — aceito "
                           ".pdf, .docx, .txt e .md")
    return texto


# -------------------------------------------------------------------- porta

def extrair(nome, dados):
    """Devolve (texto, custo_usd). Custo so' e' diferente de zero no OCR."""
    if not dados:
        raise NaoSuportado("arquivo vazio")
    if len(dados) > LIMITE_BYTES:
        raise NaoSuportado("arquivo de %.1f MB; o limite é %d MB"
                           % (len(dados) / 1048576.0, LIMITE_BYTES // 1048576))
    if dados[:4] == b"%PDF":
        return _pdf(nome, dados)
    if dados[:4] == b"PK\x03\x04":
        return _docx(dados), 0.0
    if dados[:5] == b"{\\rtf":
        raise NaoSuportado("RTF ainda não é lido aqui — abra no Word e salve "
                           "como .docx ou .pdf")
    if dados[:4] == b"\xd0\xcf\x11\xe0":
        raise NaoSuportado(".doc antigo do Word não é lido aqui — abra e salve "
                           "como .docx")
    return _texto_puro(dados), 0.0


def de_arquivo(caminho):
    """Atalho para quem tem caminho em vez de bytes (o CLI)."""
    with open(caminho, "rb") as f:
        return extrair(os.path.basename(caminho), f.read())


if __name__ == "__main__":
    import logging

    # o teste do PDF truncado faz o pypdf gritar "EOF marker not found" — e um
    # self-check que passa gritando ensina a ignorar a saida
    logging.getLogger("pypdf").setLevel(logging.ERROR)

    def recusa(nome, dados, pedaco):
        try:
            extrair(nome, dados)
        except NaoSuportado as e:
            assert pedaco in str(e), "mensagem errada para %s: %s" % (nome, e)
            return
        raise AssertionError("aceitou o que devia recusar: " + nome)

    # --- docx: e' um zip com XML dentro, e o self-check monta um de verdade
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("word/document.xml",
                   '<?xml version="1.0"?><w:document><w:body>'
                   '<w:p><w:r><w:t>Excelent&#237;ssimo Senhor</w:t></w:r></w:p>'
                   '<w:p><w:r><w:t>Doutor</w:t><w:tab/><w:t>&amp; Juiz</w:t></w:r></w:p>'
                   '</w:body></w:document>')
    texto, custo = extrair("peca.docx", buf.getvalue())
    assert texto == "Excelentíssimo Senhor\nDoutor\t& Juiz", repr(texto)
    assert custo == 0.0
    # paragrafo tem de virar quebra de linha: sem isso a peca chega ao modelo
    # como um paredao de uma linha so'
    assert texto.count("\n") == 1, repr(texto)

    # zip que nao e' docx
    vazio = io.BytesIO()
    with zipfile.ZipFile(vazio, "w") as z:
        z.writestr("leiame.txt", "nada")
    recusa("coisa.docx", vazio.getvalue(), "não é um .docx")

    # --- sniff: quem manda e' o magic byte, nao o nome do arquivo
    assert extrair("qualquer.pdf", b"# titulo\n\ncorpo")[0] == "# titulo\n\ncorpo"
    recusa("peca.pdf", b"{\\rtf1\\ansi qualquer coisa", "RTF")
    recusa("peca.docx", b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1resto", ".doc antigo")

    # --- binario disfarcado: E' ISTO que hoje gasta dinheiro rodando em lixo
    recusa("peca.txt", b"MZ\x90\x00\x03\x00\x00\x00" + os.urandom(4000), "binário")
    recusa("peca.md", bytes(range(1, 256)) * 20, "binário")
    # ... sem levar junto texto legitimo que nao e' utf-8 (Word em cp1252)
    assert "ação" in extrair("velho.txt", "ação".encode("latin-1"))[0]

    recusa("grande.txt", b"a" * (LIMITE_BYTES + 1), "o limite é")
    recusa("nada.txt", b"", "vazio")
    recusa("meio.pdf", b"%PDF-1.4\ncortado no meio do upload", "corrompido")

    # --- PDF sem camada de texto tem de cair no OCR, e ESSE galho e' o que
    # gasta dinheiro: aqui o OCR e' falsificado, nada vai para a rede
    from pypdf import PdfWriter

    escrivao, branco = PdfWriter(), io.BytesIO()
    escrivao.add_blank_page(612, 792)
    escrivao.write(branco)

    from . import llm
    chamadas = []
    llm.chamar = lambda *a, **k: (
        chamadas.append(k.get("extra")) or
        ("OK", {"custo_usd": 0.03, "anotacoes": [
            {"file": {"content": [{"type": "text", "text": "peça digitalizada"}]}}]}))
    texto, custo = extrair("escaneada.pdf", branco.getvalue())
    assert texto == "peça digitalizada" and custo == 0.03, (texto, custo)
    # o envelope e o bloco de metadados do file-parser nao podem entrar no
    # prompt: sao tokens pagos que o modelo le' como conteudo da peca
    assert _limpar_ocr(
        "<file name=\"p.pdf\">\n# p.pdf\n## Metadata\n- IsXFAPresent=false\n\n"
        "## Contents\n### Page 1\nEXCELENTISSIMO SENHOR\n</file>"
    ) == "### Page 1\nEXCELENTISSIMO SENHOR"
    # ... e uma peça que por acaso tenha "## Contents" no sumário fica INTEIRA
    peca = "## Contents\nI - Dos fatos\nII - Do direito"
    assert _limpar_ocr(peca) == peca
    assert chamadas[0]["plugins"][0]["pdf"]["engine"] == ENGINE_OCR, chamadas
    # e o PDF COM texto nao pode ter passado por aqui: seria pagar pelo de graça
    assert len(chamadas) == 1, "o caminho pago rodou mais de uma vez"

    # --- PDF de verdade, se o scraper ja' baixou algum (nao vale fabricar um)
    achados = glob.glob(os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        "output", "documentos", "*.pdf"))
    if achados:
        t, c = de_arquivo(achados[0])
        assert t.strip(), "PDF do acervo saiu sem texto nenhum"
        print("PDF lido: %s -> %d caracteres%s"
              % (os.path.basename(achados[0]), len(t),
                 " (pelo OCR)" if c else " (nativo, de graça)"))
    else:
        print("(sem PDF em output/documentos — pulei essa parte)")

    print("self-check OK — tipo pelo magic byte, binário recusado antes de custar")
