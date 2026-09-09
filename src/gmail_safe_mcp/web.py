import json
import logging
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from flask import Flask, abort, jsonify, redirect, render_template, request, send_file, url_for
from google_auth_oauthlib.flow import InstalledAppFlow

from gmail_safe_mcp import documents, search as document_search, server, vision


PROJECT_ROOT = Path(__file__).resolve().parents[2]
USER_AGENTS_DIR = Path.home() / "Library/Application Support/Code/User/prompts"
WORKSPACE_AGENTS_DIR = PROJECT_ROOT / ".github/agents"
DEFAULT_OAUTH_CLIENT_FILE = Path.home() / ".config/gmail-safe-mcp/credentials.json"
OAUTH_CALLBACK_URL = "http://localhost:8765/oauth/callback"
OAUTH_FLOW_LIFETIME = timedelta(minutes=10)
oauth_flows: dict[str, tuple[InstalledAppFlow, datetime]] = {}


class PathPrefixMiddleware:
    def __init__(self, application: Any, prefix: str) -> None:
        self.application = application
        self.prefix = prefix.rstrip("/") or ""

    def __call__(self, environ: dict[str, Any], start_response: Any) -> Any:
        path = environ.get("PATH_INFO", "")
        if self.prefix and (path == self.prefix or path.startswith(f"{self.prefix}/")):
            environ["SCRIPT_NAME"] = self.prefix
            environ["PATH_INFO"] = path[len(self.prefix) :] or "/"
        return self.application(environ, start_response)


def _fetch_local_oauth_token(flow: InstalledAppFlow, authorization_response: str) -> None:
    previous_value = os.environ.get("OAUTHLIB_INSECURE_TRANSPORT")
    os.environ["OAUTHLIB_INSECURE_TRANSPORT"] = "1"
    try:
        flow.fetch_token(authorization_response=authorization_response)
    finally:
        if previous_value is None:
            os.environ.pop("OAUTHLIB_INSECURE_TRANSPORT", None)
        else:
            os.environ["OAUTHLIB_INSECURE_TRANSPORT"] = previous_value


def _agent_metadata(path: Path, scope: str) -> dict[str, str]:
    text = path.read_text(encoding="utf-8")
    metadata: dict[str, str] = {}
    if text.startswith("---\n"):
        frontmatter = text.split("---\n", 2)[1]
        for line in frontmatter.splitlines():
            key, separator, value = line.partition(":")
            if separator and key.strip() in {"name", "description"}:
                metadata[key.strip()] = value.strip().strip('"\'')
    return {
        "name": metadata.get("name", path.stem.removesuffix(".agent")),
        "description": metadata.get("description", "설명이 없습니다."),
        "scope": scope,
        "path": str(path),
        "action": (
            "gmail"
            if path.name == "gmail-cleaner.agent.md"
            else "documents" if path.name == "document-vision.agent.md" else "none"
        ),
    }


def _list_agents() -> list[dict[str, str]]:
    agents = []
    for directory, scope in ((USER_AGENTS_DIR, "사용자"), (WORKSPACE_AGENTS_DIR, "프로젝트")):
        if directory.is_dir():
            agents.extend(_agent_metadata(path, scope) for path in sorted(directory.glob("*.agent.md")))
    return agents


def _save_oauth_client(uploaded_file: Any) -> Path:
    if not uploaded_file or not uploaded_file.filename:
        raise ValueError("Google OAuth JSON 파일을 선택하세요.")
    if not uploaded_file.filename.lower().endswith(".json"):
        raise ValueError("JSON 파일만 등록할 수 있습니다.")
    try:
        payload = json.load(uploaded_file.stream)
        installed = payload["installed"]
        required = {"client_id", "client_secret", "auth_uri", "token_uri", "redirect_uris"}
        if not required.issubset(installed):
            raise KeyError
    except (json.JSONDecodeError, KeyError, TypeError):
        raise ValueError("Google Cloud에서 받은 데스크톱 앱 OAuth JSON이 아닙니다.") from None

    DEFAULT_OAUTH_CLIENT_FILE.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    DEFAULT_OAUTH_CLIENT_FILE.write_text(json.dumps(payload), encoding="utf-8")
    DEFAULT_OAUTH_CLIENT_FILE.chmod(0o600)
    os.environ["GMAIL_OAUTH_CLIENT_FILE"] = str(DEFAULT_OAUTH_CLIENT_FILE)
    return DEFAULT_OAUTH_CLIENT_FILE


def create_app() -> Flask:
    app = Flask(__name__)
    base_path = os.environ.get("APP_BASE_PATH", "").strip()
    if base_path and not base_path.startswith("/"):
        base_path = f"/{base_path}"
    app.wsgi_app = PathPrefixMiddleware(app.wsgi_app, base_path)
    app.config["MAX_CONTENT_LENGTH"] = documents.MAX_FILE_SIZE + 1024 * 1024
    app.jinja_env.filters["pretty_json"] = lambda value: json.dumps(
        value, ensure_ascii=False, indent=2
    )

    @app.before_request
    def document_only_guard() -> None:
        disabled_endpoints = {
            "gmail_page",
            "connect",
            "disconnect",
            "oauth_callback",
            "save_oauth_client",
            "search",
            "trash",
        }
        is_document_entrypoint = request.endpoint == "gmail_page" and bool(request.script_root)
        if (
            os.environ.get("DOCUMENT_ONLY") == "1"
            and request.endpoint in disabled_endpoints
            and not is_document_entrypoint
        ):
            abort(404)

    @app.get("/")
    def gmail_page() -> str:
        if request.script_root:
            return redirect(url_for("documents_page"))
        return render_template("gmail.html", connected=server._load_credentials() is not None)

    @app.get("/agents")
    def agents_page() -> str:
        return render_template("agents.html", agents=_list_agents())

    @app.get("/documents")
    def documents_page() -> str:
        return render_template(
            "documents.html",
            documents=documents.list_documents(),
            copilot_token_set=vision.has_copilot_token(),
        )

    @app.get("/document-search")
    def document_search_page() -> str:
        return render_template("document_search.html")

    @app.post("/api/document-search")
    def document_search_api() -> tuple[Any, int] | Any:
        query = str((request.get_json(silent=True) or {}).get("query", ""))
        try:
            return jsonify({"query": query, "results": document_search.search_documents(query)})
        except ValueError as error:
            return jsonify({"error": str(error)}), 400

    @app.get("/documents/<document_id>")
    def document_detail_page(document_id: str) -> str:
        try:
            document = documents.get_document(document_id)
        except FileNotFoundError:
            return render_template("error.html", message="저장된 문서를 찾을 수 없습니다."), 404
        return render_template("document_detail.html", document=document)

    @app.post("/api/copilot-token")
    def save_copilot_token() -> tuple[Any, int] | Any:
        try:
            vision.save_copilot_token(str((request.get_json(silent=True) or {}).get("token", "")))
            return jsonify({"status": "saved"})
        except ValueError as error:
            return jsonify({"error": str(error)}), 400

    @app.post("/api/documents/extract")
    def extract_document() -> tuple[Any, int] | Any:
        upload = request.files.get("document")
        try:
            staged = documents.stage_upload(upload.filename if upload else "", upload.stream if upload else None)
            extracted = vision.extract_document(Path(staged["path"]))
            return jsonify({
                **staged,
                "extracted": extracted,
                "preview_url": f'{request.script_root}/api/drafts/{staged["draft_id"]}',
            })
        except (ValueError, RuntimeError) as error:
            return jsonify({"error": str(error)}), 400
        except Exception:
            app.logger.exception("Document extraction failed")
            return jsonify({"error": "문서 OCR 처리에 실패했습니다. 이미지 품질과 형식을 확인하세요."}), 502

    @app.get("/api/drafts/<draft_id>")
    def draft_file(draft_id: str) -> Any:
        try:
            path = documents.staged_file(draft_id)
            return send_file(path, conditional=True)
        except (ValueError, FileNotFoundError):
            return "Not found", 404

    @app.post("/api/documents")
    def save_document() -> tuple[Any, int] | Any:
        data = request.get_json(silent=True) or {}
        try:
            extracted = data.get("extracted")
            if not isinstance(extracted, dict):
                raise ValueError("추출 정보는 JSON 객체여야 합니다.")
            meta = data.get("meta")
            if meta is not None and not isinstance(meta, dict):
                raise ValueError("META는 JSON 객체여야 합니다.")
            document_id = documents.save_document(
                str(data.get("draft_id", "")),
                str(data.get("original_name", "")),
                extracted,
                meta,
            )
            return jsonify({"id": document_id, "status": "saved"})
        except (ValueError, FileNotFoundError) as error:
            return jsonify({"error": str(error)}), 400

    @app.post("/api/documents/enrich")
    def enrich_document() -> tuple[Any, int] | Any:
        data = request.get_json(silent=True) or {}
        extracted = data.get("extracted")
        if not isinstance(extracted, dict):
            return jsonify({"error": "추출 정보는 JSON 객체여야 합니다."}), 400
        summary = vision.summarize_document(extracted)
        meta = vision.generate_meta(str(data.get("original_name", "document")), extracted)
        return jsonify({"summary": summary, "meta": meta})

    @app.post("/api/documents/summary")
    def summarize_document() -> tuple[Any, int] | Any:
        extracted = (request.get_json(silent=True) or {}).get("extracted")
        if not isinstance(extracted, dict):
            return jsonify({"error": "추출 정보는 JSON 객체여야 합니다."}), 400
        try:
            return jsonify({"summary": vision.summarize_document(extracted)})
        except (ValueError, RuntimeError) as error:
            return jsonify({"error": str(error)}), 400

    @app.post("/api/documents/meta")
    def generate_document_meta() -> tuple[Any, int] | Any:
        data = request.get_json(silent=True) or {}
        extracted = data.get("extracted")
        if not isinstance(extracted, dict):
            return jsonify({"error": "추출 정보는 JSON 객체여야 합니다."}), 400
        try:
            return jsonify({"meta": vision.generate_meta(str(data.get("original_name", "document")), extracted)})
        except (ValueError, RuntimeError) as error:
            return jsonify({"error": str(error)}), 400

    @app.get("/api/documents/<document_id>/file")
    def saved_document_file(document_id: str) -> Any:
        try:
            return send_file(documents.document_file(document_id), conditional=True)
        except FileNotFoundError:
            return "Not found", 404

    @app.post("/api/documents/<document_id>/meta")
    def create_document_meta(document_id: str) -> tuple[Any, int] | Any:
        try:
            document = documents.get_document(document_id)
            meta = vision.generate_meta(document["original_name"], document["extracted"])
            documents.update_meta(document_id, meta)
            return jsonify({"meta": meta})
        except (ValueError, RuntimeError, FileNotFoundError) as error:
            return jsonify({"error": str(error)}), 400
        except Exception:
            app.logger.exception("Document META generation failed")
            return jsonify({"error": "META 생성에 실패했습니다."}), 502

    @app.put("/api/documents/<document_id>/meta")
    def update_document_meta(document_id: str) -> tuple[Any, int] | Any:
        data = request.get_json(silent=True) or {}
        meta = data.get("meta")
        if not isinstance(meta, dict):
            return jsonify({"error": "META는 JSON 객체여야 합니다."}), 400
        try:
            documents.update_document_meta(document_id, meta)
            return jsonify({"status": "saved"})
        except FileNotFoundError as error:
            return jsonify({"error": str(error)}), 404

    @app.delete("/api/documents/<document_id>")
    def delete_document(document_id: str) -> tuple[Any, int] | Any:
        try:
            documents.delete_document(document_id)
            return jsonify({"status": "deleted"})
        except FileNotFoundError as error:
            return jsonify({"error": str(error)}), 404

    @app.put("/api/documents/<document_id>")
    def update_document(document_id: str) -> tuple[Any, int] | Any:
        data = request.get_json(silent=True) or {}
        extracted, meta = data.get("extracted"), data.get("meta")
        if not isinstance(extracted, dict) or not isinstance(meta, dict):
            return jsonify({"error": "내용과 META는 JSON 객체여야 합니다."}), 400
        try:
            documents.update_document(document_id, extracted, meta)
            return jsonify({"status": "saved"})
        except FileNotFoundError as error:
            return jsonify({"error": str(error)}), 404

    @app.put("/api/documents/<document_id>/extracted")
    def update_document_extracted(document_id: str) -> tuple[Any, int] | Any:
        extracted = (request.get_json(silent=True) or {}).get("extracted")
        if not isinstance(extracted, dict):
            return jsonify({"error": "내용은 JSON 객체여야 합니다."}), 400
        try:
            documents.update_document_extracted(document_id, extracted)
            return jsonify({"status": "saved"})
        except FileNotFoundError as error:
            return jsonify({"error": str(error)}), 404

    @app.post("/api/connect")
    def connect() -> tuple[Any, int] | Any:
        try:
            client_file = Path(os.environ.get("GMAIL_OAUTH_CLIENT_FILE", DEFAULT_OAUTH_CLIENT_FILE))
            if not client_file.is_file():
                raise ValueError("GMAIL_OAUTH_CLIENT_FILE must point to a Google Desktop OAuth JSON file.")
            flow = InstalledAppFlow.from_client_secrets_file(client_file, [server.GMAIL_SCOPE])
            flow.redirect_uri = OAUTH_CALLBACK_URL
            authorization_url, state = flow.authorization_url(
                access_type="offline", include_granted_scopes="true", prompt="consent"
            )
            oauth_flows.clear()
            oauth_flows[state] = (flow, datetime.now(UTC) + OAUTH_FLOW_LIFETIME)
            return jsonify({"authorization_url": authorization_url})
        except Exception as error:
            return jsonify({"error": str(error)}), 400

    @app.post("/api/disconnect")
    def disconnect() -> tuple[Any, int] | Any:
        try:
            return jsonify(server.disconnect_gmail())
        except Exception:
            app.logger.exception("Gmail disconnect failed")
            return jsonify({"error": "Gmail 로그아웃에 실패했습니다."}), 500

    @app.get("/oauth/callback")
    def oauth_callback() -> Any:
        if request.host not in {"localhost:8765", "127.0.0.1:8765"}:
            return "Invalid OAuth callback host", 400
        if request.args.get("error"):
            return redirect("/?oauth=denied")
        state = request.args.get("state", "")
        flow_entry = oauth_flows.pop(state, None)
        if flow_entry is None or datetime.now(UTC) >= flow_entry[1]:
            return redirect("/?oauth=expired")
        flow = flow_entry[0]
        try:
            _fetch_local_oauth_token(flow, request.url)
            server._save_credentials(flow.credentials)
        except Exception:
            app.logger.exception("Google OAuth callback failed")
            return redirect("/?oauth=failed")
        return redirect("/?oauth=connected")

    @app.post("/api/oauth-client")
    def save_oauth_client() -> tuple[Any, int] | Any:
        try:
            path = _save_oauth_client(request.files.get("oauth_client"))
            return jsonify({"status": "saved", "path": str(path)})
        except ValueError as error:
            return jsonify({"error": str(error)}), 400

    @app.post("/api/search")
    def search() -> tuple[Any, int] | Any:
        data = request.get_json(silent=True) or {}
        try:
            result = server._search(data.get("sender"), data.get("keyword"), server.MAX_RESULTS)
            return jsonify(result)
        except (ValueError, RuntimeError) as error:
            return jsonify({"error": str(error)}), 400
        except Exception:
            app.logger.exception("Gmail search failed")
            return jsonify({"error": "Gmail 검색에 실패했습니다. 잠시 후 다시 시도하세요."}), 502

    @app.post("/api/trash")
    def trash() -> tuple[Any, int] | Any:
        data = request.get_json(silent=True) or {}
        try:
            result = server._trash(
                str(data.get("preview_token", "")),
                data.get("message_ids", []),
                str(data.get("confirmation", "")),
            )
            return jsonify(result)
        except (ValueError, RuntimeError) as error:
            return jsonify({"error": str(error)}), 400
        except Exception:
            app.logger.exception("Gmail trash operation failed")
            return jsonify({"error": "휴지통 이동에 실패했습니다. Gmail에서 상태를 확인하세요."}), 502

    return app


def main() -> None:
    os.environ.setdefault("GMAIL_OAUTH_CLIENT_FILE", str(DEFAULT_OAUTH_CLIENT_FILE))
    logging.getLogger("werkzeug").setLevel(logging.ERROR)
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8765"))
    create_app().run(host=host, port=port, debug=False)


if __name__ == "__main__":
    main()