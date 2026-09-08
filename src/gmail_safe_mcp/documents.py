import json
import hashlib
import mimetypes
import os
import shutil
import sqlite3
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, BinaryIO


APP_DATA_DIR = Path.home() / "Library/Application Support/GmailSafe"
DOCUMENTS_DIR = APP_DATA_DIR / "documents"
STAGING_DIR = APP_DATA_DIR / "staging"
DATABASE_PATH = APP_DATA_DIR / "documents.sqlite3"
ALLOWED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png"}
MAX_FILE_SIZE = 15 * 1024 * 1024
DOCUMENT_SCHEMA_VERSION = 2


def _json_text(value: Any) -> str:
    if isinstance(value, dict):
        return " ".join(f"{key} { _json_text(item) }" for key, item in value.items())
    if isinstance(value, list):
        return " ".join(_json_text(item) for item in value)
    return str(value) if value is not None else ""


def build_search_text(original_name: str, extracted: dict[str, Any], meta: dict[str, Any] | None) -> str:
    parts = [Path(original_name).stem, _json_text(extracted)]
    if meta:
        parts.append(_json_text(meta))
    return " ".join(" ".join(parts).split())


def _content_hash(search_text: str) -> str:
    return hashlib.sha256(search_text.encode("utf-8")).hexdigest()


def _replace_initial_chunk(connection: sqlite3.Connection, document_id: str, text: str) -> None:
    connection.execute("DELETE FROM document_chunks WHERE document_id = ?", (document_id,))
    connection.execute(
        "INSERT INTO document_chunks (id, document_id, chunk_index, page_number, text, embedding_json, embedding_model, created_at) VALUES (?, ?, 0, NULL, ?, NULL, NULL, ?)",
        (uuid.uuid4().hex, document_id, text, datetime.now(UTC).isoformat()),
    )


def _replace_chunks(connection: sqlite3.Connection, document_id: str, extracted: dict[str, Any], search_text: str) -> None:
    pages = extracted.get("pages")
    if not isinstance(pages, list) or not pages:
        _replace_initial_chunk(connection, document_id, search_text)
        return
    connection.execute("DELETE FROM document_chunks WHERE document_id = ?", (document_id,))
    for index, page in enumerate(pages):
        if not isinstance(page, dict) or not isinstance(page.get("text"), str):
            continue
        page_number = page.get("page_number")
        connection.execute(
            "INSERT INTO document_chunks (id, document_id, chunk_index, page_number, text, embedding_json, embedding_model, created_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)",
            (uuid.uuid4().hex, document_id, index, page_number if isinstance(page_number, int) else None, page["text"], datetime.now(UTC).isoformat()),
        )


def _ensure_storage() -> None:
    for directory in (APP_DATA_DIR, DOCUMENTS_DIR, STAGING_DIR):
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    with sqlite3.connect(DATABASE_PATH) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS documents (
                id TEXT PRIMARY KEY,
                original_name TEXT NOT NULL,
                stored_name TEXT NOT NULL,
                mime_type TEXT NOT NULL,
                extracted_json TEXT NOT NULL,
                meta_json TEXT,
                created_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS document_chunks (
                id TEXT PRIMARY KEY,
                document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                chunk_index INTEGER NOT NULL,
                page_number INTEGER,
                text TEXT NOT NULL,
                embedding_json TEXT,
                embedding_model TEXT,
                created_at TEXT NOT NULL,
                UNIQUE(document_id, chunk_index)
            )
            """
        )
        columns = {row[1] for row in connection.execute("PRAGMA table_info(documents)")}
        migrations = {
            "search_text": "ALTER TABLE documents ADD COLUMN search_text TEXT NOT NULL DEFAULT ''",
            "content_hash": "ALTER TABLE documents ADD COLUMN content_hash TEXT NOT NULL DEFAULT ''",
            "schema_version": "ALTER TABLE documents ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1",
        }
        for column, statement in migrations.items():
            if column not in columns:
                connection.execute(statement)
        rows = connection.execute(
            "SELECT id, original_name, extracted_json, meta_json FROM documents WHERE search_text = ''"
        ).fetchall()
        for row in rows:
            extracted = json.loads(row[2])
            meta = json.loads(row[3]) if row[3] else None
            search_text = build_search_text(row[1], extracted, meta)
            connection.execute(
                "UPDATE documents SET search_text = ?, content_hash = ?, schema_version = ? WHERE id = ?",
                (search_text, _content_hash(search_text), DOCUMENT_SCHEMA_VERSION, row[0]),
            )
        existing_documents = connection.execute(
            "SELECT id, search_text FROM documents WHERE search_text != ''"
        ).fetchall()
        for row in existing_documents:
            has_chunk = connection.execute(
                "SELECT 1 FROM document_chunks WHERE document_id = ? LIMIT 1", (row[0],)
            ).fetchone()
            if has_chunk is None:
                _replace_initial_chunk(connection, row[0], row[1])


def stage_upload(filename: str, stream: BinaryIO) -> dict[str, str]:
    _ensure_storage()
    safe_name = Path(filename).name
    extension = Path(safe_name).suffix.lower()
    if not safe_name or extension not in ALLOWED_EXTENSIONS:
        raise ValueError("PDF, JPG, JPEG, PNG 파일만 업로드할 수 있습니다.")
    content = stream.read(MAX_FILE_SIZE + 1)
    if not content:
        raise ValueError("빈 파일은 업로드할 수 없습니다.")
    if len(content) > MAX_FILE_SIZE:
        raise ValueError("파일 크기는 15MB 이하여야 합니다.")
    if extension == ".pdf" and not content.startswith(b"%PDF-"):
        raise ValueError("올바른 PDF 파일이 아닙니다.")
    if extension in {".jpg", ".jpeg"} and not content.startswith(b"\xff\xd8\xff"):
        raise ValueError("올바른 JPEG 파일이 아닙니다.")
    if extension == ".png" and not content.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("올바른 PNG 파일이 아닙니다.")

    draft_id = uuid.uuid4().hex
    staged_path = STAGING_DIR / f"{draft_id}{extension}"
    staged_path.write_bytes(content)
    staged_path.chmod(0o600)
    return {
        "draft_id": draft_id,
        "original_name": safe_name,
        "path": str(staged_path),
        "mime_type": mimetypes.guess_type(safe_name)[0] or "application/octet-stream",
    }


def staged_file(draft_id: str) -> Path:
    if not draft_id.isalnum() or len(draft_id) != 32:
        raise ValueError("잘못된 임시 문서 ID입니다.")
    matches = list(STAGING_DIR.glob(f"{draft_id}.*"))
    if len(matches) != 1 or matches[0].suffix.lower() not in ALLOWED_EXTENSIONS:
        raise FileNotFoundError("임시 문서를 찾을 수 없습니다.")
    return matches[0]


def save_document(
    draft_id: str,
    original_name: str,
    extracted: dict[str, Any],
    meta: dict[str, Any] | None = None,
) -> str:
    _ensure_storage()
    source = staged_file(draft_id)
    document_id = uuid.uuid4().hex
    stored_name = f"{document_id}{source.suffix.lower()}"
    destination = DOCUMENTS_DIR / stored_name
    shutil.move(source, destination)
    destination.chmod(0o600)
    mime_type = mimetypes.guess_type(original_name)[0] or "application/octet-stream"
    search_text = build_search_text(original_name, extracted, meta)
    with sqlite3.connect(DATABASE_PATH) as connection:
        connection.execute(
            "INSERT INTO documents (id, original_name, stored_name, mime_type, extracted_json, meta_json, created_at, search_text, content_hash, schema_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                document_id,
                Path(original_name).name,
                stored_name,
                mime_type,
                json.dumps(extracted, ensure_ascii=False),
                json.dumps(meta, ensure_ascii=False) if meta else None,
                datetime.now(UTC).isoformat(),
                search_text,
                _content_hash(search_text),
                DOCUMENT_SCHEMA_VERSION,
            ),
        )
        _replace_chunks(connection, document_id, extracted, search_text)
    return document_id


def list_documents() -> list[dict[str, Any]]:
    _ensure_storage()
    with sqlite3.connect(DATABASE_PATH) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            "SELECT id, original_name, mime_type, extracted_json, meta_json, created_at "
            "FROM documents ORDER BY created_at DESC"
        ).fetchall()
    return [
        {
            **dict(row),
            "extracted": json.loads(row["extracted_json"]),
            "meta": json.loads(row["meta_json"]) if row["meta_json"] else None,
        }
        for row in rows
    ]


def get_document(document_id: str) -> dict[str, Any]:
    _ensure_storage()
    with sqlite3.connect(DATABASE_PATH) as connection:
        connection.row_factory = sqlite3.Row
        row = connection.execute("SELECT * FROM documents WHERE id = ?", (document_id,)).fetchone()
    if row is None:
        raise FileNotFoundError("저장된 문서를 찾을 수 없습니다.")
    result = dict(row)
    result["extracted"] = json.loads(result.pop("extracted_json"))
    result["meta"] = json.loads(result.pop("meta_json")) if result["meta_json"] else None
    return result


def update_meta(document_id: str, meta: dict[str, Any]) -> None:
    document = get_document(document_id)
    update_document(document_id, document["extracted"], meta)


def update_document_meta(document_id: str, meta: dict[str, Any]) -> None:
    document = get_document(document_id)
    update_document(document_id, document["extracted"], meta)


def update_document(document_id: str, extracted: dict[str, Any], meta: dict[str, Any]) -> None:
    _ensure_storage()
    document = get_document(document_id)
    search_text = build_search_text(document["original_name"], extracted, meta)
    with sqlite3.connect(DATABASE_PATH) as connection:
        cursor = connection.execute(
            "UPDATE documents SET extracted_json = ?, meta_json = ?, search_text = ?, content_hash = ?, schema_version = ? WHERE id = ?",
            (
                json.dumps(extracted, ensure_ascii=False),
                json.dumps(meta, ensure_ascii=False),
                search_text,
                _content_hash(search_text),
                DOCUMENT_SCHEMA_VERSION,
                document["id"],
            ),
        )
        _replace_initial_chunk(connection, document["id"], search_text)
    if cursor.rowcount != 1:
        raise FileNotFoundError("저장된 문서를 찾을 수 없습니다.")


def update_document_extracted(document_id: str, extracted: dict[str, Any]) -> None:
    _ensure_storage()
    document = get_document(document_id)
    search_text = build_search_text(document["original_name"], extracted, document["meta"])
    with sqlite3.connect(DATABASE_PATH) as connection:
        cursor = connection.execute(
            "UPDATE documents SET extracted_json = ?, search_text = ?, content_hash = ?, schema_version = ? WHERE id = ?",
            (
                json.dumps(extracted, ensure_ascii=False),
                search_text,
                _content_hash(search_text),
                DOCUMENT_SCHEMA_VERSION,
                document["id"],
            ),
        )
        _replace_initial_chunk(connection, document["id"], search_text)
    if cursor.rowcount != 1:
        raise FileNotFoundError("저장된 문서를 찾을 수 없습니다.")


def delete_document(document_id: str) -> None:
    _ensure_storage()
    with sqlite3.connect(DATABASE_PATH) as connection:
        row = connection.execute("SELECT stored_name FROM documents WHERE id = ?", (document_id,)).fetchone()
        if row is None:
            raise FileNotFoundError("저장된 문서를 찾을 수 없습니다.")
        connection.execute("DELETE FROM documents WHERE id = ?", (document_id,))
    path = DOCUMENTS_DIR / row[0]
    if path.is_file():
        path.unlink()


def document_file(document_id: str) -> Path:
    document = get_document(document_id)
    path = DOCUMENTS_DIR / document["stored_name"]
    if not path.is_file():
        raise FileNotFoundError("원본 파일을 찾을 수 없습니다.")
    return path