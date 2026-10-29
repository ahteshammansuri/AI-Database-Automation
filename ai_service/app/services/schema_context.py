"""
The tables of the user's databases that a request is about.

Laravel describes every table of every connected database (columns, types, keys, allowed values, size, access) from
its latest schema scan; nothing here reads a customer database. Retrieval ranks those descriptions against the
request by meaning (embeddings) and shared words, so a request in any wording finds its tables. A table with the same
name in another database always comes along: with several databases the model must see each one that has it, not just
the best match.
"""
import re
from typing import List, Sequence, Tuple

from ai_service.app.rag.service import rag_service
from ai_service.app.schemas.agent import SchemaDocument

TOP_K = 8
MAX_TABLES = 12


def relevant_tables(query: str, docs: Sequence[SchemaDocument], top_k: int = TOP_K,
                    max_tables: int = MAX_TABLES) -> List[Tuple[SchemaDocument, float]]:
    """(table, score) best first; empty when nothing in the user's databases matches the request."""
    if not docs or not query.strip():
        return []
    ranked = rag_service.rank_texts(query, [d.text or d.table for d in docs], top_k=top_k, names=[d.table for d in docs])
    picked = {i: score for i, score in ranked}
    if not picked:
        return []
    names = {docs[i].table.lower() for i in picked}
    floor = min(picked.values())
    for i, d in enumerate(docs):
        if len(picked) >= max_tables:
            break
        if i not in picked and d.table.lower() in names:
            picked[i] = floor
    return [(docs[i], score) for i, score in sorted(picked.items(), key=lambda kv: kv[1], reverse=True)]


def by_database(tables: Sequence[Tuple[SchemaDocument, float]]) -> str:
    """The tables grouped under their database, for a prompt."""
    groups = {}
    for doc, _ in tables:
        groups.setdefault(doc.connection_id, (doc, []))[1].append(doc)
    lines = []
    for connection_id, (first, docs) in groups.items():
        database = f", database {first.database}" if first.database else ""
        lines.append(f"- connection_id {connection_id}: \"{first.connection}\"{database}")
        lines += [f"  - {d.text or d.table}" for d in docs]
    return "\n".join(lines)
