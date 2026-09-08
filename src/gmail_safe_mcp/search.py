import sqlite3
from typing import Any

from kiwipiepy import Kiwi
from rank_bm25 import BM25Okapi

from gmail_safe_mcp import documents


KIWI = Kiwi()
SEARCH_TAGS = {"NNG", "NNP", "NNB", "NR", "NP", "VV", "VA", "VX", "SL", "SH", "SN"}


def tokenize(text: str) -> list[str]:
    return [token.form.lower() for token in KIWI.tokenize(text) if token.tag in SEARCH_TAGS]


def search_documents(query: str, limit: int = 20) -> list[dict[str, Any]]:
    normalized_query = " ".join(query.split())
    if not normalized_query:
        raise ValueError("검색어를 입력하세요.")
    if not 1 <= limit <= 50:
        raise ValueError("limit은 1에서 50 사이여야 합니다.")
    documents._ensure_storage()
    with sqlite3.connect(documents.DATABASE_PATH) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            "SELECT c.document_id, c.chunk_index, c.page_number, c.text, d.original_name, d.mime_type, d.created_at "
            "FROM document_chunks c JOIN documents d ON d.id = c.document_id"
        ).fetchall()
    if not rows:
        return []
    corpus = [tokenize(row["text"]) for row in rows]
    query_tokens = tokenize(normalized_query)
    if not query_tokens:
        return []
    scores = BM25Okapi(corpus).get_scores(query_tokens)
    ranked = sorted(enumerate(scores), key=lambda item: item[1], reverse=True)
    results = []
    for index, score in ranked[:limit]:
        if score <= 0 and not set(query_tokens).intersection(corpus[index]):
            continue
        row = rows[index]
        results.append(
            {
                "document_id": row["document_id"],
                "chunk_index": row["chunk_index"],
                "page_number": row["page_number"],
                "filename": row["original_name"],
                "mime_type": row["mime_type"],
                "created_at": row["created_at"],
                "score": round(float(score), 4),
                "snippet": _snippet(row["text"], query_tokens),
                "source": f"{row['original_name']} · 문서 {row['document_id'][:8]}",
            }
        )
    return results


def _snippet(text: str, query_tokens: list[str], radius: int = 120) -> str:
    lowered = text.lower()
    positions = [lowered.find(token) for token in query_tokens if lowered.find(token) >= 0]
    start = max(0, min(positions) - radius // 2) if positions else 0
    snippet = " ".join(text[start : start + radius].split())
    return ("..." if start else "") + snippet + ("..." if start + radius < len(text) else "")