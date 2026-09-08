import io
import json
import unittest
from unittest.mock import patch

from gmail_safe_mcp import web
from gmail_safe_mcp.web import create_app


class GmailWebTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.app.config["TESTING"] = True
        self.client = self.app.test_client()

    @patch("gmail_safe_mcp.web.server._load_credentials", return_value=None)
    def test_gmail_page_renders_search_fields(self, _credentials):
        response = self.client.get("/")
        self.assertEqual(200, response.status_code)
        self.assertIn("키워드".encode(), response.data)
        self.assertIn("발송인 이메일".encode(), response.data)

    @patch("gmail_safe_mcp.web.server._search")
    def test_search_api_returns_metadata(self, search):
        search.return_value = {"preview_token": "token", "count": 0, "messages": []}
        response = self.client.post("/api/search", json={"sender": "sender@example.com"})
        self.assertEqual(200, response.status_code)
        search.assert_called_once_with("sender@example.com", None, 20)

    @patch("gmail_safe_mcp.web.server.disconnect_gmail")
    def test_disconnect_api_removes_saved_login(self, disconnect):
        disconnect.return_value = {"status": "disconnected"}

        response = self.client.post("/api/disconnect", json={})

        self.assertEqual(200, response.status_code)
        self.assertEqual("disconnected", response.json["status"])
        disconnect.assert_called_once_with()

    @patch("gmail_safe_mcp.web.InstalledAppFlow.from_client_secrets_file")
    @patch("gmail_safe_mcp.web.Path.is_file", return_value=True)
    def test_connect_returns_authorization_url_without_blocking(self, _is_file, from_client_file):
        flow = from_client_file.return_value
        flow.authorization_url.return_value = ("https://accounts.google.com/authorize", "state")

        response = self.client.post("/api/connect", json={})

        self.assertEqual(200, response.status_code)
        self.assertEqual("https://accounts.google.com/authorize", response.json["authorization_url"])
        flow.authorization_url.assert_called_once()

    def test_local_oauth_http_exception_is_scoped_to_token_exchange(self):
        flow = unittest.mock.Mock()
        with patch.dict("os.environ", {}, clear=True):
            web._fetch_local_oauth_token(flow, "http://localhost:8765/oauth/callback?code=test")
            self.assertNotIn("OAUTHLIB_INSECURE_TRANSPORT", web.os.environ)
        flow.fetch_token.assert_called_once()

    @patch("gmail_safe_mcp.web.server._trash")
    def test_trash_api_passes_confirmation_to_safe_service(self, trash):
        trash.return_value = {"count": 1, "permanently_deleted": False}
        response = self.client.post(
            "/api/trash",
            json={"preview_token": "token", "message_ids": ["m1"], "confirmation": "TRASH 1"},
        )
        self.assertEqual(200, response.status_code)
        trash.assert_called_once_with("token", ["m1"], "TRASH 1")

    def test_agents_page_lists_gmail_cleaner(self):
        response = self.client.get("/agents")
        self.assertEqual(200, response.status_code)
        self.assertIn(b"Gmail Cleaner", response.data)

    @patch("gmail_safe_mcp.web.documents.list_documents", return_value=[])
    @patch("gmail_safe_mcp.web.vision.has_copilot_token", return_value=False)
    def test_documents_page_renders_upload_and_meta_controls(self, _token, _documents):
        response = self.client.get("/documents")
        self.assertEqual(200, response.status_code)
        self.assertIn("Vision OCR 실행".encode(), response.data)
        self.assertIn("저장된 문서".encode(), response.data)
        self.assertIn(b"PDF", response.data)
        self.assertIn(b"10", response.data)

    @patch("gmail_safe_mcp.web.documents.list_documents", return_value=[
        {"id": "doc1", "original_name": "a.png", "created_at": "2026-09-03", "extracted": {"document_type": "문서"}, "meta": None}
    ])
    def test_saved_document_actions_are_delete_original_detail(self, _documents):
        html = self.client.get("/documents").get_data(as_text=True)
        self.assertLess(html.index('target="_blank">원본<'), html.index("delete-document"))
        self.assertLess(html.index("delete-document"), html.index('href="/documents/doc1">상세 보기<'))

    @patch("gmail_safe_mcp.web.documents.get_document")
    def test_document_detail_renders_original_summary_and_meta_editor(self, get_document):
        get_document.return_value = {
            "id": "doc1", "original_name": "receipt.png", "mime_type": "image/png",
            "extracted": {"summary": "요약입니다.", "issuer": "서울 상점"}, "meta": {"title": "영수증"},
        }
        response = self.client.get("/documents/doc1")
        self.assertEqual(200, response.status_code)
        self.assertIn("요약입니다.".encode(), response.data)
        self.assertIn("서울 상점".encode(), response.data)
        self.assertNotIn(b"\\uC11C\\uc6b8", response.data)
        self.assertNotIn("JSON 편집".encode(), response.data)
        self.assertIn("내용 JSON 저장".encode(), response.data)
        self.assertIn("META 저장".encode(), response.data)
        self.assertNotIn("META 생성".encode(), response.data)

    @patch("gmail_safe_mcp.web.documents.update_document_meta")
    def test_document_detail_meta_can_be_saved(self, update):
        response = self.client.put("/api/documents/doc1/meta", json={"meta": {"title": "수정"}})
        self.assertEqual(200, response.status_code)
        update.assert_called_once_with("doc1", {"title": "수정"})

    @patch("gmail_safe_mcp.web.documents.update_document")
    def test_document_detail_can_save_content_and_meta_together(self, update):
        response = self.client.put(
            "/api/documents/doc1",
            json={"extracted": {"summary": "수정 요약"}, "meta": {"title": "수정 제목"}},
        )
        self.assertEqual(200, response.status_code)
        update.assert_called_once_with("doc1", {"summary": "수정 요약"}, {"title": "수정 제목"})

    @patch("gmail_safe_mcp.web.documents.update_document_extracted")
    def test_document_detail_can_save_content_json_alone(self, update):
        response = self.client.put("/api/documents/doc1/extracted", json={"extracted": {"title": "수정"}})
        self.assertEqual(200, response.status_code)
        update.assert_called_once_with("doc1", {"title": "수정"})

    @patch("gmail_safe_mcp.web.documents.delete_document")
    def test_delete_document_api_removes_saved_record(self, delete):
        response = self.client.delete("/api/documents/doc1")
        self.assertEqual(200, response.status_code)
        delete.assert_called_once_with("doc1")

    @patch("gmail_safe_mcp.web.vision.save_copilot_token")
    def test_copilot_token_api_stores_token(self, save_token):
        response = self.client.post("/api/copilot-token", json={"token": "github_pat_" + "a" * 30})
        self.assertEqual(200, response.status_code)
        save_token.assert_called_once()

    @patch("gmail_safe_mcp.web.document_search.search_documents", return_value=[
        {"document_id": "doc1", "filename": "contract.png", "snippet": "계약기간", "source": "contract.png", "score": 1.2}
    ])
    def test_document_search_api_returns_ranked_sources(self, search_documents):
        response = self.client.post("/api/document-search", json={"query": "계약기간"})
        self.assertEqual(200, response.status_code)
        self.assertEqual("contract.png", response.json["results"][0]["filename"])
        search_documents.assert_called_once_with("계약기간")

    @patch("gmail_safe_mcp.web.vision.extract_document", return_value={"document_type": "receipt"})
    @patch("gmail_safe_mcp.web.documents.stage_upload")
    def test_extract_api_returns_draft_and_json(self, stage, _extract):
        stage.return_value = {
            "draft_id": "a" * 32,
            "original_name": "receipt.png",
            "path": "/tmp/receipt.png",
            "mime_type": "image/png",
        }
        response = self.client.post(
            "/api/documents/extract",
            data={"document": (io.BytesIO(b"image"), "receipt.png")},
        )
        self.assertEqual(200, response.status_code)
        self.assertEqual("receipt", response.json["extracted"]["document_type"])

    @patch("gmail_safe_mcp.web.documents.save_document", return_value="doc1")
    def test_save_document_requires_json_object(self, save):
        invalid = self.client.post(
            "/api/documents", json={"draft_id": "draft", "original_name": "a.png", "extracted": []}
        )
        self.assertEqual(400, invalid.status_code)
        valid = self.client.post(
            "/api/documents",
            json={
                "draft_id": "draft",
                "original_name": "a.png",
                "extracted": {"title": "A"},
                "meta": {"category": "문서"},
            },
        )
        self.assertEqual(200, valid.status_code)
        save.assert_called_once_with("draft", "a.png", {"title": "A"}, {"category": "문서"})

    @patch("gmail_safe_mcp.web.vision.generate_meta", return_value={"category": "영수증"})
    @patch("gmail_safe_mcp.web.vision.summarize_document", return_value="영수증 요약입니다.")
    def test_enrich_api_returns_summary_and_meta(self, _summarize, _meta):
        response = self.client.post(
            "/api/documents/enrich",
            json={"original_name": "receipt.png", "extracted": {"document_type": "영수증"}},
        )
        self.assertEqual(200, response.status_code)
        self.assertEqual("영수증 요약입니다.", response.json["summary"])
        self.assertEqual("영수증", response.json["meta"]["category"])

    @patch("gmail_safe_mcp.web.documents.update_meta")
    @patch("gmail_safe_mcp.web.vision.generate_meta", return_value={"title": "영수증"})
    @patch("gmail_safe_mcp.web.documents.get_document")
    def test_meta_api_saves_generated_meta(self, get_document, _generate, update):
        get_document.return_value = {"original_name": "a.png", "extracted": {"amount": 1000}}
        response = self.client.post("/api/documents/doc1/meta")
        self.assertEqual(200, response.status_code)
        update.assert_called_once_with("doc1", {"title": "영수증"})

    def test_oauth_upload_rejects_non_desktop_client(self):
        response = self.client.post(
            "/api/oauth-client",
            data={"oauth_client": (io.BytesIO(b'{"web": {}}'), "credentials.json")},
        )
        self.assertEqual(400, response.status_code)
        self.assertIn("OAuth JSON".encode(), response.data)

    def test_oauth_upload_saves_valid_client_with_private_permissions(self):
        payload = {
            "installed": {
                "client_id": "id",
                "client_secret": "secret",
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": ["http://localhost"],
            }
        }
        temporary_path = self.app.config.get("TEST_OAUTH_PATH")
        with self.app.test_request_context():
            pass
        with patch.object(web, "DEFAULT_OAUTH_CLIENT_FILE") as path:
            path.parent.mkdir.return_value = None
            response = self.client.post(
                "/api/oauth-client",
                data={
                    "oauth_client": (
                        io.BytesIO(json.dumps(payload).encode()),
                        "credentials.json",
                    )
                },
            )
        self.assertEqual(200, response.status_code)
        path.write_text.assert_called_once()
        path.chmod.assert_called_once_with(0o600)


if __name__ == "__main__":
    unittest.main()